export {};
/**
 * 管理面板会话令牌持久化。
 *
 * 此前 token 只存在内存 Set 中，服务重启（重新发布/崩溃/机器掉线）后全部失效，
 * 浏览器里保存的 token 会被判无效踢回登录页，表现为「会话不保存、自动登录没效果」。
 * 这里把有效 token 集合落盘到数据目录，启动时自动恢复。
 *
 * 安全说明：token 是随机凭证，文件写入 core/data/（与其他敏感运行数据同级，
 * 不入库、不随仓库分发），权限 0600；修改管理员密码时仍会清空全部会话。
 */
const fs = require('node:fs');
const path = require('node:path');
const { ensureDataDir } = require('../../config/runtime-paths');
const { ignoreError } = require('../../utils/ignore-error');

const SESSIONS_FILE = 'admin-sessions.json';
const MAX_SESSIONS = 100;

function sessionsFilePath(): string {
    // 允许测试通过环境变量重定向文件位置，避免污染真实数据目录
    if (process.env.ADMIN_SESSIONS_FILE) return process.env.ADMIN_SESSIONS_FILE;
    return path.join(ensureDataDir(), SESSIONS_FILE);
}

function isValidToken(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 16;
}

function loadSessions(): string[] {
    try {
        const raw = fs.readFileSync(sessionsFilePath(), 'utf8');
        const parsed = JSON.parse(raw);
        const tokens = parsed && Array.isArray(parsed.tokens) ? parsed.tokens : [];
        return tokens.filter(isValidToken).slice(0, MAX_SESSIONS);
    } catch (err: any) {
        // 文件不存在或损坏都视为无历史会话，不影响启动
        if (err && err.code !== 'ENOENT') {
            ignoreError('session-store.loadSessions: 读取会话文件失败，按无会话处理', err);
        }
        return [];
    }
}

function saveSessions(tokens: Iterable<string>): void {
    try {
        const list = Array.from(tokens).filter(isValidToken).slice(0, MAX_SESSIONS);
        const payload = JSON.stringify({ tokens: list, savedAt: new Date().toISOString() }, null, 2);
        fs.writeFileSync(sessionsFilePath(), payload, { mode: 0o600 });
    } catch (err) {
        // 写盘失败不阻塞登录/登出主流程，仅记录以便排查
        ignoreError('session-store.saveSessions: 会话文件写入失败', err);
    }
}

module.exports = { loadSessions, saveSessions, sessionsFilePath };
