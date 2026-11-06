export {};
const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { writeJsonFileAtomic } = require('../services/json-db');
const security = require('./auth-security');

const ADMIN_FILE: string = getDataFile('admin.json');

interface AdminRecord {
    username: string;
    password: string;
    createdAt: number;
    mustChangePassword?: boolean;
    needsSetup?: boolean;
}

let admin: AdminRecord | null = null;

function normalizeAdmin(raw: any): AdminRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const needsSetup = raw.needsSetup === true;
    const password = String(raw.password || '');
    // 未初始化状态允许空密码；已初始化的记录必须有密码哈希
    if (!needsSetup && !password.trim()) return null;
    return {
        username: String(raw.username || 'admin').trim() || 'admin',
        password,
        createdAt: Number(raw.createdAt) || Date.now(),
        mustChangePassword: raw.mustChangePassword === true || undefined,
        needsSetup: needsSetup || undefined,
    };
}

function saveAdmin(): void {
    ensureDataDir();
    if (!admin) return;
    // 密码哈希属敏感数据：原子写 + 0600 权限
    writeJsonFileAtomic(ADMIN_FILE, { admin }, 2, 0o600);
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
        // 首次部署：账号固定为 admin，密码留空，由用户在首次登录页自行设置
        admin = {
            username: 'admin',
            password: '',
            createdAt: Date.now(),
            needsSetup: true,
        };
        saveAdmin();
        console.log('[管理员] 已创建默认账号 admin，首次登录请在网页上自行设置密码');
    }
    return admin;
}

function getAdminInfo(): { username: string; role: 'admin'; mustChangePassword: boolean; needsSetup: boolean } {
    const current = loadAdmin();
    return {
        username: current.username,
        role: 'admin',
        mustChangePassword: current.mustChangePassword === true,
        needsSetup: current.needsSetup === true,
    };
}

function isSetupPending(): boolean {
    return loadAdmin().needsSetup === true;
}

/**
 * 首次登录设置管理员密码：仅在尚未初始化时可用，设置成功后立即生效。
 * 返回 {ok:false,error} 或管理员信息（供调用方直接签发登录令牌）。
 */
function setupPassword(newPassword: string): { ok: boolean; error?: string; message?: string; info?: any } {
    const current = loadAdmin();
    if (!current.needsSetup) return { ok: false, error: '管理员密码已设置，请直接登录' };
    const password = String(newPassword || '');
    const validation = security.validatePasswordStrength(password);
    if (!validation.valid) return { ok: false, error: validation.errors.join('；') };
    // 初始化密码额外要求：不少于 8 位，且至少包含大写、小写、数字、符号中的 3 类
    const typeCount = [/[a-z]/, /[A-Z]/, /\d/, /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/]
        .filter(re => re.test(password)).length;
    if (password.length < 8 || typeCount < 3) {
        return { ok: false, error: '密码至少 8 位，且包含大写字母、小写字母、数字、特殊符号中的至少 3 类' };
    }
    current.password = security.hashPassword(password);
    delete current.needsSetup;
    delete current.mustChangePassword;
    saveAdmin();
    console.log('[管理员] 首次设置密码完成，账号 admin 已启用');
    return { ok: true, message: '密码设置成功', info: getAdminInfo() };
}

function validateAdmin(username: string, password: string, ip: string = 'unknown'): any {
    security.loadLoginAttempts();
    const rateLimit = security.checkRateLimit(ip);
    if (!rateLimit.allowed) return { error: 'rate_limit', ...rateLimit };
    const lockout = security.checkAdminLockout(ip);
    if (lockout.locked) return { error: 'locked', ...lockout };

    const current = loadAdmin();
    if (current.needsSetup) {
        return { error: 'setup_required', message: '尚未设置管理员密码，请先在登录页完成首次设置' };
    }
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
    if (current.needsSetup) return { ok: false, error: '请先完成首次密码设置' };
    if (!security.verifyPassword(oldPassword, current.password)) return { ok: false, error: '当前密码错误' };
    const validation = security.validatePasswordStrength(newPassword);
    if (!validation.valid) return { ok: false, error: validation.errors.join('；') };
    current.password = security.hashPassword(newPassword);
    delete current.mustChangePassword;
    saveAdmin();
    return { ok: true, message: '密码修改成功' };
}

loadAdmin();

module.exports = { getAdminInfo, isSetupPending, setupPassword, validateAdmin, changePassword };
