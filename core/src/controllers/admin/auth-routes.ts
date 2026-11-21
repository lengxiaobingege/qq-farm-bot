import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const adminStore = require('../../models/admin-store');
const loginChallenge = require('../../models/login-challenge');
const adminNotify = require('../../services/admin-notify');

const {
    getClientIp,
    createAuthRequired,
    getAccId,
    handleApiError,
} = require('./middleware');

const adminLogger = createModuleLogger('admin');

/**
 * 新设备登录是否要求微信验证码。
 * 应急开关：ADMIN_DEVICE_VERIFY=off 时退化为「仅密码」，用于推送渠道坏掉且自己被锁在门外时救急。
 */
const DEVICE_VERIFY_ENABLED = String(process.env.ADMIN_DEVICE_VERIFY || '').trim().toLowerCase() !== 'off';

/** 设备标识来自浏览器 localStorage，服务端只做格式校验与比对 */
function normalizeDeviceId(value: unknown): string {
    const id = String(value || '').trim();
    return adminStore.isValidDeviceId(id) ? id : '';
}

function deviceIdOf(req: Request): string {
    return normalizeDeviceId((req.body && req.body.deviceId) || req.headers['x-device-id']);
}

function userAgentOf(req: Request): string {
    return String(req.headers['user-agent'] || '');
}

/**
 * 签发会话：先按「同时只允许一处登录」清掉旧会话，再发新的。
 * 返回被挤下线的数量，用于在通知里告知用户。
 */
function issueSession(ctx: AdminContext, req: Request): { token: string; evicted: number } {
    const evicted = ctx.tokens.clearAll();
    const token = ctx.tokens.issue({ ip: getClientIp(req), ua: userAgentOf(req) });
    // 旧会话的 socket 也要断，否则前端还挂在实时通道上收数据
    if (evicted && ctx.io) {
        for (const socket of ctx.io.sockets.sockets.values()) {
            socket.disconnect(true);
        }
    }
    return { token, evicted };
}

