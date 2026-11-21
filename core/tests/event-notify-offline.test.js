const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createEventNotifyService,
    markRuntimeStopping,
    resetRuntimeStopping,
} = require('../dist/runtime/event-notify');

/**
 * 掉线提醒的延迟判定（方案 A）：
 * 断线先挂起，等自动重登结果再决定推不推；
 * 只有终态（重登彻底失败 / 无可用会话 / 离线超时）才立即推。
 */
function createHarness(opts = {}) {
    const pushes = [];
    const logs = [];
    const cfg = {
        channel: 'pushplus',
        endpoint: '',
        token: 'token-1',
        secret: '',
        title: '{accountName} 已离线',
        msg: '农场连接已断开，重新扫码登录即可继续。',
        offlineDeleteSec: 0,
    };
    const store = { getEventNotify: () => cfg };
    const service = createEventNotifyService({
        store,
        sendPushooMessage: async (payload) => {
            pushes.push(payload);
            return { ok: true };
        },
        log: (tag, msg) => logs.push([tag, msg]),
        offlineDeferMs: opts.offlineDeferMs ?? 30,
        offlineDedupeMs: opts.offlineDedupeMs ?? 60_000,
    });
    return { pushes, logs, service, cfg };
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('disconnect defers the offline push until the window expires', async () => {
    const h = createHarness({ offlineDeferMs: 300 });

    await h.service.triggerEventNotify({
        accountId: '1',
        accountName: 'acc',
        reason: 'disconnect:ws_error:connecting:400',
    });
    assert.equal(h.pushes.length, 0, '断线瞬间不应推送');

    await wait(100);
    assert.equal(h.pushes.length, 0, '窗口内不应推送');

    await wait(400);
    assert.equal(h.pushes.length, 1, '窗口到期推一条');
    assert.match(h.pushes[0].title, /已离线/);
    assert.match(h.pushes[0].content, /自动重登未成功/);
});

test('recovering inside the window cancels the offline push', async () => {
    const h = createHarness({ offlineDeferMs: 300 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:ws_close:ready:1006' });
    await wait(60);
    h.service.noteAccountRecovered('1', 'acc');
    await wait(450);

    assert.equal(h.pushes.length, 0, '已恢复在线就不该再提「已离线」');
    assert.ok(h.logs.some(([, msg]) => /取消挂起的掉线提醒（本次未推送任何通知）/.test(msg)));
});

test('terminal relogin failure pushes immediately and replaces the pending one', async () => {
    const h = createHarness({ offlineDeferMs: 300 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:ws_error:connecting:400' });
    await h.service.triggerEventNotify({
        accountId: '1',
        accountName: 'acc',
        reason: 'auto_relogin_failed:disconnect:ws_error:connecting:400',
    });

    assert.equal(h.pushes.length, 1, '终态应立即推一条');
    await wait(400);
    assert.equal(h.pushes.length, 1, '原本挂起的那条已被取消，不能重复推');
});

test('same-category offline reason is deduped within the window', async () => {
    const h = createHarness({ offlineDeferMs: 150, offlineDedupeMs: 500 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:a' });
    await wait(250);
    assert.equal(h.pushes.length, 1);

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:b' });
    await wait(250);
    assert.equal(h.pushes.length, 1, '同类掉线 500ms 内只提醒一次');
});

test('missing session is terminal and pushes right away', async () => {
    const h = createHarness({ offlineDeferMs: 5_000 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'no_session:disconnect:ws_close:ready:1006' });

    assert.equal(h.pushes.length, 1, '没有可重登的会话，不必等窗口');
});

test('a late process-level disconnect does not reschedule after a terminal push', async () => {
    const h = createHarness({ offlineDeferMs: 150, offlineDedupeMs: 500 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'no_session:ws_error:400' });
    assert.equal(h.pushes.length, 1, '终态立即推一条');

    // 终态之后晚到的过程态消息：不能重新挂起，否则窗口到期会再喊一次
    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:ws_error:connecting:400' });
    await wait(300);
    assert.equal(h.pushes.length, 1, '已提醒过就不该再挂起推送');
});

test('runtime stopping suppresses every offline push', async () => {
    const h = createHarness({ offlineDeferMs: 150 });

    markRuntimeStopping();
    try {
        await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:shutdown' });
        await wait(300);
        assert.equal(h.pushes.length, 0, '主动停机/重启不应打扰用户');
    } finally {
        resetRuntimeStopping();
    }
});

test('recovery after a delivered offline notice sends one recovery notice', async () => {
    const h = createHarness({ offlineDeferMs: 150, offlineDedupeMs: 500 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:ws_error:400' });
    await wait(250);
    assert.equal(h.pushes.length, 1, '窗口到期先推掉线');

    h.service.noteAccountRecovered('1', 'acc');
    await wait(150);
    assert.equal(h.pushes.length, 2, '真掉过线并恢复后补一条闭环通知');
    assert.match(String(h.pushes[1].title || ''), /恢复在线/);
    assert.match(String(h.pushes[1].content || ''), /掉线约/);

    // 同一次掉线只补一条：再次调用恢复不能重复推
    h.service.noteAccountRecovered('1', 'acc');
    await wait(150);
    assert.equal(h.pushes.length, 2, '恢复通知不能重复');
});

test('recovery without a prior offline notice stays silent', async () => {
    const h = createHarness({ offlineDeferMs: 300 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:ws_error:400' });
    h.service.noteAccountRecovered('1', 'acc');
    await wait(100);

    assert.equal(h.pushes.length, 0, '窗口内恢复属于短暂抖动，不该补恢复通知');
});
