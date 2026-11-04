const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SESSION_FILE = path.join(os.tmpdir(), `admin-sessions-test-${process.pid}.json`);
process.env.ADMIN_SESSIONS_FILE = SESSION_FILE;

const { loadSessions, saveSessions, sessionsFilePath } = require(
    path.resolve(__dirname, '../dist/controllers/admin/session-store.js'),
);

test.afterEach(() => {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
});

test('无会话文件时返回空列表', () => {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    assert.deepEqual(loadSessions(), []);
    assert.equal(sessionsFilePath(), SESSION_FILE);
});

test('保存后可完整恢复（重启恢复会话的核心保障）', () => {
    const tokens = ['a'.repeat(32), 'b'.repeat(32)];
    saveSessions(tokens);
    assert.deepEqual(loadSessions(), tokens);
});

test('损坏的会话文件按无会话处理，不影响启动', () => {
    fs.writeFileSync(SESSION_FILE, '{not valid json', 'utf8');
    assert.deepEqual(loadSessions(), []);
});

test('非法 token（非字符串/过短）被过滤，且数量有上限', () => {
    const junk = ['short', 123, null, 'x'.repeat(32)];
    saveSessions(junk);
    const loaded = loadSessions();
    assert.deepEqual(loaded, ['x'.repeat(32)]);
    const overflow = Array.from({ length: 150 }, (_, i) => `t${i}`.padEnd(32, '0'));
    saveSessions(overflow);
    assert.equal(loadSessions().length, 100);
});