function loginPayload(token: string, info: any) {
    return {
        token,
        role: 'admin',
        user: { username: info.username },
        mustChangePassword: info.mustChangePassword === true,
    };
}

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    // 首次部署状态查询（免鉴权）：前端据此展示「设置密码」表单
    app.get('/api/setup-status', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { needsSetup: adminStore.isSetupPending() } });
    });

    // 首次登录自行设置管理员密码（免鉴权，但仅在未初始化时可用）
    app.post('/api/setup', (req: Request, res: Response) => {
        const { password } = req.body || {};
        if (!password) return res.status(400).json({ ok: false, error: '请输入要设置的密码' });
        const clientIp = getClientIp(req);
        const result = adminStore.setupPassword(String(password));
        if (!result.ok) {
            adminLogger.warn('首次设置密码失败', { error: result.error, ip: clientIp });
            return res.status(400).json({ ok: false, error: result.error });
        }
        const deviceId = deviceIdOf(req);
        if (deviceId) adminStore.trustDevice(deviceId, userAgentOf(req));
        const { token } = issueSession(ctx, req);
        adminLogger.info('管理员首次设置密码完成', { username: result.info.username, ip: clientIp });
        return res.json({ ok: true, data: loginPayload(token, result.info) });
    });

    app.post('/api/login', async (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
        }

        const clientIp = getClientIp(req);
        const deviceId = deviceIdOf(req);
        const userAgent = userAgentOf(req);
        const deviceLabel = adminStore.describeDevice(userAgent);

        const result = adminStore.validateAdmin(String(username), String(password), clientIp);
        if (result?.error) {
            const statusCode = result.error === 'rate_limit' ? 429 : result.error === 'locked' ? 423 : 401;
            adminLogger.warn('登录失败', { username, error: result.error, ip: clientIp });
            // 只在触发锁定时告警：零星输错是常态，每次都推会变成噪音
            if (result.error === 'locked') {
                adminNotify.notifyLoginLocked({ ip: clientIp }).catch(() => {});
            }
            return res.status(statusCode).json({
                ok: false,
                error: result.message,
                errorType: result.error,
                remainingMs: result.remainingMs,
            });
        }

        // ── 密码通过，进入二次验证判定 ──
        if (!DEVICE_VERIFY_ENABLED) {
            const { token, evicted } = issueSession(ctx, req);
            adminLogger.info('超级管理员登录成功（设备验证已关闭）', { username: result.username, ip: clientIp });
            adminNotify.notifyLoginSuccess({ ip: clientIp, device: deviceLabel, evicted }).catch(() => {});
            return res.json({ ok: true, data: loginPayload(token, result) });
        }

        const trusted = deviceId ? adminStore.isTrustedDevice(deviceId) : false;
        if (trusted) {
            adminStore.touchTrustedDevice(deviceId);
            const { token, evicted } = issueSession(ctx, req);
            loginChallenge.dropChallengesForDevice(deviceId);
            adminLogger.info('超级管理员登录成功（受信任设备）', { username: result.username, ip: clientIp, device: deviceLabel });
            adminNotify.notifyLoginSuccess({ ip: clientIp, device: deviceLabel, evicted, trusted: true }).catch(() => {});
            return res.json({ ok: true, data: loginPayload(token, result) });
        }

        // 引导例外：系统里没有任何受信任设备时放行一台设备做引导。
        // 覆盖两种场景：全新部署首次登录；数据迁移后设备名单为空（旧数据常带会话但没有设备记录）。
        // 迁移场景下推送渠道往往还没配置，验证码发不出去会把人锁死，所以不能要求先收到验证码。
        // 判定刻意不看活跃会话数：会话属于别的浏览器，无法证明当前设备可信。
        const bootstrap = !adminStore.hasTrustedDevices();
        if (bootstrap && ctx.tokens.size > 0) {
            adminLogger.warn("无受信任设备但存在历史会话（疑似数据迁移），已放行首台设备引导登录", {
                ip: clientIp,
                device: deviceLabel,
                sessions: ctx.tokens.size,
            });
        }
        if (bootstrap && deviceId) {
            adminStore.trustDevice(deviceId, userAgent);
            const { token, evicted } = issueSession(ctx, req);
            adminLogger.info('超级管理员登录成功（首台设备引导，已自动信任）', { username: result.username, ip: clientIp, device: deviceLabel });
            adminNotify.notifyLoginSuccess({ ip: clientIp, device: deviceLabel, evicted, firstTime: true }).catch(() => {});
            return res.json({ ok: true, data: loginPayload(token, result) });
        }

        // 其余情况：新设备 / 未带设备标识 / 设备已过期 → 必须过验证码
        const challenge = loginChallenge.createChallenge({ deviceId, ip: clientIp, ua: userAgent });
        if (challenge.ok === false) {
            adminLogger.warn('生成登录验证码失败', { ip: clientIp, error: challenge.error });
            return res.status(429).json({ ok: false, errorType: 'verify_throttled', error: challenge.error });
        }
        const pushed = await adminNotify.notifyLoginCode({
            code: String(challenge.code),
            ip: clientIp,
            device: deviceLabel,
            ttlMs: Number(challenge.ttlMs),
        });
        if (!pushed.ok) {
            // 推送发不出去时不能把用户卡死在登录页：验证码写入本地运维日志（core/data/logs，0600）
            adminLogger.warn('登录验证码推送失败，码已记入本地日志备查', {
                ip: clientIp,
                device: deviceLabel,
                challengeId: challenge.id,
                code: challenge.code,
                reason: pushed.reason,
            });
            return res.status(503).json({
                ok: false,
                errorType: 'push_failed',
                error: `验证码推送失败：${pushed.reason || '推送渠道不可用'}。请检查系统设置里的通知渠道；也可以到服务器执行「journalctl -u qq-farm-bot | grep 登录验证码」或查看 core/data/logs 下当日日志取码；若在局域网内，可直接用 http://<内网IP>:3007 完成首台设备引导`,
            });
        }
        adminLogger.info('新设备登录已发送验证码', { ip: clientIp, device: deviceLabel, challengeId: challenge.id });
        return res.json({
            ok: false,
            errorType: 'verify_required',
            challengeId: challenge.id,
            expiresIn: Number(challenge.ttlMs),
            error: '已向微信发送 6 位验证码，请回填完成登录',
        });
    });

    // 回填验证码，完成新设备登录
    app.post('/api/login/verify', (req: Request, res: Response) => {
        const { challengeId, code } = req.body || {};
        if (!challengeId || !code) {
            return res.status(400).json({ ok: false, error: '请提供验证码' });
        }
        const clientIp = getClientIp(req);
        const deviceId = deviceIdOf(req);
        const userAgent = userAgentOf(req);

        const verified = loginChallenge.verifyChallenge({
            id: String(challengeId),
            code: String(code),
            deviceId,
            ip: clientIp,
        });
        if (verified.ok === false) {
            adminLogger.warn('登录验证码校验失败', { ip: clientIp, error: verified.error });
            const status = verified.errorType === 'challenge_expired' || verified.errorType === 'challenge_mismatch' ? 410 : 401;
            return res.status(status).json({
                ok: false,
                errorType: verified.errorType,
                error: verified.error,
            });
        }

        if (!deviceId) {
            // 浏览器没带设备标识（老版本前端、或本地存储被禁用）：
            // 验证码已通过的本人就该放进来，但不能登记信任——后续每次登录仍要验证码。
            const info = adminStore.getAdminInfo();
            const { token, evicted } = issueSession(ctx, req);
            adminLogger.info('超级管理员登录成功（验证码通过，无设备标识，不登记信任）', {
                username: info.username, ip: clientIp,
            });
            adminNotify.notifyLoginSuccess({
                ip: clientIp, device: adminStore.describeDevice(userAgent), evicted, trusted: false,
            }).catch(() => {});
            return res.json({ ok: true, data: loginPayload(token, info) });
        }
        const trusted = adminStore.trustDevice(deviceId, userAgent);
        if (trusted.ok === false) {
            return res.status(400).json({ ok: false, error: trusted.error });
        }
        const info = adminStore.getAdminInfo();
        const { token, evicted } = issueSession(ctx, req);
        adminLogger.info('超级管理员登录成功（验证码通过，设备已信任）', {
            username: info.username, ip: clientIp, device: trusted.label,
        });
        adminNotify.notifyLoginSuccess({
            ip: clientIp, device: String(trusted.label || ''), evicted, trusted: true,
        }).catch(() => {});
        return res.json({ ok: true, data: loginPayload(token, info) });
    });

    app.post('/api/user/change-password', authRequired, (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }
        const result = adminStore.changePassword(String(oldPassword), String(newPassword));
        if (result.ok) {
            // 改密码后所有会话与受信任设备一并失效：旧设备必须用新密码重新过验证码
            const revoked = adminStore.revokeTrustedDevices();
            ctx.tokens.clearAll();
            if (ctx.io) {
                for (const socket of ctx.io.sockets.sockets.values()) socket.disconnect(true);
            }
            adminLogger.info('管理员密码已修改，全部会话与受信任设备已失效', { revokedDevices: revoked });
        }
        return res.json(result);
    });

    /**
     * 安全状态查询：当前会话有效期、受信任设备清单。
     * 不含设备 id（那是可用于冒用的凭证），只回显人类可读的标签与时间。
     */
    app.get('/api/user/security', authRequired, (req: Request, res: Response) => {
        const token = String((req as any).adminToken || '');
        const session = ctx.tokens.get(token);
        return res.json({
            ok: true,
            data: {
                deviceVerifyEnabled: DEVICE_VERIFY_ENABLED,
                session: session ? {
                    createdAt: session.createdAt,
                    lastSeenAt: session.lastSeenAt,
                    expiresAt: session.expiresAt,
                    absoluteExpiresAt: session.absoluteExpiresAt,
                    ip: session.ip,
                    device: adminStore.describeDevice(session.ua),
                } : null,
                devices: adminStore.listTrustedDevices(),
            },
        });
    });

    // 撤销全部受信任设备：下次登录必须重新收验证码
    app.post('/api/user/devices/revoke', authRequired, (_req: Request, res: Response) => {
        const count = adminStore.revokeTrustedDevices();
        adminLogger.info('受信任设备已全部撤销', { count });
        return res.json({ ok: true, data: { revoked: count } });
    });

    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path === '/login' || req.path === '/login/verify' || req.path === '/game-version'
            || req.path === '/setup' || req.path === '/setup-status') return next();
        return authRequired(req, res, next);
    });

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        const { clientVersion, wxClientVersion } = getRuntimeConfig();
        res.json({ ok: true, clientVersion, wxClientVersion, botVersion: version });
    });

    app.get('/api/auth/validate', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { valid: true } });
    });

    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);
            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({
                ok: true,
                data: {
                    runtime: getSchedulerRegistrySnapshot(),
                    worker: null,
                    workerError: 'DataProvider does not support scheduler status',
                },
            });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) {
            ctx.tokens.delete(token);
        }
        if (ctx.io && token) {
            for (const socket of ctx.io.sockets.sockets.values()) {
                if (String((socket.data as any).adminToken || '') === String(token)) socket.disconnect(true);
            }
        }
        res.json({ ok: true });
    });

    app.get('/api/user/me', (_req: Request, res: Response) => {
        res.json({ ok: true, data: adminStore.getAdminInfo() });
    });
}

module.exports = { mountAuthRoutes };
