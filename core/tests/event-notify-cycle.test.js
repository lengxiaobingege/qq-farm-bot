const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEventNotifyService } = require('../dist/runtime/event-notify');

/**
 * 掉线周期模型：
 * 一次掉线（首次断线 → 连接恢复）最多推一条提醒，终态只补原因不补推送；
 * 推送成功才记「已提醒」，失败退避重试；周期状态落盘，重启不重复打扰。
 */
const CFG = {
    channel: 'pushplus',
    endpoint: '',
    token: 'token-1',
    secret: '',
    title: '{accountName} 已离线',
    msg: '农场连接已断开，重新扫码登录即可继续。',
    offlineDeleteSec: 0,
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createHarness(opts = {}) {
    const pushes = [];
    const logs = [];
    let sendImpl = opts.send || (async () => ({ ok: true }));
    const service = createEventNotifyService({
        store: { getEventNotify: () => CFG },
        sendPushooMessage: async (payload) => {
            pushes.push(payload);
            return sendImpl(payload, pushes.length);
        },
        log: (tag, msg) => logs.push([tag, msg]),
        offlineDeferMs: opts.offlineDeferMs ?? 20,
        offlineDedupeMs: opts.offlineDedupeMs ?? 60_000,
        stateFile: opts.stateFile === undefined ? '' : opts.stateFile,
    });
    return { pushes, logs, service, setSend: (fn) => { sendImpl = fn; } };
}

test('被挤下线走让位窗口：150 秒内不催用户', async () => {
    const h = createHarness({ offlineDeferMs: 30 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'kickout:已在其他终端登录' });
    await wait(80);

    assert.equal(h.pushes.length, 0, '让位期间属于预期行为，不能按 150 秒窗口催');
    assert.ok(h.logs.some(([, msg]) => /让位给用户/.test(msg)), '日志要写明是在让位');
    assert.ok(h.logs.some(([, msg]) => /延后 900 秒/.test(msg)), '窗口应拉长到 15 分钟');
});

test('连续被挤到暂停时立即推送，并说明无需扫码', async () => {
    const h = createHarness({ offlineDeferMs: 30 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'kickout:已在其他终端登录' });
    await wait(30);
    assert.equal(h.pushes.length, 0);

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'kickout_limit:kickout:已在其他终端登录' });
    await wait(30);

    assert.equal(h.pushes.length, 1, '暂停自动重登要立刻让用户知道');
    assert.match(String(h.pushes[0].content), /无需扫码/);
});

test('推送失败不记为已提醒：下一次终态会重新尝试并送达', async () => {
    const h = createHarness();

    // 前两次调用（首轮 + 内置重试）都失败，模拟 pushplus 报「服务端验证错误」
    h.setSend(async () => ({ ok: false, msg: '服务端验证错误' }));

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:ws_error:400' });
    await wait(40);
    assert.equal(h.pushes.length, 1, '首轮发送一次');
    await wait(2400);
    assert.equal(h.pushes.length, 2, '内置重试（2 秒后）再来一次');
    assert.ok(h.logs.some(([, msg]) => /事件通知发送失败/.test(msg)));
    assert.ok(h.logs.some(([, msg]) => /掉线提醒未送达/.test(msg)), '失败后要安排重试，而不是当已送达');

    // 恢复发送能力后，终态到达应重新尝试
    h.setSend(async () => ({ ok: true }));
    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'auto_relogin_failed:400' });
    await wait(30);

    const delivered = h.logs.filter(([, msg]) => /事件通知发送成功/.test(msg));
    assert.equal(delivered.length, 1, '失败过的提醒在终态时补发一条');
});

test('同一次掉线只推一条：终态只补原因不补推送', async () => {
    const h = createHarness({ offlineDeferMs: 20 });

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'disconnect:ws_error:400' });
    await wait(45);
    assert.equal(h.pushes.length, 1, '窗口到期推一条');

    await h.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'auto_relogin_failed:400' });
    await wait(20);

    assert.equal(h.pushes.length, 1, '终态不得再推第二条');
    assert.ok(h.logs.some(([, msg]) => /本次掉线已提醒过/.test(msg)));
});

test('恢复文案区分自动重连与扫码登录', async () => {
    const auto = createHarness({ offlineDeferMs: 20 });
    await auto.service.triggerEventNotify({ accountId: 'A', accountName: 'A号', reason: 'disconnect:ws_error:400' });
    await wait(45);
    auto.service.noteAccountRecovered('A', 'A号');
    await wait(30);
    assert.equal(auto.pushes.length, 2);
    assert.match(String(auto.pushes[1].content), /已自动重新连接/);

    const manual = createHarness({ offlineDeferMs: 20 });
    await manual.service.triggerEventNotify({ accountId: 'B', accountName: 'B号', reason: 'auto_relogin_failed:400' });
    await wait(20);
    manual.service.noteAccountRecovered('B', 'B号');
    await wait(30);
    assert.equal(manual.pushes.length, 2, '终态推送后恢复要补一条');
    assert.match(String(manual.pushes[1].content), /已通过扫码重新登录/);
});

test('掉线周期落盘：重启后同一笔掉线不再重复提醒', async () => {
    const file = path.join(os.tmpdir(), `event-notify-state-${process.pid}-${Date.now()}.json`);
    try {
        const first = createHarness({ offlineDeferMs: 20, stateFile: file });
        await first.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'auto_relogin_failed:400' });
        await wait(20);
        assert.equal(first.pushes.length, 1, '首次进程推一条');
        assert.ok(fs.existsSync(file), '周期状态应落盘');

        // 模拟重启：新进程读同一份状态
        const restarted = createHarness({ offlineDeferMs: 20, stateFile: file });
        await restarted.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'auto_relogin_failed:400' });
        await wait(20);
        assert.equal(restarted.pushes.length, 0, '重启后同一笔掉线不得重推');
        assert.ok(restarted.logs.some(([, msg]) => /已提醒过/.test(msg)));

        // 恢复后周期结束，状态清空，下一次真掉线照常提醒
        restarted.service.noteAccountRecovered('1', 'acc');
        await wait(20);
        const third = createHarness({ offlineDeferMs: 20, stateFile: file });
        await third.service.triggerEventNotify({ accountId: '1', accountName: 'acc', reason: 'auto_relogin_failed:400' });
        await wait(20);
        assert.equal(third.pushes.length, 1, '新周期应重新提醒');
    } finally {
        try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
});
