const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SESSION_FILE = path.join(os.tmpdir(), `admin-sessions-test-${process.pid}.json`);
process.env.ADMIN_SESSIONS_FILE = SESSION_FILE;

const {
    createSessionStore,
    loadSessions,
    persistSessions,
    sessionsFilePath,
    SESSION_TTL_MS,
    SESSION_MAX_MS,
} = require(path.resolve(__dirname, '../dist/controllers/admin/session-store.js'));

const DAY = 24 * 60 * 60 * 1000;

test.afterEach(() => {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
});

test('无会话文件时返回空列表', () => {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    assert.deepEqual(loadSessions(), []);
    assert.equal(sessionsFilePath(), SESSION_FILE);
});

test('默认有效期：滑动 7 天，绝对上限 30 天', () => {
    assert.equal(SESSION_TTL_MS, 7 * DAY);
    assert.equal(SESSION_MAX_MS, 30 * DAY);
});

test('签发后可跨进程恢复（重启不必重登的核心保障）', () => {
    const store = createSessionStore();
    const token = store.issue({ ip: '10.0.0.1', ua: 'Chrome/Windows' });
    assert.equal(token.length, 48);

    // 模拟服务重启：新建实例从磁盘加载
    const reloaded = createSessionStore();
    const session = reloaded.get(token);
    assert.ok(session, '重启后应能恢复会话');
    assert.equal(session.ip, '10.0.0.1');
    assert.ok(session.expiresAt > Date.now(), '恢复的会话应仍在有效期内');
    assert.ok(session.absoluteExpiresAt > session.expiresAt, '绝对上限应晚于滑动有效期');
});

test('损坏的会话文件按无会话处理，不影响启动', () => {
    fs.writeFileSync(SESSION_FILE, '{not valid json', 'utf8');
    assert.deepEqual(loadSessions(), []);
});

test('旧版 {tokens:[...]} 格式可平滑迁移', () => {
    const legacy = ['a'.repeat(32), 'b'.repeat(32)];
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ tokens: legacy, savedAt: '2026-01-01T00:00:00.000Z' }), 'utf8');
    const loaded = loadSessions();
    assert.equal(loaded.length, 2);
    assert.deepEqual(loaded.map(item => item.token), legacy);
    // 迁移后给出完整 TTL，不会一升级就把所有人踢下线
    for (const item of loaded) {
        assert.ok(item.expiresAt > Date.now());
        assert.ok(item.expiresAt - Date.now() > 6 * DAY);
    }
});

test('非法 token 与超期会话在加载时被过滤', () => {
    const now = Date.now();
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
        version: 2,
        sessions: [
            { token: 'short', createdAt: now, expiresAt: now + DAY },
            { token: 12345, createdAt: now, expiresAt: now + DAY },
            { token: 'x'.repeat(32), createdAt: now, expiresAt: now + DAY, absoluteExpiresAt: now + 30 * DAY },
            { token: 'y'.repeat(32), createdAt: now - 10 * DAY, expiresAt: now - DAY, absoluteExpiresAt: now + DAY },
        ],
    }), 'utf8');
    const loaded = loadSessions();
    assert.deepEqual(loaded.map(item => item.token), ['x'.repeat(32)]);
});

test('运行期过期：get/has 立即失效并剔除', () => {
    const store = createSessionStore();
    const token = store.issue({ ip: '10.1.1.1' });
    // 把有效期改到过去，模拟「放着不用直到过期」
    const session = store.list().find(item => item.token === token);
    session.expiresAt = Date.now() - 1000;
    assert.equal(store.has(token), false);
    assert.equal(store.size, 0, '过期会话应被剔除');
});

test('滑动续期：临近过期时访问会延长有效期', () => {
    const now = Date.now();
    const token = 's'.repeat(32);
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
        version: 2,
        sessions: [{
            token,
            createdAt: now - 6 * DAY,
            lastSeenAt: now - 6 * DAY,
            expiresAt: now + 60 * 1000,
            absoluteExpiresAt: now + 24 * DAY,
        }],
    }), 'utf8');
    const store = createSessionStore();
    const before = store.get(token).expiresAt;
    store.touch(token);
    const after = store.get(token).expiresAt;
    assert.ok(after > before, '续期后有效期应延长');
    assert.ok(after - Date.now() > 6 * DAY, '应延长到接近完整 TTL');
});

test('滑动续期不得突破绝对上限', () => {
    const now = Date.now();
    const token = 'm'.repeat(32);
    const absolute = now + 2 * 60 * 1000;
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
        version: 2,
        sessions: [{ token, createdAt: now - 29 * DAY, lastSeenAt: now - DAY, expiresAt: now + 1000, absoluteExpiresAt: absolute }],
    }), 'utf8');
    const store = createSessionStore();
    store.touch(token);
    assert.equal(store.get(token).expiresAt, absolute, '续期到绝对上限即封顶');
});

test('clearAll 清空全部会话并落盘（单会话强制/改密码用）', () => {
    const store = createSessionStore();
    store.issue({ ip: 'a' });
    store.issue({ ip: 'b' });
    assert.equal(store.size, 2);
    const removed = store.clearAll();
    assert.equal(removed, 2);
    assert.equal(store.size, 0);
    assert.deepEqual(loadSessions(), [], '清空后磁盘上也不该有残留');
});

test('delete 只移除指定会话', () => {
    const store = createSessionStore();
    const first = store.issue({ ip: 'a' });
    const second = store.issue({ ip: 'b' });
    assert.equal(store.delete(first), true);
    assert.equal(store.has(first), false);
    assert.equal(store.has(second), true);
});

test('会话数超过上限时淘汰最久未用的', () => {
    const now = Date.now();
    const sessions = Array.from({ length: 105 }, (_, i) => ({
        token: `t${i}`.padEnd(32, '0'),
        createdAt: now,
        lastSeenAt: now - i * 1000,
        expiresAt: now + DAY,
        absoluteExpiresAt: now + 30 * DAY,
        ip: '',
        ua: '',
    }));
    persistSessions(sessions);
    assert.equal(loadSessions().length, 100);
    // 最新的（lastSeenAt 最大）必须留下
    assert.ok(loadSessions().some(item => item.token === `t0`.padEnd(32, '0')));
});
