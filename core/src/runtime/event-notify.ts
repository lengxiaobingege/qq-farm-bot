export {};

interface ReloginReminderOptions {
    store: any;
    sendPushooMessage: (payload: any) => Promise<any>;
    log: (tag: string, msg: string, extra?: any) => void;
}

interface EventNotifyPayload {
    accountId?: string;
    accountName?: string;
    reason?: string;
    offlineMs?: number;
}

function createEventNotifyService(options: ReloginReminderOptions) {
    const { store, sendPushooMessage, log } = options;

    // 推送配置问题的报错只提醒一次：账号掉线循环重试期间会反复触发提醒，
    // 同一条配置错误刷屏 error 日志没有额外价值；配置变更后允许再次提示。
    let lastConfigErrorReason = '';

    // 推送串行队列：登录提醒、神秘商人到货等可能同一刻触发，
    // pushplus 一类渠道对同 token 并发会返回「服务端验证错误」，串行后不会互相顶掉。
    let pushQueue: Promise<any> = Promise.resolve();

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

    async function sendConfiguredPush(payload: { title?: string; content?: string; accountId?: string; accountName?: string; logLabel?: string } = {}): Promise<void> {
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
                return;
            }
            lastConfigErrorReason = '';
            if (!title || !content) {
                log('错误', '推送标题或内容为空');
                return;
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
            } else {
                log('错误', `${logLabel}发送失败: ${result?.msg || 'unknown'}`);
            }
        } catch (e: any) {
            log('错误', `${logLabel}发送异常: ${e.message}`);
        }
    }

    async function triggerEventNotify(payload: EventNotifyPayload = {}): Promise<void> {
        try {
            const accountId = String(payload.accountId || '').trim();
            const accountName = String(payload.accountName || '').trim();
            const reason = String(payload.reason || 'unknown');
            log('系统', `触发事件通知: 账号=${accountName || accountId}, 原因=${reason}`, { accountId, accountName, reason });

            const cfg = store.getEventNotify ? store.getEventNotify() : null;
            if (!cfg) {
                log('错误', '未找到事件通知配置');
                return;
            }

            const vars = {
                accountName: accountName || '账号',
                accountId: accountId || '',
                reason: reason || 'unknown',
            };
            const baseTitle = renderTemplate(String(cfg.title || '').trim(), vars);
            const content = renderTemplate(String(cfg.msg || '').trim(), vars);
            if (!baseTitle || !content) {
                log('错误', '事件通知配置不完整');
                return;
            }

            await sendConfiguredPush({ title: baseTitle, content, accountId, accountName, logLabel: '事件通知' });
        } catch (e: any) {
            log('错误', `事件通知发送异常: ${e.message}`);
        }
    }

    return { getOfflineAutoDeleteMs, triggerEventNotify, sendConfiguredPush };
}

module.exports = { createEventNotifyService };
