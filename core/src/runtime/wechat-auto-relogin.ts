export {};

const {
    WX_FARM_APP_ID,
    WxLoginService,
    accountFieldsFromCredentials,
    credentialsFromAccount,
} = require('../services/wx-login/service');
const { createScheduler } = require('../services/scheduler');
const { isHostSleepReason } = require('../utils/host-sleep');
const { getServerTimeSec, toNum, log, sleep, unixSeconds } = require('../utils/utils');

const DEFAULT_RETRY_DELAYS_MS = [30000, 12000, 30000];
const SESSION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const SESSION_REFRESH_AHEAD_MS = 10 * 60 * 1000;

interface WechatAutoReloginOptions {
    store: any;
    log: (tag: string, msg: string, extra?: any) => void;
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    startWorker: (account: any, options?: { preserveAutoRelogin?: boolean }) => boolean;
    stopWorker: (accountId: string, options?: { preserveAutoRelogin?: boolean }) => void;
    waitForWorkerExit?: (accountId: string) => Promise<void>;
    triggerOfflineReminder: (payload: any) => void;
    setTimeoutTask?: (taskName: string, delayMs: number, taskFn: () => Promise<void> | void) => any;
    clearTimeoutTask?: (taskName: string) => void;
    issueWxLoginCode?: (loginBuffer: string, appId: string, credentials?: any) => Promise<any>;
    retryDelaysMs?: number[];
}

function isWechatPlatform(platform: unknown): boolean {
    const value = String(platform || '').trim().toLowerCase();
    return value === 'wx' || value === 'wechat';
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
        triggerOfflineReminder,
        retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    } = options;
    const scheduler = createScheduler('wechat_auto_relogin');
    const sessionRefreshTask = `wx_session_refresh_all`;

    function isWechatAccountNeedsRefresh(account: any): boolean {
        const expiresAt = Number(account?.wxExpiresAt || 0);
        if (expiresAt <= 0) return false;
        return unixSeconds(Date.now() + SESSION_REFRESH_AHEAD_MS) >= expiresAt;
    }

    async function refreshSessionIfNeeded(account: any): Promise<void> {
        const id = String(account.id || '');
        const name = String(account.name || id);
        const loginBuffer = String(account.loginBuffer || '').trim();
        const credentials = credentialsFromAccount(account);
        if (!loginBuffer || !credentials) return;
        if (!isWechatAccountNeedsRefresh(account)) return;
        if (cancelled.has(id)) return;
        try {
            log('系统', `账号 ${name} 微信会话将过期，提前自动刷新`, {
                accountId: id, accountName: name, expiresAt: Number(account.wxExpiresAt || 0),
            });
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
            store.addOrUpdateAccount({ id, code, ...accountFieldsFromCredentials(nextBuffer, nextCredentials) });
            log('系统', `账号 ${name} 微信会话提前自动刷新成功`, { accountId: id, accountName: name });
            addAccountLog('wx_session_refreshed', `账号 ${name} 微信会话提前自动刷新成功`, id, name);
        } catch (error: any) {
            log('错误', `账号 ${name} 微信会话提前自动刷新失败: ${error?.message || error}`, {
                accountId: id, accountName: name,
            });
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
            } catch {}
        }
    }

    function startSessionRefreshScheduler(): void {
        scheduler.setIntervalTask(sessionRefreshTask, SESSION_REFRESH_INTERVAL_MS, async () => {
            const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
            const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
            for (const account of accounts) {
                try {
                    if (!account || String(account.platform || '').toLowerCase() !== 'wx') continue;
                    if (account?.wechatAutoRelogin === false) continue;
                    await refreshSessionIfNeeded(account);
                } catch {}
            }
        }, { preventOverlap: true });
    }

    function stopSessionRefreshScheduler(): void {
        scheduler.clear(sessionRefreshTask);
    }
    const setTimeoutTask = options.setTimeoutTask
        || ((taskName: string, delayMs: number, taskFn: () => Promise<void> | void) => scheduler.setTimeoutTask(taskName, delayMs, taskFn));
    const clearTimeoutTask = options.clearTimeoutTask
        || ((taskName: string) => scheduler.clear(taskName));
    const wxLogin = new WxLoginService();
    const issueWxLoginCode = options.issueWxLoginCode
        || ((loginBuffer: string, appId: string, credentials?: any) => wxLogin.issueCodeFromLoginBuffer(loginBuffer, appId, credentials));
    const attempts = new Map<string, number>();
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
        if (!hasSavedWxSession(account)) return skip(id, name, reason, '没有已保存的扫码会话，请重新微信扫码登录');

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
            triggerOfflineReminder({ accountId: id, accountName: name, reason, offlineMs: 0 });
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
                    triggerOfflineReminder({ accountId: id, accountName: name, reason: `auto_relogin_failed:${reason}`, offlineMs: 0 });
                }
                return;
            }
            schedule(id, name, reason, retryDelaysMs[attempt] || retryDelaysMs[retryDelaysMs.length - 1]);
        }
    }

    function handleDisconnect(accountId: string, accountName: string, reason: string): boolean {
        const delayMs = isHostSleepReason(reason) ? 0 : (retryDelaysMs[0] || 30000);
        return schedule(accountId, accountName, reason, delayMs);
    }

    function requestImmediate(accountId: string, accountName: string, reason = 'host_sleep'): boolean {
        if (!hasSavedWxSession(findAccount(accountId))) return false;
        return schedule(accountId, accountName, reason, 0);
    }

    startSessionRefreshScheduler();

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
    WX_FARM_APP_ID,
};
