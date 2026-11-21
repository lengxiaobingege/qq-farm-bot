export {};
/**
 * 登录二次验证挑战（新版设备微信验证码）。
 *
 * 流程：密码校验通过但设备未被信任 → 生成 6 位码，通过微信推给用户，
 * 用户在登录页回填 → 校验通过才签发会话并信任该设备。
 *
 * 只存内存、不落盘：进程重启后未完成的挑战自然作废，
 * 用户重新登录一次即可（验证码本来就只有 5 分钟寿命，落盘无意义且会留敏感数据）。
 */
const crypto = require('node:crypto');

/** 验证码有效期 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** 单个挑战允许的错误次数，超过作废 */
const MAX_ATTEMPTS = 3;
/** 同 IP 同时挂起的挑战上限，防止刷爆内存与推送通道 */
const MAX_PER_IP = 3;
/** 全局上限 */
const MAX_TOTAL = 50;

interface Challenge {
    id: string;
    code: string;
    deviceId: string;
    ip: string;
    ua: string;
    createdAt: number;
    expiresAt: number;
    attempts: number;
}

const challenges: Map<string, Challenge> = new Map();

function prune(now: number): void {
    for (const [id, item] of challenges) {
        if (item.expiresAt <= now) challenges.delete(id);
    }
}

function generateCode(): string {
    // crypto.randomInt 避免 Math.random 的可预测性
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function countByIp(ip: string): number {
    let count = 0;
    for (const item of challenges.values()) {
        if (item.ip === ip) count += 1;
    }
    return count;
}

/**
 * 创建挑战。返回明文验证码，调用方负责通过推送渠道发出，
 * 且不得把验证码写进响应体或普通日志（仅推送失败时允许写本地运维日志排障）。
 */
function createChallenge(payload: { deviceId: string; ip: string; ua?: string }): { ok: boolean; error?: string; id?: string; code?: string; expiresAt?: number; ttlMs?: number } {
    const now = Date.now();
    prune(now);

    const ip = String(payload.ip || 'unknown');
    if (countByIp(ip) >= MAX_PER_IP) {
        return { ok: false, error: '验证码请求过于频繁，请稍后再试' };
    }
    if (challenges.size >= MAX_TOTAL) {
        return { ok: false, error: '系统繁忙，请稍后再试' };
    }

    const id = crypto.randomBytes(16).toString('hex');
    const code = generateCode();
    const expiresAt = now + CHALLENGE_TTL_MS;
    challenges.set(id, {
        id,
        code,
        deviceId: String(payload.deviceId || ''),
        ip,
        ua: String(payload.ua || '').slice(0, 200),
        createdAt: now,
        expiresAt,
        attempts: 0,
    });
    return { ok: true, id, code, expiresAt, ttlMs: CHALLENGE_TTL_MS };
}

function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 校验挑战。成功后挑战立即作废（一次性）。
 * 设备标识必须与创建时一致，避免挑战被搬到别的浏览器上使用。
 */
function verifyChallenge(payload: { id: string; code: string; deviceId: string; ip?: string }): { ok: boolean; error?: string; errorType?: string } {
    const now = Date.now();
    prune(now);

    const id = String(payload.id || '').trim();
    const item = challenges.get(id);
    if (!item) return { ok: false, error: '验证码已失效，请重新登录获取', errorType: 'challenge_expired' };
    if (item.expiresAt <= now) {
        challenges.delete(id);
        return { ok: false, error: '验证码已过期，请重新登录获取', errorType: 'challenge_expired' };
    }
    const deviceId = String(payload.deviceId || '').trim();
    if (item.deviceId && deviceId !== item.deviceId) {
        return { ok: false, error: '验证码与当前设备不匹配，请重新登录', errorType: 'challenge_mismatch' };
    }

    const code = String(payload.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
        return { ok: false, error: '请输入 6 位数字验证码', errorType: 'invalid_code' };
    }
    if (!safeEqual(item.code, code)) {
        item.attempts += 1;
        const remaining = MAX_ATTEMPTS - item.attempts;
        if (remaining <= 0) {
            challenges.delete(id);
            return { ok: false, error: '验证码错误次数过多，请重新登录获取新验证码', errorType: 'invalid_code' };
        }
        return { ok: false, error: `验证码错误，还可再试 ${remaining} 次`, errorType: 'invalid_code' };
    }

    challenges.delete(id);
    return { ok: true };
}

/** 作废某设备的所有挂起挑战（登录成功后清理） */
function dropChallengesForDevice(deviceId: string): number {
    const target = String(deviceId || '').trim();
    if (!target) return 0;
    let removed = 0;
    for (const [id, item] of challenges) {
        if (item.deviceId === target) {
            challenges.delete(id);
            removed += 1;
        }
    }
    return removed;
}

function pendingCount(): number {
    prune(Date.now());
    return challenges.size;
}

module.exports = {
    createChallenge,
    verifyChallenge,
    dropChallengesForDevice,
    pendingCount,
    CHALLENGE_TTL_MS,
    MAX_ATTEMPTS,
};
