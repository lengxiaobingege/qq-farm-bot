export {};
/**
 * 管理面板会话令牌持久化 + 生命周期管理。
 *
 * 此前 token 只存内存 Set，服务重启（重新发布/崩溃/机器掉线）后全部失效，
 * 浏览器里保存的 token 会被判无效踢回登录页，表现为「会话不保存、自动登录没效果」。
 * 后来改成落盘，但**没有过期时间**：一旦 token 从浏览器存储、日志或抓包里漏出，
 * 就是永久有效的后门，除非改密码或重启。
 *
 * 现在改为带生命周期的会话：
 * - 滑动过期：每次带 token 访问即续期，TTL 默认 7 天（ADMIN_SESSION_TTL_MS 可调）
 * - 绝对上限：无论怎么续期，自发证起 30 天后必须重登（ADMIN_SESSION_MAX_MS 可调）
 * - 续期写盘做节流：同一会话 5 分钟内只落盘一次，避免每个请求都写文件
 *
 * 文件仍在 core/data/（0600、不入库、不随仓库分发）；修改管理员密码时清空全部会话。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureDataDir } = require('../../config/runtime-paths');
const { ignoreError } = require('../../utils/ignore-error');

const SESSIONS_FILE = 'admin-sessions.json';
const MAX_SESSIONS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function readDurationEnv(name: string, fallback: number, min: number): number {
    const raw = Number(process.env[name]);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.max(min, Math.trunc(raw));
}

/** 滑动有效期：多久不用就失效 */
const SESSION_TTL_MS = readDurationEnv('ADMIN_SESSION_TTL_MS', 7 * DAY_MS, 60 * 1000);
/** 绝对有效期：自发证起最多活这么久，防止无限续期 */
const SESSION_MAX_MS = readDurationEnv('ADMIN_SESSION_MAX_MS', 30 * DAY_MS, SESSION_TTL_MS);
/** 续期落盘节流窗口 */
const PERSIST_THROTTLE_MS = 5 * 60 * 1000;

interface AdminSession {
    token: string;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    absoluteExpiresAt: number;
    ip: string;
    ua: string;
}

function sessionsFilePath(): string {
    // 允许测试通过环境变量重定向文件位置，避免污染真实数据目录
    if (process.env.ADMIN_SESSIONS_FILE) return process.env.ADMIN_SESSIONS_FILE;
    return path.join(ensureDataDir(), SESSIONS_FILE);
}

function isValidToken(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 16;
}

function clampText(value: unknown, max: number): string {
    const text = String(value == null ? '' : value).trim();
    return text.length > max ? text.slice(0, max) : text;
}

function normalizeSession(raw: any, now: number): AdminSession | null {
    if (!raw || typeof raw !== 'object') return null;
    const token = String(raw.token || '');
    if (!isValidToken(token)) return null;
    const createdAt = Number(raw.createdAt) > 0 ? Number(raw.createdAt) : now;
    const absoluteExpiresAt = Number(raw.absoluteExpiresAt) > 0
        ? Number(raw.absoluteExpiresAt)
        : Math.min(createdAt + SESSION_MAX_MS, now + SESSION_MAX_MS);
    const lastSeenAt = Number(raw.lastSeenAt) > 0 ? Number(raw.lastSeenAt) : createdAt;
    const expiresAt = Number(raw.expiresAt) > 0
        ? Math.min(Number(raw.expiresAt), absoluteExpiresAt)
        : Math.min(lastSeenAt + SESSION_TTL_MS, absoluteExpiresAt);
    return {
        token,
        createdAt,
        lastSeenAt,
        expiresAt,
        absoluteExpiresAt,
        ip: clampText(raw.ip, 64),
        ua: clampText(raw.ua, 200),
    };
}

/**
 * 读取会话。兼容两代格式：
 * - 旧：{ tokens: ["a","b"] }，无时间信息 → 视为刚签发，给定完整 TTL 继续平滑迁移
 * - 新：{ sessions: [{ token, createdAt, ... }] }
 */
function loadSessions(): AdminSession[] {
    const now = Date.now();
    try {
        const raw = fs.readFileSync(sessionsFilePath(), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.sessions)) {
            return parsed.sessions
                .map((item: any) => normalizeSession(item, now))
                .filter((item: AdminSession | null): item is AdminSession => !!item && item.expiresAt > now)
                .slice(0, MAX_SESSIONS);
        }
        if (parsed && Array.isArray(parsed.tokens)) {
            return parsed.tokens
                .filter(isValidToken)
                .slice(0, MAX_SESSIONS)
                .map((token: string): AdminSession => ({
                    token,
                    createdAt: now,
                    lastSeenAt: now,
                    expiresAt: Math.min(now + SESSION_TTL_MS, now + SESSION_MAX_MS),
                    absoluteExpiresAt: now + SESSION_MAX_MS,
                    ip: '',
                    ua: '',
                }));
        }
        return [];
    } catch (err: any) {
        // 文件不存在或损坏都视为无历史会话，不影响启动
        if (err && err.code !== 'ENOENT') {
            ignoreError('session-store.loadSessions: 读取会话文件失败，按无会话处理', err);
        }
        return [];
    }
}

