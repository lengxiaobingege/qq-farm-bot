const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSettleReminder, beijingDayKey } = require('../dist/services/activity-auto/milk-tea-remind');

// 与线上一致：活动 10-15 10:00 开始，11-14 23:59:59 进入结算，11-16 23:59:59 结束
const SETTLE_START = 1794671999;
const END = 1794844799;

test('结算期之前不提醒', () => {
    const result = buildSettleReminder({ settleStart: SETTLE_START, end: END, now: SETTLE_START - 60 });
    assert.equal(result, null);
});

test('活动结束后不再提醒', () => {
    assert.equal(buildSettleReminder({ settleStart: SETTLE_START, end: END, now: END }), null);
    assert.equal(buildSettleReminder({ settleStart: SETTLE_START, end: END, now: END + 3600 }), null);
});

test('结算期内剩余超过 6 小时：按天提醒', () => {
    const now = SETTLE_START + 3600;
    const result = buildSettleReminder({ settleStart: SETTLE_START, end: END, now });
    assert.ok(result);
    assert.equal(result.title, '奶茶进入结算期');
    assert.match(result.content, /剩余约 2 天/);
    assert.match(result.content, /不可制作、雇佣、加速/);
    assert.equal(result.day, beijingDayKey(now));
    assert.equal(result.day, '2026-11-15');
});

test('结算期最后 6 小时：升级为即将结束提醒', () => {
    const now = END - 3 * 3600;
    const result = buildSettleReminder({ settleStart: SETTLE_START, end: END, now });
    assert.ok(result);
    assert.equal(result.title, '奶茶活动即将结束');
    assert.match(result.content, /剩余约 3 小时/);
    assert.match(result.content, /立即兑换/);
});

test('同一天只提醒一次，跨天可再次提醒', () => {
    const now = SETTLE_START + 3600;
    const first = buildSettleReminder({ settleStart: SETTLE_START, end: END, now });
    assert.ok(first);
    const sameDay = buildSettleReminder({ settleStart: SETTLE_START, end: END, now: now + 3600, sentDay: first.day });
    assert.equal(sameDay, null);
    const nextDay = buildSettleReminder({ settleStart: SETTLE_START, end: END, now: now + 86400, sentDay: first.day });
    assert.ok(nextDay);
    assert.notEqual(nextDay.day, first.day);
});

test('缺少结算开始时间（老活动/异常回包）时不提醒', () => {
    assert.equal(buildSettleReminder({ settleStart: 0, end: END, now: END - 3600 }), null);
    assert.equal(buildSettleReminder({ settleStart: SETTLE_START, end: 0, now: SETTLE_START + 60 }), null);
});
