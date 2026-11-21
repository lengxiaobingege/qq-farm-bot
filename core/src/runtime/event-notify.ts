export {};

const fs = require('node:fs');
const path = require('node:path');

interface ReloginReminderOptions {
    store: any;
    sendPushooMessage: (payload: any) => Promise<any>;
    log: (tag: string, msg: string, extra?: any) => void;
    // 延迟判定窗口与恢复通知节流窗口可注入，便于测试与后续调参
    offlineDeferMs?: number;
    offlineDedupeMs?: number;
    // 掉线周期状态的落盘路径；传空串表示不落盘（测试用）
    stateFile?: string;
}

interface EventNotifyPayload {
    accountId?: string;
    accountName?: string;
    reason?: string;
    offlineMs?: number;
}

// 一次「掉线周期」= 从首次断线到连接恢复之间的全过程。
// 同一次周期内最多推一条掉线提醒：过程态负责判定，终态负责补足原因，但都不再推第二条。
interface OfflineCycle {
    accountId: string;
    accountName: string;
    startedAt: number;
    lastEventAt: number;
    reason: string;
    // 本周期使用的判定窗口：普通断线用 offlineDeferMs，被挤下线用让位窗口
    deferMs: number;
    terminal: boolean;
    noticeSent: boolean;
    noticeSentAt: number;
    retryCount: number;
}

// 掉线提醒延迟判定窗口：覆盖自动重登的 3 次重试（30s + 12s + 30s）。
// 实测 11-06 完整失败链 43 秒，加上首次重试前等待与换码耗时最坏约 92 秒，
// 因此兜底窗口取 150 秒——正常失败会在 75~90 秒由终态推送接管并清掉本定时器，
// 这里只负责「既不成功也不失败」的卡死兜底
const OFFLINE_DEFER_MS = 150 * 1000;
// 恢复通知节流：同一账号短时间内反复掉线/恢复只报一次恢复，避免来回刷屏
const OFFLINE_DEDUPE_MS = 10 * 60 * 1000;
// 「已恢复」只在真推过「已离线」之后才补发；超过这个时长仍恢复也补，
// 但隔夜或跨进程的陈旧记录不再补，避免第二天收到莫名通知
const RECOVER_NOTICE_TTL_MS = 12 * 60 * 60 * 1000;
// 掉线周期状态的保鲜期：超过这个时间仍未恢复的周期，重启后直接丢弃，不参与判定
const STALE_CYCLE_MS = 30 * 60 * 1000;
// 推送失败后的重试间隔与次数：失败不再假装已提醒，退避重试两次才放弃
const NOTICE_RETRY_DELAY_MS = 30 * 1000;
const NOTICE_MAX_RETRY = 2;
const STATE_FILE_NAME = 'event-notify-state.json';
// 被挤下线（kickout）时 bot 会主动让位 1/3/5/10 分钟，这段等待是预期行为而非故障。
// 判定窗口取让位最长档 + 5 分钟余量：让位期间静默，真的救不回来才提醒。
const KICKOUT_YIELD_DEFER_MS = 15 * 60 * 1000;

// 这些原因已经是终态，自动重登救不回来了，必须立刻推
const IMMEDIATE_REASON_PREFIXES = ['auto_relogin_failed:', 'no_session', 'offline_timeout', 'kickout_limit'];

// 主进程收到退出信号后置位：之后所有掉线提醒直接丢弃，
// 避免改代码重启被当成掉线打扰用户
let runtimeStopping = false;

function markRuntimeStopping(): void {
    runtimeStopping = true;
}

function isRuntimeStopping(): boolean {
    return runtimeStopping;
}

// 仅在测试或「取消停机」场景使用：清掉停机标记
function resetRuntimeStopping(): void {
    runtimeStopping = false;
}

