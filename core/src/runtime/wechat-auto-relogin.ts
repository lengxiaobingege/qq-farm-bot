export {};

const fs = require('node:fs');
const path = require('node:path');

const {
    WX_FARM_APP_ID,
    WxLoginService,
    accountFieldsFromCredentials,
    credentialsFromAccount,
} = require('../services/wx-login/service');
const { ignoreError } = require('../utils/ignore-error');
const { createScheduler } = require('../services/scheduler');
const { isHostSleepReason } = require('../utils/host-sleep');
const { getServerTimeSec, toNum, log, sleep } = require('../utils/utils');

const DEFAULT_RETRY_DELAYS_MS = [30000, 12000, 30000];
const HOUR_MS = 60 * 60 * 1000;
// 用户要求：每小时整点主动刷新一次 access token / login buffer，不等临期
const SESSION_REFRESH_INTERVAL_MS = HOUR_MS;
// 传给底层换码的提前量，与刷新周期保持一致
const SESSION_REFRESH_AHEAD_MS = SESSION_REFRESH_INTERVAL_MS;
// 用户要求：成功后不推送，只在续期失败时提醒；想恢复「每小时一条成功提醒」改成 true 即可
const PUSH_SESSION_REFRESH_SUCCESS = false;
// 会话刷新失败提醒节流：同一账号 6 小时内只推一次。
// 连续失败（会话已废、等扫码）每小时重复推没有增量信息，还会淹没掉线通知
const REFRESH_FAIL_PUSH_THROTTLE_MS = 6 * 60 * 60 * 1000;
// 会话刷新失败预警的观察窗口：刷新失败往往在几秒后引发掉线，随后自动重登
// 约 75 秒会推一条更准确的「需要扫码」掉线通知。为此预警延迟一小段时间再推，
// 若期间账号已进入掉线周期就取消本条，避免同一次登录故障推两条。
const SESSION_FAIL_OBSERVE_MS = 20 * 1000;

interface WechatAutoReloginOptions {
    store: any;
    log: (tag: string, msg: string, extra?: any) => void;
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    startWorker: (account: any, options?: { preserveAutoRelogin?: boolean }) => boolean;
    stopWorker: (accountId: string, options?: { preserveAutoRelogin?: boolean }) => void;
    waitForWorkerExit?: (accountId: string) => Promise<void>;
    /**
     * 账号此刻是否已有活跃 worker（非停止中）。
     * 重登任务真正执行前必须复核：扫码登录成功会留下一个早已排好的定时任务，
     * 若不复核，到点就会把刚上线的连接停掉，再用已作废的 refreshToken 换码失败。
     */
    isAccountRunning?: (accountId: string) => boolean;
    triggerEventNotify: (payload: any) => void;
    /** 走事件通知渠道发送自定义消息（每小时会话续期提醒） */
    sendPush?: (payload: { title: string; content: string; accountId?: string; accountName?: string; logLabel?: string }) => Promise<void> | void;
    setTimeoutTask?: (taskName: string, delayMs: number, taskFn: () => Promise<void> | void) => any;
    clearTimeoutTask?: (taskName: string) => void;
    issueWxLoginCode?: (loginBuffer: string, appId: string, credentials?: any, aheadMs?: number) => Promise<any>;
    retryDelaysMs?: number[];
    // 让位（kickout 退避）状态落盘路径；传空串禁用，测试用
    kickoutStateFile?: string;
    /** 查询账号是否处于掉线周期（来自 event-notify）：周期内跳过会话刷新，避免重复提醒 */
    getOfflineCycleState?: (accountId: string) => { active: boolean; noticeSent: boolean; terminal: boolean; reason: string };
}

function isWechatPlatform(platform: unknown): boolean {
    const value = String(platform || '').trim().toLowerCase();
    return value === 'wx' || value === 'wechat';
}