function persistSessions(sessions: AdminSession[]): void {
    try {
        const now = Date.now();
        const list = sessions
            .filter(item => item && isValidToken(item.token) && item.expiresAt > now)
            .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
            .slice(0, MAX_SESSIONS);
        const payload = JSON.stringify({
            version: 2,
            sessions: list,
            savedAt: new Date(now).toISOString(),
        }, null, 2);
        fs.writeFileSync(sessionsFilePath(), payload, { mode: 0o600 });
    } catch (err) {
        // 写盘失败不阻塞登录/登出主流程，仅记录以便排查
        ignoreError('session-store.persistSessions: 会话文件写入失败', err);
    }
}

class AdminSessionStore {
    private sessions: Map<string, AdminSession> = new Map();
    private lastPersistAt = 0;
    private dirty = false;

    constructor(initial: AdminSession[] = []) {
        for (const item of initial) this.sessions.set(item.token, item);
    }

    /** 鉴权用：过期立即剔除并返回 null */
    get(token: string): AdminSession | null {
        const session = this.sessions.get(String(token || ''));
        if (!session) return null;
        const now = Date.now();
        if (session.expiresAt <= now) {
            this.sessions.delete(session.token);
            this.dirty = true;
            this.persist(true);
            return null;
        }
        return session;
    }

    has(token: string): boolean {
        return !!this.get(token);
    }

    /** 滑动续期：只在超过节流窗口时写盘 */
    touch(token: string): void {
        const session = this.sessions.get(String(token || ''));
        if (!session) return;
        const now = Date.now();
        const nextExpires = Math.min(now + SESSION_TTL_MS, session.absoluteExpiresAt);
        if (nextExpires <= session.expiresAt) return;
        session.lastSeenAt = now;
        session.expiresAt = nextExpires;
        this.dirty = true;
        this.persist(false);
    }

    /** 签发新会话。ip/ua 仅用于审计展示，不参与鉴权 */
    issue(meta: { ip?: string; ua?: string } = {}): string {
        const token = crypto.randomBytes(24).toString('hex');
        const now = Date.now();
        this.sessions.set(token, {
            token,
            createdAt: now,
            lastSeenAt: now,
            expiresAt: Math.min(now + SESSION_TTL_MS, now + SESSION_MAX_MS),
            absoluteExpiresAt: now + SESSION_MAX_MS,
            ip: clampText(meta.ip, 64),
            ua: clampText(meta.ua, 200),
        });
        this.dirty = true;
        this.persist(true);
        this.enforceLimit();
        return token;
    }

    delete(token: string): boolean {
        const removed = this.sessions.delete(String(token || ''));
        if (removed) {
            this.dirty = true;
            this.persist(true);
        }
        return removed;
    }

    /** 清空全部会话（改密码、单会话强制下线时用），返回被清数量 */
    clearAll(): number {
        const count = this.sessions.size;
        if (count) {
            this.sessions.clear();
            this.dirty = true;
            this.persist(true);
        }
        return count;
    }

    clear(): void {
        this.clearAll();
    }

    get size(): number {
        this.prune();
        return this.sessions.size;
    }

    keys(): string[] {
        this.prune();
        return Array.from(this.sessions.keys());
    }

    list(): AdminSession[] {
        this.prune();
        return Array.from(this.sessions.values());
    }

    /** 清理过期会话，返回清理数量 */
    prune(): number {
        const now = Date.now();
        let removed = 0;
        for (const [token, session] of this.sessions) {
            if (session.expiresAt <= now) {
                this.sessions.delete(token);
                removed += 1;
            }
        }
        if (removed) {
            this.dirty = true;
            this.persist(true);
        }
        return removed;
    }

    /** 无条件落盘一次（启动迁移用） */
    markDirtyAndPersist(): void {
        this.dirty = true;
        this.persist(true);
    }

    /** 写盘：force=false 时遵守节流窗口 */
    persist(force: boolean): void {        if (!this.dirty) return;
        const now = Date.now();
        if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
        this.lastPersistAt = now;
        this.dirty = false;
        persistSessions(Array.from(this.sessions.values()));
    }

    private enforceLimit(): void {
        if (this.sessions.size <= MAX_SESSIONS) return;
        const sorted = Array.from(this.sessions.values()).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
        const overflow = this.sessions.size - MAX_SESSIONS;
        for (let i = 0; i < overflow; i += 1) this.sessions.delete(sorted[i].token);
        this.persist(true);
    }
}

function createSessionStore(): AdminSessionStore {
    const store = new AdminSessionStore(loadSessions());
    // 启动即落盘一次：把旧版 {tokens:[...]} 就地转成带生命周期的结构，
    // 顺便清掉已过期的记录，避免磁盘上长期留着无法判龄的裸令牌。
    store.markDirtyAndPersist();
    return store;
}

module.exports = {
    AdminSessionStore,
    createSessionStore,
    loadSessions,
    persistSessions,
    sessionsFilePath,
    SESSION_TTL_MS,
    SESSION_MAX_MS,
};
