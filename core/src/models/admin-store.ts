export {};
const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { writeJsonFileAtomic } = require('../services/json-db');
const security = require('./auth-security');

const ADMIN_FILE: string = getDataFile('admin.json');

/**
 * 受信任设备：通过过微信验证码的浏览器，30 天内登录免二次验证。
 * id 由浏览器 localStorage 随机生成（32 hex），服务端只做比对，不参与任何密钥运算。
 */
interface TrustedDevice {
    id: string;
    label: string;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
}

interface AdminRecord {
    username: string;
    password: string;
    createdAt: number;
    mustChangePassword?: boolean;
    needsSetup?: boolean;
    trustedDevices?: TrustedDevice[];
}

/** 受信任设备有效期 */
const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 最多保留的设备数，超出按最久未用淘汰 */
const MAX_TRUSTED_DEVICES = 5;
const DEVICE_ID_RE = /^[a-f0-9]{16,64}$/i;

function normalizeDevice(raw: any): TrustedDevice | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    if (!DEVICE_ID_RE.test(id)) return null;
    const createdAt = Number(raw.createdAt) > 0 ? Number(raw.createdAt) : Date.now();
    return {
        id,
        label: String(raw.label || '未知设备').slice(0, 120),
        createdAt,
        lastSeenAt: Number(raw.lastSeenAt) > 0 ? Number(raw.lastSeenAt) : createdAt,
        expiresAt: Number(raw.expiresAt) > 0 ? Number(raw.expiresAt) : createdAt + DEVICE_TTL_MS,
    };
}

let admin: AdminRecord | null = null;

function normalizeAdmin(raw: any): AdminRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const needsSetup = raw.needsSetup === true;
    const password = String(raw.password || '');
    // 未初始化状态允许空密码；已初始化的记录必须有密码哈希
    if (!needsSetup && !password.trim()) return null;
    const devices = Array.isArray(raw.trustedDevices)
        ? raw.trustedDevices.map(normalizeDevice).filter((item: TrustedDevice | null): item is TrustedDevice => !!item)
        : [];
    return {
        username: String(raw.username || 'admin').trim() || 'admin',
        password,
        createdAt: Number(raw.createdAt) || Date.now(),
        mustChangePassword: raw.mustChangePassword === true || undefined,
        needsSetup: needsSetup || undefined,
        trustedDevices: devices.length ? devices : undefined,
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

function describeDevice(ua: string): string {
    const text = String(ua || '');
    if (!text) return '未知设备';
    const os = /Windows/i.test(text) ? 'Windows'
        : /iPhone|iPad|iOS/i.test(text) ? 'iOS'
            : /Android/i.test(text) ? 'Android'
                : /Macintosh|Mac OS/i.test(text) ? 'macOS'
                    : /Linux/i.test(text) ? 'Linux' : '';
    const browser = /Edg\//i.test(text) ? 'Edge'
        : /OPR\/|Opera/i.test(text) ? 'Opera'
            : /Firefox\//i.test(text) ? 'Firefox'
                : /Chrome\//i.test(text) ? 'Chrome'
                    : /Safari\//i.test(text) ? 'Safari' : '';
    const label = [os, browser].filter(Boolean).join(' / ');
    return label || text.slice(0, 40);
}

/** 清理过期设备，返回剩余有效设备 */
function activeDevices(): TrustedDevice[] {
    const current = loadAdmin();
    const now = Date.now();
    const devices = Array.isArray(current.trustedDevices) ? current.trustedDevices : [];
    const alive = devices.filter(item => item.expiresAt > now);
    if (alive.length !== devices.length) {
        current.trustedDevices = alive.length ? alive : undefined;
        saveAdmin();
    }
    return alive;
}

function isValidDeviceId(deviceId: unknown): boolean {
    return DEVICE_ID_RE.test(String(deviceId || '').trim());
}

/** 该设备是否已通过过二次验证（且在有效期内） */
function isTrustedDevice(deviceId: string): boolean {
    const id = String(deviceId || '').trim();
    if (!isValidDeviceId(id)) return false;
    return activeDevices().some(item => item.id === id);
}

function touchTrustedDevice(deviceId: string): void {
    const id = String(deviceId || '').trim();
    if (!isValidDeviceId(id)) return;
    const current = loadAdmin();
    const device = (current.trustedDevices || []).find(item => item.id === id);
    if (!device) return;
    const now = Date.now();
    device.lastSeenAt = now;
    device.expiresAt = now + DEVICE_TTL_MS;
    saveAdmin();
}

/** 信任一台新设备：超出上限时淘汰最久未使用的 */
function trustDevice(deviceId: string, userAgent: string): { ok: boolean; label?: string; error?: string } {
    const id = String(deviceId || '').trim();
    if (!isValidDeviceId(id)) return { ok: false, error: '设备标识无效' };
    const current = loadAdmin();
    const now = Date.now();
    const devices = activeDevices();
    const existing = devices.find(item => item.id === id);
    const label = describeDevice(userAgent);
    if (existing) {
        existing.lastSeenAt = now;
        existing.expiresAt = now + DEVICE_TTL_MS;
        existing.label = label;
    } else {
        devices.push({ id, label, createdAt: now, lastSeenAt: now, expiresAt: now + DEVICE_TTL_MS });
    }
    current.trustedDevices = devices
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .slice(0, MAX_TRUSTED_DEVICES);
    saveAdmin();
    return { ok: true, label };
}

function listTrustedDevices(): Array<{ label: string; createdAt: number; lastSeenAt: number; expiresAt: number }> {
    return activeDevices()
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .map(item => ({
            label: item.label,
            createdAt: item.createdAt,
            lastSeenAt: item.lastSeenAt,
            expiresAt: item.expiresAt,
        }));
}

/** 撤销全部受信任设备：所有浏览器下次登录都必须重新收验证码 */
function revokeTrustedDevices(): number {
    const current = loadAdmin();
    const count = (current.trustedDevices || []).length;
    if (count) {
        current.trustedDevices = undefined;
        saveAdmin();
    }
    return count;
}

/** 是否已存在任何受信任设备（用于判断「首次启用」放行） */
function hasTrustedDevices(): boolean {
    return activeDevices().length > 0;
}

loadAdmin();

module.exports = {
    getAdminInfo, isSetupPending, setupPassword, validateAdmin, changePassword,
    isTrustedDevice, touchTrustedDevice, trustDevice, listTrustedDevices,
    revokeTrustedDevices, hasTrustedDevices, isValidDeviceId, describeDevice,
};
