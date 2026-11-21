import crypto from 'node:crypto';
import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
import { accountFieldsFromSession, WxLoginService } from '../../services/wx-login/service';
import type { ScanStatus, WxLoginSession } from '../../services/wx-login/service';

export { };

const { createAuthRequired } = require('./middleware');

const TARGET_APP_ID = 'wx5306c5978fdb76e4';
// 扫码任务存活时间。原来只有 110 秒，用户从看到码到掏出手机扫，经常就过了这个点，
// 任务被销毁后再扫码只会拿到 404，白扫一次。二维码本身在微信侧的有效期更长，放宽到 5 分钟。
const TASK_TTL_MS = 300_000;
// 扫码换到的凭据（openid/accessToken/expiresAt/refreshToken）在这里暂存一份，
// 等前端把账号 POST 上来时由账户路由取走落盘。
// 没有这一步，扫码得到的 accessToken 与过期时间会被丢弃，账号记录里只剩旧的过期凭据，
// 于是程序每次都会「以为该刷新了」，拿过期 accessToken 去刷新，被微信回 -109。
const ISSUED_TTL_MS = 10 * 60 * 1000;
type Status = ScanStatus | 'ready_for_code' | 'failed';
interface Task { id: string; createdAt: number; status: Status; session: WxLoginSession; qr: Buffer; code?: string; loginBuffer?: string; credentials?: any; pending?: Promise<void>; }
const tasks = new Map<string, Task>();
const issuedSessions = new Map<string, { fields: Record<string, unknown>; at: number }>();
const wxLogin = new WxLoginService();

function pruneIssuedSessions(now = Date.now()): void {
    for (const [code, entry] of issuedSessions) {
        if (now - entry.at > ISSUED_TTL_MS) issuedSessions.delete(code);
    }
}

function stashIssuedSession(task: Task, code: string): void {
    const fields = accountFieldsFromSession(task.session);
    if (!String(fields.wxAccessToken || '').trim()) return;
    pruneIssuedSessions();
    issuedSessions.set(String(code), { fields, at: Date.now() });
}

/** 按 code 取走扫码时暂存的凭据字段（一次性）。account-routes 保存账号时调用。 */
function takeIssuedWxSessionByCode(code: unknown): Record<string, unknown> | null {
    const key = String(code || '').trim();
    if (!key) return null;
    pruneIssuedSessions();
    const hit = issuedSessions.get(key);
    if (!hit) return null;
    issuedSessions.delete(key);
    return hit.fields;
}

function destroy(task: Task): void { wxLogin.destroy(task.session); task.code = undefined; tasks.delete(task.id); }
function publicTask(task: Task) { return { task_id: task.id, app_id: TARGET_APP_ID, status: task.status, expires_at: Math.floor((task.createdAt + TASK_TTL_MS) / 1000) }; }
function findTask(req: Request, res: Response): Task | null {
    const task = tasks.get(String(req.params.taskId || ''));
    if (!task || Date.now() - task.createdAt > TASK_TTL_MS) { if (task) destroy(task); res.status(404).json({ ok: false, error: 'Login task not found or expired' }); return null; }
    return task;
}
async function createTask(): Promise<Task> {
    const { session, qr } = await wxLogin.createQrSession();
    const task: Task = { id: crypto.randomBytes(32).toString('hex'), createdAt: Date.now(), status: 'waiting', session, qr };
    tasks.set(task.id, task);
    return task;
}
async function poll(task: Task): Promise<void> { if (task.status === 'authorized' || task.status === 'ready_for_code') return; task.status = await wxLogin.poll(task.session); }
async function confirm(task: Task): Promise<void> {
    if (task.status !== 'authorized') throw new Error('Waiting for scan authorization');
    // confirm 会产出 loginBuffer 与 cookies 凭据（accessToken/refreshToken 等），
    // 必须保存在任务上供 /code 一起返回，否则扫码会话会随任务销毁而丢失，
    // 账号掉线后将无法自动重新登录
    const confirmed = await wxLogin.confirm(task.session);
    task.loginBuffer = confirmed.loginBuffer;
    task.credentials = confirmed.credentials;
    task.status = 'ready_for_code';
}
async function consumeCode(task: Task): Promise<void> {
    if (task.status !== 'ready_for_code') throw new Error('Login code is not ready');
    task.code = await wxLogin.issueCode(task.session, TARGET_APP_ID);
    // 任务随后会被 destroy，凭据必须先暂存，否则账号保存时拿不到 accessToken/expiresAt
    stashIssuedSession(task, task.code);
}

function mountWxLoginRoutes(app: Application, ctx: AdminContext): void {
    app.use('/api/wx-login', createAuthRequired(ctx));

    app.post('/api/wx-login/tasks', async (req, res) => { if (req.body?.app_id && req.body.app_id !== TARGET_APP_ID) return res.status(400).json({ ok: false, error: 'Unsupported app_id' }); try { const task = await createTask(); res.json({ ok: true, data: { ...publicTask(task), qr_url: `/api/wx-login/tasks/${task.id}/qr` } }); } catch (error: any) { res.status(502).json({ ok: false, error: error.message }); } });
    app.get('/api/wx-login/tasks/:taskId/qr', (req, res) => { const task = findTask(req, res); if (task) res.type('jpeg').send(task.qr); });
    app.delete('/api/wx-login/tasks/:taskId', (req, res) => {
        const task = tasks.get(String(req.params.taskId || ''));
        if (!task) return res.status(404).json({ ok: false, error: 'Login task not found or expired' });
        destroy(task);
        return res.json({ ok: true });
    });
    app.get('/api/wx-login/tasks/:taskId/status', async (req, res) => { const task = findTask(req, res); if (!task) return; try { if (!task.pending) task.pending = poll(task).finally(() => { task.pending = undefined; }); await task.pending; const data = publicTask(task); if (task.status === 'cancelled' || task.status === 'expired') destroy(task); res.json({ ok: true, data }); } catch (error: any) { task.status = 'failed'; destroy(task); res.status(502).json({ ok: false, error: error.message }); } });
    app.post('/api/wx-login/tasks/:taskId/confirm', async (req, res) => { const task = findTask(req, res); if (!task) return; try { if (!task.pending) task.pending = confirm(task).finally(() => { task.pending = undefined; }); await task.pending; res.json({ ok: true, data: publicTask(task) }); } catch (error: any) { task.status = 'failed'; destroy(task); res.status(502).json({ ok: false, error: error.message }); } });
    app.post('/api/wx-login/tasks/:taskId/code', async (req, res) => { const task = findTask(req, res); if (!task) return; try { if (!task.pending) task.pending = consumeCode(task).finally(() => { task.pending = undefined; }); await task.pending; const data = { openid: task.session.openid, app_id: TARGET_APP_ID, code: task.code, nickname: task.session.nickname || '', err_msg: 'login:ok', loginBuffer: task.loginBuffer || '', credentials: task.credentials || null }; destroy(task); res.json({ ok: true, data }); } catch (error: any) { task.status = 'failed'; destroy(task); res.status(502).json({ ok: false, error: error.message }); } });
}
module.exports = { mountWxLoginRoutes, takeIssuedWxSessionByCode };
