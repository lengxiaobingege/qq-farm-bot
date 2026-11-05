export {};
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const security = require('./auth-security');

const ADMIN_FILE: string = getDataFile('admin.json');
// 初始密码一次性凭据文件：仅供查询命令读取一次，读取后立即删除
const INITIAL_PASSWORD_FILE: string = getDataFile('admin-initial-password.json');

interface AdminRecord {
    username: string;
    password: string;
    createdAt: number;
    mustChangePassword?: boolean;
}

let admin: AdminRecord | null = null;

// 生成 16 位强密码：大写/小写/数字/特殊符号各至少 1 位，其余随机填充后洗牌
function generateStrongPassword(length: number = 16): string {
    const groups = [
        'ABCDEFGHJKLMNPQRSTUVWXYZ',
        'abcdefghijkmnpqrstuvwxyz',
        '23456789',
        '#%^*+?!-_=',
    ];
    const rand = (max: number): number => crypto.randomInt(0, max);
    const chars: string[] = groups.map(g => g[rand(g.length)]);
    const all = groups.join('');
    while (chars.length < length) chars.push(all[rand(all.length)]);
    // Fisher–Yates 洗牌，避免固定位置模式
    for (let i = chars.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

function normalizeAdmin(raw: any): AdminRecord | null {
    if (!raw || typeof raw !== 'object' || !String(raw.password || '').trim()) return null;
    return {
        username: String(raw.username || 'admin').trim() || 'admin',
        password: String(raw.password),
        createdAt: Number(raw.createdAt) || Date.now(),
        mustChangePassword: raw.mustChangePassword === true || undefined,
    };
}

function saveAdmin(): void {
    ensureDataDir();
    if (!admin) return;
    fs.writeFileSync(ADMIN_FILE, JSON.stringify({ admin }, null, 2), 'utf8');
}

function loadAdmin(): AdminRecord {
    ensureDataDir();
    if (admin) return admin;
    try {
        if (fs.existsSync(ADMIN_FILE)) {
            const data = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
            admin = normalizeAdmin(data?.admin || data);
        }
    } catch {
        admin = null;
    }
    if (!admin) {
        // 首次部署：生成 16 位随机强密码，明文仅写入一次性凭据文件供查询命令读取一次
        const initialPassword = generateStrongPassword(16);
        admin = {
            username: 'admin',
            password: security.hashPassword(initialPassword),
            createdAt: Date.now(),
            mustChangePassword: true,
        };
        saveAdmin();
        try {
            fs.writeFileSync(INITIAL_PASSWORD_FILE, JSON.stringify({
                username: 'admin',
                password: initialPassword,
                createdAt: Date.now(),
            }, null, 2), { mode: 0o600 });
        } catch { /* 查询文件写失败不影响主流程 */ }
        console.log('[管理员] 已创建默认账号 admin，初始密码为 16 位随机强密码');
        console.log('[管理员] 执行 `npm run admin:password`（core 目录）可查询一次，查询后立即失效');
    }
    return admin;
}

function getAdminInfo(): { username: string; role: 'admin'; mustChangePassword: boolean } {
    const current = loadAdmin();
    return { username: current.username, role: 'admin', mustChangePassword: current.mustChangePassword === true };
}

function validateAdmin(username: string, password: string, ip: string = 'unknown'): any {
    security.loadLoginAttempts();
    const rateLimit = security.checkRateLimit(ip);
    if (!rateLimit.allowed) return { error: 'rate_limit', ...rateLimit };
    const lockout = security.checkAdminLockout(ip);
    if (lockout.locked) return { error: 'locked', ...lockout };

    const current = loadAdmin();
    if (username !== current.username || !security.verifyPassword(password, current.password)) {
        const attempt = security.recordFailedAttempt(ip);
        return attempt.locked
            ? { error: 'locked', message: attempt.message }
            : { error: 'invalid_credentials', message: `用户名或密码错误，剩余尝试次数: ${attempt.remainingAttempts}` };
    }

    security.clearFailedAttempts(ip);
    if (security.needsRehash(current.password)) {
        current.password = security.hashPassword(password);
        saveAdmin();
    }
    return getAdminInfo();
}

function changePassword(oldPassword: string, newPassword: string): { ok: boolean; error?: string; message?: string } {
    const current = loadAdmin();
    if (!security.verifyPassword(oldPassword, current.password)) return { ok: false, error: '当前密码错误' };
    const validation = security.validatePasswordStrength(newPassword);
    if (!validation.valid) return { ok: false, error: validation.errors.join('；') };
    current.password = security.hashPassword(newPassword);
    delete current.mustChangePassword;
    saveAdmin();
    return { ok: true, message: '密码修改成功' };
}

loadAdmin();

module.exports = { getAdminInfo, validateAdmin, changePassword };
