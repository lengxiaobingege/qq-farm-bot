export {};
/**
 * 管理员登录相关推送。
 *
 * 与事件通知（农场掉线/恢复）共用同一套渠道配置，但用途不同：
 * 这里推的是「有人登录了面板」「验证码是 123456」这类安全事件，
 * 不参与掉线周期、不做账号级去重，送达即可。
 *
 * 刻意不复用 event-notify 的实例：那个服务随账号运行时创建，
 * 面板登录发生在账号还没起来的时候，必须能独立工作。
 */
const store = require('../models/store');
const { sendPushooMessage } = require('./push');
const { createModuleLogger } = require('./logger');

const log = createModuleLogger('admin');

function resolveChannel(): { ok: true; channel: string; endpoint: string; token: string; secret: string } | { ok: false; reason: string } {
    let cfg: any = null;
    try {
        cfg = store.getEventNotify ? store.getEventNotify() : null;
    } catch {
        cfg = null;
    }
    if (!cfg) return { ok: false, reason: '未配置事件通知渠道' };
    const channel = String(cfg.channel || '').trim().toLowerCase();
    const endpoint = String(cfg.endpoint || '').trim();
    const token = String(cfg.token || '').trim();
    const secret = String(cfg.secret || '').trim();
    if (!channel) return { ok: false, reason: '事件通知渠道未设置类型' };
    if (channel === 'webhook' && !endpoint) return { ok: false, reason: 'Webhook 渠道未设置接口地址' };
    if (channel === 'dingtalk' && !endpoint && !token) return { ok: false, reason: '钉钉渠道未设置 Webhook 地址' };
    if (channel !== 'webhook' && channel !== 'dingtalk' && !token) return { ok: false, reason: '推送渠道未设置 Token' };
    return { ok: true, channel, endpoint, token, secret };
}

/**
 * 发送一条安全通知。
 * @returns {ok:boolean, reason?:string} — ok=false 时调用方必须给出可操作的提示，
 *          不能静默吞掉（例如登录验证码发不出去会让用户卡在登录页）。
 */
async function pushSecurityMessage(title: string, content: string): Promise<{ ok: boolean; reason?: string }> {
    const channel = resolveChannel();
    if (channel.ok === false) {
        log.warn('安全通知未发送：推送渠道不可用', { reason: channel.reason });
        return { ok: false, reason: channel.reason };
    }
    const sendOnce = () => sendPushooMessage({
        channel: channel.channel,
        endpoint: channel.endpoint,
        token: channel.token,
        secret: channel.secret,
        title,
        content,
    });
    try {
        const first = await sendOnce();
        if (first?.ok) {
            log.info('安全通知发送成功', { title });
            return { ok: true };
        }
        // 渠道偶发限流/校验失败，重试一次；仍失败则如实上报
        await new Promise(resolve => setTimeout(resolve, 1500));
        const second = await sendOnce();
        if (second?.ok) {
            log.info('安全通知发送成功（重试）', { title });
            return { ok: true };
        }
        const reason = String(second?.msg || first?.msg || '推送渠道返回失败');
        log.warn('安全通知发送失败', { title, reason });
        return { ok: false, reason };
    } catch (e: any) {
        const reason = String(e?.message || e);
        log.warn('安全通知发送异常', { title, reason });
        return { ok: false, reason };
    }
}

function formatTime(ts?: number): string {
    const date = new Date(ts || Date.now());
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 登录成功通知（含是否挤掉了旧会话） */
async function notifyLoginSuccess(payload: {
    ip: string; device: string; evicted?: number; trusted?: boolean; firstTime?: boolean;
}): Promise<void> {
    const lines = [
        `时间：${formatTime()}`,
        `来源 IP：${payload.ip || '未知'}`,
        `设备：${payload.device || '未知'}`,
    ];
    if (payload.firstTime) lines.push('说明：首次在该设备登录，已自动信任（30 天免验证码）');
    else if (payload.trusted) lines.push('说明：已信任设备，免验证码登录');
    if (payload.evicted && payload.evicted > 0) {
        lines.push(`注意：本次登录已强制下线 ${payload.evicted} 个旧会话（同一时间只允许一处登录）`);
    }
    lines.push('', '如果不是你本人操作：立即改密码，并在系统设置里撤销全部受信任设备。');
    await pushSecurityMessage('【面板登录】管理员登录成功', lines.join('\n'));
}

/** 新设备登录验证码 */
async function notifyLoginCode(payload: { code: string; ip: string; device: string; ttlMs: number }): Promise<{ ok: boolean; reason?: string }> {
    const minutes = Math.max(1, Math.round(payload.ttlMs / 60000));
    const lines = [
        `验证码：${payload.code}`,
        `有效期：${minutes} 分钟`,
        `来源 IP：${payload.ip || '未知'}`,
        `设备：${payload.device || '未知'}`,
        '',
        '在登录页输入该验证码即可完成登录。',
        '如果这不是你本人操作，说明密码可能已泄露——请立即改密码。',
    ];
    return pushSecurityMessage('【登录验证码】面板新设备登录', lines.join('\n'));
}

/** 登录被锁定的告警（说明有人在爆破） */
async function notifyLoginLocked(payload: { ip: string; attempts?: number }): Promise<void> {
    const lines = [
        `时间：${formatTime()}`,
        `来源 IP：${payload.ip || '未知'}`,
        `原因：同一 IP 连续登录失败，已触发锁定`,
        '',
        '如果这不是你本人操作，说明有人在对面板做暴力破解，请确认密码强度。',
    ];
    await pushSecurityMessage('【面板安全】登录失败次数过多已锁定', lines.join('\n'));
}

module.exports = {
    pushSecurityMessage,
    notifyLoginSuccess,
    notifyLoginCode,
    notifyLoginLocked,
    formatTime,
};