function formatStamp(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '-';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 每小时续期是一条独立提醒：成功报一次“续上了”，失败要让人立刻知道下次可能掉线
function buildSessionRefreshPush(
    account: any,
    result: { ok: boolean; expiresAt?: number; error?: any; now?: number },
): { title: string; content: string } {
    const name = String(account?.name || account?.id || '账号');
    const now = Number(result.now || Date.now());
    const lines = [
        `账号：${name}`,
        `结果：${result.ok ? '刷新成功' : '刷新失败'}`,
        `时间：${formatStamp(now)}`,
    ];
    if (result.ok) {
        const expiresAtMs = Number(result.expiresAt || 0) * 1000;
        lines.push(`新会话有效期至：${expiresAtMs > 0 ? formatStamp(expiresAtMs) : '未知'}`);
        lines.push('说明：每小时自动续期一次，正常情况无需重新扫码');
    } else {
        lines.push(`原因：${String(result.error?.message || result.error || 'unknown')}`);
        lines.push('说明：本次续期失败，10 分钟后巡检会再试；若账号已掉线需要重新扫码');
    }
    return {
        title: result.ok ? '微信会话自动刷新成功' : '微信会话自动刷新失败',
        content: lines.join('\n'),
    };
}

function hasSavedWxSession(account: any): boolean {
    if (String(account?.loginBuffer || '').trim()) return true;
    return !!(String(account?.wxOpenId || '').trim() && String(account?.wxAccessToken || '').trim());
}

function taskName(accountId: string): string {
    return `wx_auto_relogin_${accountId}`;
}

function createWechatAutoReloginService(options: WechatAutoReloginOptions) {
    const {
        store,
        log,
        addAccountLog,
        startWorker,
        stopWorker,
        waitForWorkerExit,
        isAccountRunning,
        triggerEventNotify,
        sendPush,
        retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
        // 事件通知的掉线周期查询：掉线处理中的账号不再做会话刷新，也不重复提醒
        getOfflineCycleState,
    } = options;
    const scheduler = createScheduler('wechat_auto_relogin');
    const sessionRefreshTask = `wx_session_refresh_all`;

    function isWechatAccountNeedsRefresh(account: any): boolean {
        if (!String(account?.loginBuffer || '').trim()) return false;
        // 对齐整点：上次刷新落在哪个小时，和当前小时不同就刷新，保证每个整点最多一次
        const last = Number(account?.wxSessionRefreshedAt || 0) || Number(account?.updatedAt || 0);
        if (last <= 0) return true;
        return Math.floor(last / HOUR_MS) < Math.floor(Date.now() / HOUR_MS);
    }

    async function pushSessionRefresh(account: any, push: { title: string; content: string }): Promise<void> {
        if (typeof sendPush !== 'function') return;
        try {
            await sendPush({
                title: push.title,
                content: push.content,
                accountId: String(account?.id || ''),
                accountName: String(account?.name || ''),
                logLabel: '会话刷新提醒',
            });
        } catch (e: any) {
            log('错误', `会话刷新提醒发送异常: ${e?.message || e}`);
        }
    }

    // 会话刷新失败先观察一小段时间再决定推不推。刷新失败通常意味着会话作废，
    // 账号会在数秒内掉线、自动重登约 75 秒后由 event-notify 推「需要扫码」。
    // 若延迟期内已进入掉线周期（noticeSent 或终态），说明那条通知会覆盖本预警，
    // 直接取消，避免同一次登录故障收到两条。未注入定时器时退化为立即推送，兼容旧调用。
    function scheduleSessionFailNotice(account: any, push: { title: string; content: string }): void {
        const id = String(account?.id || '');
        const name = String(account?.name || id);
        if (typeof setTimeoutTask !== 'function') {
            void pushSessionRefresh(account, push);
            return;
        }
        const task = `wx_session_fail_notice_${id}`;
        clearTimeoutTask(task);
        setTimeoutTask(task, SESSION_FAIL_OBSERVE_MS, () => {
            const cycle = typeof getOfflineCycleState === 'function' ? getOfflineCycleState(id) : null;
            if (cycle?.active) {
                log('系统', `账号 ${name} 会话刷新失败预警已取消：已进入掉线周期，由掉线通知统一说明`, {
                    accountId: id, accountName: name, reason: cycle.reason,
                });
                // 掉线通知已覆盖：释放节流标记，账号恢复后若再独立刷新失败仍可提醒
                lastRefreshFailPushAt.delete(id);
                return;
            }
            void pushSessionRefresh(account, push);
        });
    }

    async function refreshSessionIfNeeded(account: any): Promise<void> {
        const id = String(account.id || '');
        const name = String(account.name || id);
        const loginBuffer = String(account.loginBuffer || '').trim();
        const credentials = credentialsFromAccount(account);
        if (!loginBuffer || !credentials) return;
        if (!isWechatAccountNeedsRefresh(account)) return;
        if (cancelled.has(id)) return;
        // 掉线周期进行中（含自动重登重试、让位等待）：此时会话必然失效，刷新必失败，
        // 且掉线通知已/将说明情况——再推「刷新失败」只是同一件事的第二条噪音
        const cycleState = typeof getOfflineCycleState === 'function' ? getOfflineCycleState(id) : null;
        if (cycleState?.active) {
            log('系统', `账号 ${name} 掉线处理中，跳过本轮会话刷新（掉线通知已覆盖，恢复后下一整点自动刷新）`, {
                accountId: id, accountName: name, reason: cycleState.reason,
            });
            return;
        }
        try {
            log('系统', `账号 ${name} 微信会话满 1 小时，自动刷新`, {
                accountId: id, accountName: name,
                lastRefreshedAt: Number(account.wxSessionRefreshedAt || 0),
                expiresAt: Number(account.wxExpiresAt || 0),
            });            const issued = await issueWxLoginCode(loginBuffer, WX_FARM_APP_ID, credentials, SESSION_REFRESH_AHEAD_MS);
            let code: string, nextBuffer: string, nextCredentials: any;
            if (typeof issued === 'string') {
                code = String(issued || '').trim();
                nextBuffer = loginBuffer;
                nextCredentials = credentials;
            } else {
                code = String(issued?.code || '').trim();
                nextBuffer = String(issued?.loginBuffer || loginBuffer || '').trim();
                nextCredentials = issued?.credentials || credentials;
            }
            if (!code) throw new Error('empty wx login code');
            store.addOrUpdateAccount({ id, code, ...accountFieldsFromCredentials(nextBuffer, nextCredentials) });
            log('系统', `账号 ${name} 微信会话自动刷新成功`, { accountId: id, accountName: name });
            addAccountLog('wx_session_refreshed', `账号 ${name} 微信会话自动刷新成功（每小时一次）`, id, name);
            // 刷新成功：清掉失败提醒节流，之后再次失败时第一时间可推
            lastRefreshFailPushAt.delete(id);
            // 成功不推送：每小时一条太吵，只有失败才需要人介入
            if (PUSH_SESSION_REFRESH_SUCCESS) {
                await pushSessionRefresh(account, buildSessionRefreshPush(account, {
                    ok: true,
                    expiresAt: Number(nextCredentials?.expiresAt || 0),
                }));
            }
        } catch (error: any) {
            // 刷新成功但取登录缓冲失败时，新 accessToken/refreshToken 挂在 error.credentials 上。
            // 必须立刻落盘，否则又回到「手里只有过期 accessToken」的死循环（-109 无法自愈）。
            const rotatedCredentials = error && typeof error === 'object' ? error.credentials : null;
            if (rotatedCredentials && String(rotatedCredentials.accessToken || '').trim()) {
                try {
                    store.addOrUpdateAccount({ id, ...accountFieldsFromCredentials(loginBuffer, rotatedCredentials) });
                    log('系统', `账号 ${name} 已保存刷新得到的新凭据（登录缓冲未取到，凭据不丢弃）`, {
                        accountId: id, accountName: name,
                        expiresAt: Number(rotatedCredentials.expiresAt || 0),
                    });
                } catch (persistError: any) {
                    log('错误', `账号 ${name} 保存刷新凭据失败: ${persistError?.message || persistError}`, {
                        accountId: id, accountName: name,
                    });
                }
            }
            log('错误', `账号 ${name} 微信会话自动刷新失败: ${error?.message || error}`, {
                accountId: id, accountName: name,
            });
            // 失败提醒节流：同一账号 6 小时内只推一次，连续失败不再每小时轰炸；
            // 期间只要刷新成功过一次，节流即重置
            const lastPush = lastRefreshFailPushAt.get(id) || 0;
            if (Date.now() - lastPush < REFRESH_FAIL_PUSH_THROTTLE_MS) {
                log('系统', `账号 ${name} 会话刷新失败提醒已节流（${Math.round(REFRESH_FAIL_PUSH_THROTTLE_MS / 3600000)} 小时内不再重复推送）`, {
                    accountId: id, accountName: name,
                });
                return;
            }
            lastRefreshFailPushAt.set(id, Date.now());
            scheduleSessionFailNotice(account, buildSessionRefreshPush(account, { ok: false, error }));
        }
    }

    async function refreshAllSessionsIfNeeded(): Promise<void> {
        const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
        const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
        for (const account of accounts) {
            try {
                if (!account || String(account.platform || '').toLowerCase() !== 'wx') continue;
                if (account?.wechatAutoRelogin === false) continue;
                await refreshSessionIfNeeded(account);
            } catch (err) { ignoreError('core/src/runtime/wechat-auto-relogin.ts:107', err); }
        }
    }

    // 整点对齐：每小时的第 0 分触发（+1 秒缓冲，避免边界抖动落在上一小时）
    function msUntilNextHour(now: number = Date.now()): number {
        const next = (Math.floor(now / HOUR_MS) + 1) * HOUR_MS + 1000;
        return Math.max(1000, next - now);
    }

    let hourlyRefreshStopped = false;

    function scheduleNextHourlyRefresh(): void {
        if (hourlyRefreshStopped) return;
        scheduler.setTimeoutTask(sessionRefreshTask, msUntilNextHour(), async () => {
            try {
                await refreshAllSessionsIfNeeded();
            } catch (err) {
                ignoreError('core/src/runtime/wechat-auto-relogin.ts:hourlyRefresh', err);
            } finally {
                scheduleNextHourlyRefresh();
            }
        });
    }

    function startSessionRefreshScheduler(): void {
        hourlyRefreshStopped = false;
        scheduleNextHourlyRefresh();
    }

    function stopSessionRefreshScheduler(): void {
        hourlyRefreshStopped = true;
        scheduler.clear(sessionRefreshTask);
    }
    const setTimeoutTask = options.setTimeoutTask
        || ((taskName: string, delayMs: number, taskFn: () => Promise<void> | void) => scheduler.setTimeoutTask(taskName, delayMs, taskFn));
    const clearTimeoutTask = options.clearTimeoutTask
        || ((taskName: string) => scheduler.clear(taskName));
    const wxLogin = new WxLoginService();
    const issueWxLoginCode = options.issueWxLoginCode
        || ((loginBuffer: string, appId: string, credentials?: any, aheadMs?: number) => wxLogin.issueCodeFromLoginBuffer(loginBuffer, appId, credentials, aheadMs));
    const attempts = new Map<string, number>();
    const lastRefreshFailPushAt = new Map<string, number>();
    const cancelled = new Set<string>();
    const trackedIds = new Set<string>();

    function isGloballyEnabled(): boolean {
        const settings = store.getLoginSettings ? store.getLoginSettings() : null;
        return settings?.wechatAutoRelogin !== false;
    }

    function isAccountEnabled(account: any): boolean {
        return account?.wechatAutoRelogin !== false;
    }

    function isEnabled(account?: any): boolean {
        if (!isGloballyEnabled()) return false;
        if (account && !isAccountEnabled(account)) return false;
        return true;
    }

    function findAccount(accountId: string): any {
        const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
        const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
        return accounts.find((item: any) => String(item?.id || '') === String(accountId || '')) || null;
    }

    function forget(accountId: string): void {
        const id = String(accountId || '');
        if (!id) return;
        attempts.delete(id);
        trackedIds.delete(id);
        // 重登任务结束（成功或取消）：让位截止时间失效，别影响下一次掉线
        if (kickoutYieldUntil.delete(id)) persistKickoutGuard();
    }

    function cancel(accountId: string): void {
        const id = String(accountId || '');
        if (!id) return;
        clearTimeoutTask(taskName(id));
        forget(id);
        cancelled.add(id);
    }

    function cancelAll(): void {
        stopSessionRefreshScheduler();
        for (const id of [...trackedIds]) cancel(id);
    }

    function wasCancelled(accountId: string): boolean {
        return cancelled.has(accountId);
    }

    function clearExpiredWxSession(accountId: string, accountName: string, reason: string): void {
        if (typeof store.clearWxAutoReloginSession !== 'function') return;
        store.clearWxAutoReloginSession(accountId);
        log('系统', `账号 ${accountName} 微信离线自动重新登录失败，已清除失效会话，请重新扫码`, {
            accountId,
            accountName,
            reason,
        });
        addAccountLog('wx_auto_relogin_session_cleared', `账号 ${accountName} 微信离线自动重新登录失败，已清除失效会话，请重新扫码`, accountId, accountName, { reason });
    }

    function skip(accountId: string, accountName: string, reason: string, skipReason: string): boolean {
        const id = String(accountId || '');
        const name = String(accountName || id);
        log('系统', `账号 ${name} 跳过微信离线自动重新登录：${skipReason}`, {
            accountId: id,
            accountName: name,
            reason,
            skipReason,
        });
        addAccountLog('wx_auto_relogin_skipped', `账号 ${name} 跳过微信离线自动重新登录：${skipReason}`, id, name, {
            reason,
            skipReason,
        });
        return false;
    }

    function schedule(accountId: string, accountName: string, reason: string, delayMs = 0): boolean {
        const id = String(accountId || '');
        const name = String(accountName || id);
        if (!id) return false;
        if (!isGloballyEnabled()) return skip(id, name, reason, '设置未开启');
        const account = findAccount(id);
        if (!account || !isWechatPlatform(account.platform)) return false;
        if (!isAccountEnabled(account)) return skip(id, name, reason, '该账号未开启自动重新登录');
        if (!hasSavedWxSession(account)) {
            skip(id, name, reason, '没有已保存的扫码会话，请重新微信扫码登录');
            // 完全没有会话 = 确定救不回来，立即推送，不再等掉线兜底窗口
            triggerEventNotify({ accountId: id, accountName: name, reason: `no_session:${reason}`, offlineMs: 0 });
            return false;
        }

        cancelled.delete(id);
        trackedIds.add(id);
        clearTimeoutTask(taskName(id));
        const waitMs = Math.max(0, Number(delayMs) || 0);
        log('系统', `账号 ${name} 将尝试微信离线自动重新登录`, {
            accountId: id,
            accountName: name,
            reason,
            delayMs: waitMs,
        });
        addAccountLog(
            'wx_auto_relogin_scheduled',
            `账号 ${name} 已安排微信离线自动重新登录`,
            id,
            name,
            { reason, delayMs: waitMs },
        );
        setTimeoutTask(taskName(id), waitMs, () => run(id, name, reason));
        return true;
    }

    async function run(accountId: string, accountName: string, reason: string): Promise<void> {
        const id = String(accountId || '');
        const name = String(accountName || id);
        const account = findAccount(id);
        if (wasCancelled(id) || !isEnabled(account)) {
            forget(id);
            return;
        }

        // 定时任务是掉线那一刻排下的，执行前账号可能已被扫码或手动启动拉回在线。
        // 此时必须放弃：不然会把刚建立的连接停掉，再用已作废的 refreshToken 换码，必然 -109。
        if (typeof isAccountRunning === 'function' && isAccountRunning(id)) {
            log('系统', `账号 ${name} 已在线，取消挂起的自动重新登录`, { accountId: id, accountName: name, reason });
            addAccountLog('wx_auto_relogin_skipped_online', `账号 ${name} 已在线，取消挂起的自动重新登录`, id, name, { reason });
            forget(id);
            return;
        }

        if (!account || !isWechatPlatform(account.platform)) {
            forget(id);
            return;
        }

        const loginBuffer = String(account.loginBuffer || '').trim();
        const credentials = credentialsFromAccount(account);
        if (!loginBuffer && !credentials) {
            forget(id);
            log('系统', `账号 ${name} 没有可用的微信登录会话，等待重新扫码`, { accountId: id, accountName: name, reason });
            addAccountLog('wx_auto_relogin_missing_session', `账号 ${name} 没有可用的微信登录会话，等待重新扫码`, id, name, { reason });
            // 没有会话可用 = 终态，自动重登救不回来，立即推送（no_session 前缀见 event-notify 的终态白名单）
            triggerEventNotify({ accountId: id, accountName: name, reason: `no_session:${reason}`, offlineMs: 0 });
            return;
        }

        stopWorker(id, { preserveAutoRelogin: true });
        if (typeof waitForWorkerExit === 'function') {
            await waitForWorkerExit(id);
        }
        if (wasCancelled(id) || !isEnabled(findAccount(id))) {
            forget(id);
            return;
        }
        const attempt = (attempts.get(id) || 0) + 1;
        attempts.set(id, attempt);
        log('系统', `账号 ${name} 正在通过已保存的微信扫码会话换取新 Code（第 ${attempt} 次）`, {
            accountId: id,
            accountName: name,
            reason,
            attempt,
        });

        try {
            const issued = await issueWxLoginCode(loginBuffer, WX_FARM_APP_ID, credentials);
            let code: string, nextBuffer: string, nextCredentials: any;
            if (typeof issued === 'string') {
                code = String(issued || '').trim();
                nextBuffer = loginBuffer;
                nextCredentials = credentials;
            } else {
                code = String(issued?.code || '').trim();
                nextBuffer = String(issued?.loginBuffer || loginBuffer || '').trim();
                nextCredentials = issued?.credentials || credentials;
            }
            if (!code) throw new Error('empty wx login code');
            if (wasCancelled(id) || !isEnabled(findAccount(id))) {
                forget(id);
                return;
            }
            store.addOrUpdateAccount({ id, code, ...accountFieldsFromCredentials(nextBuffer, nextCredentials) });
            const latest = findAccount(id);
            if (!latest) {
                forget(id);
                return;
            }
            if (typeof waitForWorkerExit === 'function') {
                await waitForWorkerExit(id);
            }
            if (wasCancelled(id) || !isEnabled(findAccount(id))) {
                forget(id);
                return;
            }
            const started = startWorker({ ...latest, code, loginBuffer: nextBuffer }, { preserveAutoRelogin: true });
            if (!started) throw new Error('worker start rejected');
            forget(id);
            log('系统', `账号 ${name} 微信离线自动重新登录成功`, { accountId: id, accountName: name, reason, attempt });
            addAccountLog('wx_auto_relogin_success', `账号 ${name} 微信离线自动重新登录成功`, id, name, { reason, attempt });
        } catch (error: any) {
            const message = String(error?.message || error || 'unknown error');
            log('错误', `账号 ${name} 微信离线自动重新登录失败: ${message}`, {
                accountId: id,
                accountName: name,
                reason,
                attempt,
            });
            addAccountLog('wx_auto_relogin_failed', `账号 ${name} 微信离线自动重新登录失败`, id, name, {
                reason,
                attempt,
                error: message,
            });
            if (wasCancelled(id) || attempt >= retryDelaysMs.length) {
                forget(id);
                if (!wasCancelled(id)) {
                    log('系统', `账号 ${name} 微信离线自动重新登录失败，已保留扫码会话等待下次重试`, {
                        accountId: id,
                        accountName: name,
                        reason,
                    });
                    triggerEventNotify({ accountId: id, accountName: name, reason: `auto_relogin_failed:${reason}`, offlineMs: 0 });
                }
                return;
            }
            schedule(id, name, reason, retryDelaysMs[attempt] || retryDelaysMs[retryDelaysMs.length - 1]);
        }
    }

    // 被挤下线（kickout）的让位策略：被挤一次就多让一会儿，避免 bot 与手机端互踢。
    // 阶梯 1 → 3 → 5 → 10 分钟；走到 10 分钟档仍被挤，说明用户一直在玩，暂停 30 分钟再试。
    const kickoutReloginTimes = new Map<string, number[]>();
    const KICKOUT_WINDOW_MS = 30 * 60 * 1000;
    const KICKOUT_BACKOFF_MS = [60 * 1000, 3 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
    const KICKOUT_PAUSE_MS = 30 * 60 * 1000;
    const KICKOUT_GUARD_FILE = 'kickout-guard.json';
    // 让位截止时间与计数要跨重启保留，否则重启一次就从 1 分钟重新开始，等于没有退避
    const kickoutPausedUntil = new Map<string, number>();
    // 本轮让位允许重登的最早时刻：重启会丢掉内存里的定时器，靠它把让位剩余时间补回来
    const kickoutYieldUntil = new Map<string, number>();

    function resolveKickoutStateFile(): string {
        if (options.kickoutStateFile === '') return '';
        if (options.kickoutStateFile) return options.kickoutStateFile;
        if (process.env.NODE_TEST_CONTEXT) return '';
        const { getDataDir } = require('../config/runtime-paths');
        return path.join(getDataDir(), KICKOUT_GUARD_FILE);
    }

    const kickoutStateFile = resolveKickoutStateFile();

    function persistKickoutGuard(): void {
        if (!kickoutStateFile) return;
        try {
            const guard: Record<string, { times: number[]; pausedUntil: number; yieldUntil: number }> = {};
            for (const [id, times] of kickoutReloginTimes) {
                guard[id] = {
                    times,
                    pausedUntil: Number(kickoutPausedUntil.get(id) || 0),
                    yieldUntil: Number(kickoutYieldUntil.get(id) || 0),
                };
            }
            for (const [id, until] of kickoutPausedUntil) {
                if (!guard[id]) guard[id] = { times: [], pausedUntil: until, yieldUntil: Number(kickoutYieldUntil.get(id) || 0) };
            }
            for (const [id, until] of kickoutYieldUntil) {
                if (!guard[id]) guard[id] = { times: [], pausedUntil: Number(kickoutPausedUntil.get(id) || 0), yieldUntil: until };
            }
            const tmp = `${kickoutStateFile}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: Date.now(), guard }), 'utf8');
            fs.renameSync(tmp, kickoutStateFile);
        } catch {
            // 落盘失败不影响让位判定
        }
    }

    function loadKickoutGuard(): void {
        if (!kickoutStateFile) return;
        try {
            if (!fs.existsSync(kickoutStateFile)) return;
            const raw = JSON.parse(fs.readFileSync(kickoutStateFile, 'utf8'));
            const guard = raw && typeof raw === 'object' ? raw.guard : null;
            if (!guard || typeof guard !== 'object') return;
            const now = Date.now();
            for (const [id, value] of Object.entries<any>(guard)) {
                const times = Array.isArray(value?.times)
                    ? value.times.map(Number).filter((t: number) => Number.isFinite(t) && now - t < KICKOUT_WINDOW_MS)
                    : [];
                if (times.length > 0) kickoutReloginTimes.set(id, times);
                const until = Number(value?.pausedUntil) || 0;
                if (until > now) kickoutPausedUntil.set(id, until);
                const yieldUntil = Number(value?.yieldUntil) || 0;
                if (yieldUntil > now) kickoutYieldUntil.set(id, yieldUntil);
            }
        } catch {
            // 文件损坏时按无记录处理
        }
    }

    // 让位到期后自动再试一次，避免「暂停」变成永远不上线
    function scheduleKickoutResume(accountId: string, accountName: string, until: number): void {
        const id = String(accountId || '');
        if (!id) return;
        const delay = Math.max(1000, until - Date.now());
        const resumeTask = `wx_kickout_resume_${id}`;
        clearTimeoutTask(resumeTask);
        setTimeoutTask(resumeTask, delay, () => {
            kickoutReloginTimes.delete(id);
            kickoutPausedUntil.delete(id);
            kickoutYieldUntil.delete(id);
            persistKickoutGuard();
            log('系统', `账号 ${accountName || id} 让位期结束，重新尝试自动登录`, { accountId: id, accountName });
            addAccountLog('wx_kickout_resume', `账号 ${accountName || id} 让位期结束，重新尝试自动登录`, id, accountName);
            schedule(id, accountName, 'kickout_resume', 0);
        });
    }

    function handleDisconnect(accountId: string, accountName: string, reason: string): boolean {
        if (String(reason || '').startsWith('kickout')) {
            const id = String(accountId || '');
            const name = String(accountName || id);
            const now = Date.now();
            const pausedUntil = Number(kickoutPausedUntil.get(id) || 0);
            if (pausedUntil > now) {
                return skip(id, name, reason, `仍在让位期（至 ${formatStamp(pausedUntil)}），暂不自动重登`);
            }
            const times = (kickoutReloginTimes.get(id) || []).filter((t: number) => now - t < KICKOUT_WINDOW_MS);
            times.push(now);
            if (times.length > KICKOUT_BACKOFF_MS.length) {
                // 10 分钟档之后还被挤：暂停，让位给用户，并告诉用户需要手动处理
                kickoutReloginTimes.set(id, times);
                const until = now + KICKOUT_PAUSE_MS;
                kickoutPausedUntil.set(id, until);
                kickoutYieldUntil.set(id, until);
                persistKickoutGuard();
                scheduleKickoutResume(id, name, until);
                triggerEventNotify({
                    accountId: id,
                    accountName: name,
                    reason: `kickout_limit:${reason}`,
                    offlineMs: 0,
                });
                return skip(id, name, reason, `连续被挤下线 ${times.length} 次，暂停自动重登 ${Math.round(KICKOUT_PAUSE_MS / 60000)} 分钟，请手动处理`);
            }
            kickoutReloginTimes.set(id, times);
            kickoutPausedUntil.delete(id);
            const delayMs = KICKOUT_BACKOFF_MS[times.length - 1];
            // 让位截止时间落盘：重启后仍按剩余时间等待，不会被「重新启动账号」立刻打断
            kickoutYieldUntil.set(id, now + delayMs);
            persistKickoutGuard();
            log('系统', `账号 ${name} 被其他终端挤下线，让位 ${Math.round(delayMs / 60000)} 分钟后重试（第 ${times.length} 次）`, {
                accountId: id,
                accountName: name,
                reason,
                kickoutCount: times.length,
                delayMs,
            });
            return schedule(accountId, name, reason, delayMs);
        }
        // 让位期没走完（重启会丢掉内存定时器）：把重登推到让位截止，避免刚让位就抢登录
        const remainingYieldMs = Math.max(0, Number(kickoutYieldUntil.get(String(accountId || '')) || 0) - Date.now());
        if (remainingYieldMs > 0) {
            log('系统', `账号 ${accountName || accountId} 仍在让位期，剩余 ${Math.round(remainingYieldMs / 1000)} 秒后再重登`, {
                accountId, accountName, reason, remainingYieldMs,
            });
            return schedule(accountId, accountName, reason, remainingYieldMs);
        }
        const delayMs = isHostSleepReason(reason) ? 0 : (retryDelaysMs[0] || 30000);
        return schedule(accountId, accountName, reason, delayMs);
    }

    function requestImmediate(accountId: string, accountName: string, reason = 'host_sleep'): boolean {
        if (!hasSavedWxSession(findAccount(accountId))) return false;
        return schedule(accountId, accountName, reason, 0);
    }

    startSessionRefreshScheduler();

    // 重启后继承让位状态：暂停中的重新排定时器，避免一重启就抢回登录
    loadKickoutGuard();
    for (const [id, until] of kickoutPausedUntil) {
        const account = findAccount(id);
        if (!account) continue;
        log('系统', `账号 ${account.name || id} 仍在让位期，${formatStamp(until)} 后再尝试自动登录`, {
            accountId: id,
            accountName: account.name,
            pausedUntil: until,
        });
        scheduleKickoutResume(id, String(account.name || id), until);
    }

    return {
        cancel,
        cancelAll,
        handleDisconnect,
        isEnabled,
        requestImmediate,
        refreshAllSessionsIfNeeded,
    };
}

module.exports = {
    createWechatAutoReloginService,
    buildSessionRefreshPush,
    WX_FARM_APP_ID,
};
