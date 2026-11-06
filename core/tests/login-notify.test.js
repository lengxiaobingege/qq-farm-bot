const assert = require('node:assert/strict');
const test = require('node:test');

/**
 * 登录成功提醒的去重规则（与 core/src/core/worker.ts 的 notifyLoginSuccess 保持一致）：
 * 扫码登录必推；自动重登恢复场景 10 分钟内最多一次。
 */
const WINDOW_MS = 10 * 60 * 1000;
function createGate() {
    let last = 0;
    return {
        shouldNotify(recovered, now) {
            if (recovered && now - last < WINDOW_MS) return false;
            last = now;
            return true;
        },
    };
}

test('扫码登录每次都推送', () => {
    const gate = createGate();
    const base = 1_700_000_000_000;
    assert.equal(gate.shouldNotify(false, base), true);
    assert.equal(gate.shouldNotify(false, base + 1000), true);
});

test('自动重登在 10 分钟窗口内只推一次', () => {
    const gate = createGate();
    const base = 1_700_000_000_000;
    assert.equal(gate.shouldNotify(true, base), true);
    assert.equal(gate.shouldNotify(true, base + 60_000), false);
    assert.equal(gate.shouldNotify(true, base + WINDOW_MS - 1), false);
    assert.equal(gate.shouldNotify(true, base + WINDOW_MS), true);
});