function createEventNotifyService(options: ReloginReminderOptions) {
    const { store, sendPushooMessage, log } = options;
    const offlineDeferMs = Number.isFinite(options.offlineDeferMs) && (options.offlineDeferMs as number) > 0
        ? Number(options.offlineDeferMs)
        : OFFLINE_DEFER_MS;
    const offlineDedupeMs = Number.isFinite(options.offlineDedupeMs) && (options.offlineDedupeMs as number) > 0
        ? Number(options.offlineDedupeMs)
        : OFFLINE_DEDUPE_MS;

    // 推送配置问题的报错只提醒一次：账号掉线循环重试期间会反复触发提醒，
    // 同一条配置错误刷屏 error 日志没有额外价值；配置变更后允许再次提示。
    let lastConfigErrorReason = '';

    // 推送串行队列：登录提醒、神秘商人到货等可能同一刻触发，
    // pushplus 一类渠道对同 token 并发会返回「服务端验证错误」，串行后不会互相顶掉。
    let pushQueue: Promise<any> = Promise.resolve();

    // 进行中的掉线周期：key 是账号 id，连接恢复时结束并删除
    const cycles = new Map<string, OfflineCycle>();
    // 各周期的判定/重试定时器
    const cycleTimers = new Map<string, any>();
    // 恢复通知节流：账号 → 最近一次恢复通知时间
    const recoverNoticedAt = new Map<string, number>();

    function resolveStateFile(): string {
        if (options.stateFile === '') return '';
        if (options.stateFile) return options.stateFile;
        // 单元测试进程不落盘，避免把测试造的周期写进生产数据
        if (process.env.NODE_TEST_CONTEXT) return '';
        const { getDataDir } = require('../config/runtime-paths');
        return path.join(getDataDir(), STATE_FILE_NAME);
    }

    const stateFile = resolveStateFile();

    function persistState(): void {
        if (!stateFile) return;
        try {
            const data: any = { version: 1, updatedAt: Date.now(), cycles: {} };
            for (const [id, cycle] of cycles) data.cycles[id] = cycle;
            const tmp = `${stateFile}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
            fs.renameSync(tmp, stateFile);
        } catch {
            // 状态落盘失败不影响推送主流程
        }
    }

    function loadState(): void {
        if (!stateFile) return;
        try {
            if (!fs.existsSync(stateFile)) return;
            const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            const saved = raw && typeof raw === 'object' ? raw.cycles : null;
            if (!saved || typeof saved !== 'object') return;
            const now = Date.now();
            for (const [id, value] of Object.entries<any>(saved)) {
                const cycle = normalizeCycle(id, value);
                // 隔夜或长时间未更新的周期不继承，避免重启后按陈旧状态误判
                if (!cycle || now - cycle.lastEventAt > STALE_CYCLE_MS) continue;
                cycles.set(cycle.accountId, cycle);
            }
            if (cycles.size > 0) {
                log('系统', `已恢复 ${cycles.size} 个未结束的掉线周期（重启前已推送过的不再重复提醒）`);
            }
        } catch {
            // 状态文件损坏时按空状态启动
        }
    }

    function normalizeCycle(accountId: string, value: any): OfflineCycle | null {
        if (!value || typeof value !== 'object') return null;
        const startedAt = Number(value.startedAt);
        const lastEventAt = Number(value.lastEventAt) || startedAt;
        if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
        return {
            accountId: String(value.accountId || accountId),
            accountName: String(value.accountName || ''),
            startedAt,
            lastEventAt,
            reason: String(value.reason || 'unknown'),
            deferMs: Number(value.deferMs) > 0 ? Number(value.deferMs) : offlineDeferMs,
            terminal: value.terminal === true,
            noticeSent: value.noticeSent === true,
            noticeSentAt: Number(value.noticeSentAt) || 0,
            retryCount: Math.max(0, Number(value.retryCount) || 0),
        };
    }

    function enqueuePush<T>(task: () => Promise<T>): Promise<T> {
        const run = pushQueue.then(task, task);
        pushQueue = run.then(() => undefined, () => undefined);
        return run;
    }

    function reportConfigError(reason: string): void {
        if (reason === lastConfigErrorReason) return;
        lastConfigErrorReason = reason;
        log('错误', `${reason}（同一问题只提示一次，修正推送配置后会重新校验）`);
    }

    function getOfflineAutoDeleteMs(): number {
        const cfg = store.getEventNotify ? store.getEventNotify() : null;
        const sec = Math.max(0, Number.parseInt(cfg?.offlineDeleteSec, 10) || 0);
        return sec === 0 ? Infinity : sec * 1000;
    }

    function resolvePushChannel(): { ok: true; channel: string; endpoint: string; token: string; secret: string } | { ok: false; reason: string } {
        const cfg = store.getEventNotify ? store.getEventNotify() : null;
        if (!cfg) return { ok: false, reason: '未找到事件通知配置' };

        const channel = String(cfg.channel || '').trim().toLowerCase();
        const endpoint = String(cfg.endpoint || '').trim();
        const token = String(cfg.token || '').trim();
        const secret = String(cfg.secret || '').trim();
        if (!channel) return { ok: false, reason: '事件通知配置不完整' };
        if (channel === 'webhook' && !endpoint) return { ok: false, reason: 'Webhook 渠道未设置接口地址' };
        if (channel === 'dingtalk' && !endpoint && !token) return { ok: false, reason: '钉钉渠道未设置 Webhook 地址' };
        if (channel !== 'webhook' && channel !== 'dingtalk' && !token) return { ok: false, reason: '事件通知渠道未设置 Token' };
        return { ok: true, channel, endpoint, token, secret };
    }

    function renderTemplate(template: string, vars: Record<string, string>): string {
        return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
            const value = vars[key];
            return value == null ? '' : String(value);
        });
    }

    function composeTitle(baseTitle: string, accountName: string): string {
        const title = String(baseTitle || '').trim();
        const name = String(accountName || '').trim();
        if (!name || !title || title.includes(name)) return title;
        return `${title} ${name}`.trim();
    }

    // 返回是否真的送达：只有送达才允许记「已提醒」，避免失败后把真提醒吞掉
    async function sendConfiguredPush(payload: { title?: string; content?: string; accountId?: string; accountName?: string; logLabel?: string } = {}): Promise<boolean> {
        const accountId = String(payload.accountId || '').trim();
        const accountName = String(payload.accountName || '').trim();
        const baseTitle = String(payload.title || '').trim();
        const content = String(payload.content || '').trim();
        const title = composeTitle(baseTitle, accountName);
        const logLabel = String(payload.logLabel || '事件提醒').trim() || '事件提醒';
        try {
            const channelCfg = resolvePushChannel();
            if (channelCfg.ok === false) {
                reportConfigError(channelCfg.reason);
                return false;
            }
            lastConfigErrorReason = '';
            if (!title || !content) {
                log('错误', '推送标题或内容为空');
                return false;
            }
            const sendOnce = () => sendPushooMessage({
                channel: channelCfg.channel,
                endpoint: channelCfg.endpoint,
                token: channelCfg.token,
                secret: channelCfg.secret,
                title,
                content,
            });
            // 串行发送；失败（并发/瞬时校验）等 2 秒重试一次，避免提醒被静默丢掉
            const result = await enqueuePush(async () => {
                const first = await sendOnce();
                if (first?.ok) return first;
                await new Promise(resolve => setTimeout(resolve, 2000));
                return sendOnce();
            });
            if (result?.ok) {
                log('系统', `${logLabel}发送成功: ${accountName || accountId || title}`);
                return true;
            }
            log('错误', `${logLabel}发送失败: ${result?.msg || 'unknown'}`);
            return false;
        } catch (e: any) {
            log('错误', `${logLabel}发送异常: ${e.message}`);
            return false;
        }
    }

    function isImmediateReason(reason: string): boolean {
        const value = String(reason || '');
        return IMMEDIATE_REASON_PREFIXES.some(prefix => value.startsWith(prefix));
    }

    // 被挤下线不是故障，是用户自己在别处登录：让位期间不该催，窗口要给足
    function isYieldReason(reason: string): boolean {
        return String(reason || '').startsWith('kickout');
    }

    function buildOfflineMessage(payload: EventNotifyPayload): { title: string; content: string; accountId: string; accountName: string } | null {
        const accountId = String(payload.accountId || '').trim();
        const accountName = String(payload.accountName || '').trim();
        const reason = String(payload.reason || 'unknown');
        const cfg = store.getEventNotify ? store.getEventNotify() : null;
        if (!cfg) {
            log('错误', '未找到事件通知配置');
            return null;
        }
        const vars = {
            accountName: accountName || '账号',
            accountId: accountId || '',
            reason: reason || 'unknown',
        };
        const title = renderTemplate(String(cfg.title || '').trim(), vars);
        const content = renderTemplate(String(cfg.msg || '').trim(), vars);
        if (!title || !content) {
            log('错误', '事件通知配置不完整');
            return null;
        }
        return { title, content, accountId, accountName };
    }

    function clearCycleTimer(accountId: string): void {
        const timer = cycleTimers.get(accountId);
        if (timer) {
            clearTimeout(timer);
            cycleTimers.delete(accountId);
        }
    }

    function endCycle(accountId: string, logMessage?: string): OfflineCycle | null {
        const id = String(accountId || '').trim();
        if (!id) return null;
        const cycle = cycles.get(id);
        clearCycleTimer(id);
        if (!cycle) return null;
        cycles.delete(id);
        persistState();
        if (logMessage) {
            log('系统', logMessage, { accountId: id, accountName: cycle.accountName, reason: cycle.reason });
        }
        return cycle;
    }

    function scheduleRetry(cycle: OfflineCycle): void {
        if (isRuntimeStopping()) return;
        cycle.retryCount += 1;
        persistState();
        const id = cycle.accountId;
        clearCycleTimer(id);
        const timer = setTimeout(() => {
            cycleTimers.delete(id);
            const current = cycles.get(id);
            if (!current || current.noticeSent || isRuntimeStopping()) return;
            const note = current.terminal
                ? '自动重新登录未成功，需要重新扫码登录。'
                : `已等待 ${Math.round(current.deferMs / 1000)} 秒自动重登未成功，请检查账号或重新扫码。`;
            deliverNotice(current, note).catch(() => null);
        }, NOTICE_RETRY_DELAY_MS);
        if (typeof timer.unref === 'function') timer.unref();
        cycleTimers.set(id, timer);
        log('系统', `账号 ${cycle.accountName || id} 掉线提醒未送达，${Math.round(NOTICE_RETRY_DELAY_MS / 1000)} 秒后重试（第 ${cycle.retryCount} 次）`, {
            accountId: id,
            accountName: cycle.accountName,
            reason: cycle.reason,
        });
    }

    async function deliverNotice(cycle: OfflineCycle, extraNote = ''): Promise<boolean> {
        if (cycle.noticeSent) {
            // 同一次掉线周期内已经提醒过：终态到来只补日志，不再推第二条
            log('系统', `账号 ${cycle.accountName || cycle.accountId} 本次掉线已提醒过，不再重复推送`, {
                accountId: cycle.accountId,
                accountName: cycle.accountName,
                reason: cycle.reason,
            });
            return true;
        }
        const built = buildOfflineMessage({
            accountId: cycle.accountId,
            accountName: cycle.accountName,
            reason: cycle.reason,
        });
        if (!built) return false;
        const content = extraNote ? `${built.content}\n${extraNote}` : built.content;
        const ok = await sendConfiguredPush({
            title: built.title,
            content,
            accountId: built.accountId,
            accountName: built.accountName,
            logLabel: '事件通知',
        });
        if (ok) {
            cycle.noticeSent = true;
            cycle.noticeSentAt = Date.now();
            persistState();
            return true;
        }
        if (!cycle.noticeSent && cycle.retryCount < NOTICE_MAX_RETRY) scheduleRetry(cycle);
        return false;
    }

    function scheduleCycleNotice(cycle: OfflineCycle): void {
        clearCycleTimer(cycle.accountId);
        const id = cycle.accountId;
        const waitSec = Math.round(cycle.deferMs / 1000);
        const timer = setTimeout(() => {
            cycleTimers.delete(id);
            const current = cycles.get(id);
            if (!current || current.noticeSent || isRuntimeStopping()) return;
            deliverNotice(current, `已等待 ${Math.round(current.deferMs / 1000)} 秒自动重登未成功，请检查账号或重新扫码。`).catch(() => null);
        }, cycle.deferMs);
        if (typeof timer.unref === 'function') timer.unref();
        cycleTimers.set(id, timer);
        const yieldNote = isYieldReason(cycle.reason) ? '（被其他终端挤下线，先让位给用户）' : '（等待自动重登结果）';
        log('系统', `账号 ${cycle.accountName || id} 连接断开，延后 ${waitSec} 秒判定是否提醒${yieldNote}`, {
            accountId: id,
            accountName: cycle.accountName,
            reason: cycle.reason,
            deferMs: cycle.deferMs,
        });
    }

    async function triggerEventNotify(payload: EventNotifyPayload = {}): Promise<void> {
        const accountId = String(payload.accountId || '').trim();
        const accountName = String(payload.accountName || '').trim();
        const reason = String(payload.reason || 'unknown');
        try {
            if (isRuntimeStopping()) {
                log('系统', `进程正在退出，跳过掉线提醒: 账号=${accountName || accountId}, 原因=${reason}`, { accountId, accountName, reason });
                return;
            }
            log('系统', `触发事件通知: 账号=${accountName || accountId}, 原因=${reason}`, { accountId, accountName, reason });

            const now = Date.now();
            // 没有账号 id 时无法归属掉线周期，按单次判定处理
            if (!accountId) {
                const built = buildOfflineMessage(payload);
                if (!built) return;
                await sendConfiguredPush({
                    title: built.title,
                    content: built.content,
                    accountId: built.accountId,
                    accountName: built.accountName,
                    logLabel: '事件通知',
                });
                return;
            }
            let cycle = cycles.get(accountId);
            if (!cycle) {
                cycle = {
                    accountId,
                    accountName,
                    startedAt: now,
                    lastEventAt: now,
                    reason,
                    deferMs: isYieldReason(reason) ? KICKOUT_YIELD_DEFER_MS : offlineDeferMs,
                    terminal: false,
                    noticeSent: false,
                    noticeSentAt: 0,
                    retryCount: 0,
                };
                cycles.set(accountId, cycle);
            } else {
                cycle.lastEventAt = now;
                if (accountName) cycle.accountName = accountName;
                // 被挤下线：把窗口拉长到让位时长，别在 bot 主动退让时催用户
                if (isYieldReason(reason) && !cycle.noticeSent) cycle.deferMs = KICKOUT_YIELD_DEFER_MS;
                // 原因只保留首次那条，终态会单独标记，避免日志被后续抖动原因淹没
                if (isImmediateReason(reason)) cycle.terminal = true;
            }

            if (cycle.noticeSent) {
                persistState();
                log('系统', `账号 ${accountName || accountId} 本次掉线已提醒过，跳过重复推送`, {
                    accountId, accountName, reason,
                });
                return;
            }

            if (isImmediateReason(reason)) {
                // 终态：自动重登已放弃或持续离线超时，此时「需要扫码」的判断才成立
                cycle.terminal = true;
                clearCycleTimer(accountId);
                persistState();
                const terminalNote = String(reason).startsWith('kickout_limit')
                    ? '检测到账号在其他终端登录，自动重登已暂停 30 分钟让位；退出小程序后会自动恢复，无需扫码。'
                    : '自动重新登录未成功，需要重新扫码登录。';
                await deliverNotice(cycle, terminalNote);
                return;
            }

            // 过程态：先挂起，等自动重登结果再决定推不推（延迟判定）
            scheduleCycleNotice(cycle);
            persistState();
        } catch (e: any) {
            log('错误', `事件通知发送异常: ${e.message}`);
        }
    }

    // 连接已恢复：结束本次掉线周期。
    // 只有该周期真的推过「已离线」才补一条恢复通知，窗口内的抖动恢复保持静默。
    function noteAccountRecovered(accountId: string, accountName?: string, source?: 'auto' | 'manual' | string): void {
        const id = String(accountId || '').trim();
        if (!id) return;
        const cycle = endCycle(id, undefined);
        if (!cycle) return;
        const name = accountName || cycle.accountName || id;
        if (!cycle.noticeSent) {
            log('系统', `账号 ${name} 连接已恢复，取消挂起的掉线提醒（本次未推送任何通知）`, {
                accountId: id, accountName: name, reason: cycle.reason,
            });
            return;
        }
        const now = Date.now();
        if (now - cycle.noticeSentAt > RECOVER_NOTICE_TTL_MS) {
            log('系统', `账号 ${name} 已恢复在线，但掉线提醒已超过 ${Math.round(RECOVER_NOTICE_TTL_MS / 3600000)} 小时，不再补发恢复通知`, {
                accountId: id, accountName: name, reason: cycle.reason,
            });
            return;
        }
        const lastRecover = recoverNoticedAt.get(id) || 0;
        if (now - lastRecover < offlineDedupeMs) {
            log('系统', `账号 ${name} ${Math.round((now - lastRecover) / 1000)} 秒前已发过恢复通知，本次不再重复`, {
                accountId: id, accountName: name, reason: cycle.reason,
            });
            return;
        }
        recoverNoticedAt.set(id, now);
        // 恢复来源：终态（自动重登已放弃）后的恢复只可能是人工扫码，其余视为自动重连
        const recoverSource = source || (cycle.terminal ? 'manual' : 'auto');
        const minutes = Math.max(1, Math.round((now - cycle.startedAt) / 60000));
        const tail = recoverSource === 'manual'
            ? '已通过扫码重新登录。'
            : recoverSource === 'auto'
                ? '已自动重新连接。'
                : '已恢复连接。';
        Promise.resolve(sendConfiguredPush({
            title: '农场已恢复在线',
            content: `账号 ${name} 掉线约 ${minutes} 分钟后${tail}`,
            accountId: id,
            accountName: name,
            logLabel: '恢复通知',
        })).catch(() => null);
    }

    loadState();

    // 供其他模块（如会话刷新定时器）判断账号是否正处于掉线周期：
    // 掉线处理中的一切"次要提醒"都应让位给掉线通知，避免同一件事两条推送各说各话
    function getOfflineCycleState(accountId: string): { active: boolean; noticeSent: boolean; terminal: boolean; reason: string } {
        const id = String(accountId || '').trim();
        const cycle = cycles.get(id);
        if (!cycle) return { active: false, noticeSent: false, terminal: false, reason: '' };
        return {
            active: true,
            noticeSent: cycle.noticeSent,
            terminal: cycle.terminal,
            reason: cycle.reason,
        };
    }

    return { getOfflineAutoDeleteMs, triggerEventNotify, sendConfiguredPush, noteAccountRecovered, getOfflineCycleState };
}

module.exports = { createEventNotifyService, markRuntimeStopping, resetRuntimeStopping };
