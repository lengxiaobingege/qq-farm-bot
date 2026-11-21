const assert = require('node:assert/strict');
const test = require('node:test');

const { dedupeRanchActivities } = require('../dist/services/ranch/state');

/**
 * 牧场活动曾在页面上重复出现好几次：服务端 ActivityList 对同一个活动给出多条 window
 * （主活动 + 子活动、不同 id 但 name/uid/时间相同），ranchActivities 按 id 前缀全部命中
 * 后没有去重。这里锁住去重规则：同一活动只留一条，不同活动不受影响。
 */
function activity(id, name, uid, startTime, endTime) {
    return { id, name, uid, startTime, endTime, rules: [] };
}

test('dedupeRanchActivities 按 uid 合并同一活动的多条 window', () => {
    const rows = [
        activity('2026111700', '牧歌初启', 'MugeMainUI', 1000, 2000),
        activity('2026111701', '牧歌初启', 'MugeMainUI', 1000, 2000),
        activity('2026111702', '牧歌初启', 'MugeMainUI', 1000, 2000),
    ];
    const result = dedupeRanchActivities(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2026111700');
});

test('dedupeRanchActivities 子活动无 uid 时按 name+起止时间合并到主活动', () => {
    const rows = [
        activity('2026111700', '牧歌初启', 'MugeMainUI', 1000, 2000),
        // 子活动拿不到 uid，但 name 与起止时间一致，也应被主活动登记的 nt 键命中。
        activity('2026111707', '牧歌初启', '', 1000, 2000),
        activity('2026111708', '牧歌初启', '', 1000, 2000),
    ];
    const result = dedupeRanchActivities(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2026111700');
});

test('dedupeRanchActivities 保留不同活动', () => {
    const rows = [
        activity('2026111700', '牧歌初启', 'MugeMainUI', 1000, 2000),
        activity('2026111800', '以薯换福', 'PotatoUI', 1000, 2000),
        activity('2026111900', '牧场庆典', '', 3000, 4000),
    ];
    const result = dedupeRanchActivities(rows);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map(row => row.name), ['牧歌初启', '以薯换福', '牧场庆典']);
});

test('dedupeRanchActivities 同名但不同时间段视为不同活动', () => {
    const rows = [
        activity('2026111700', '牧歌初启', '', 1000, 2000),
        activity('2026111790', '牧歌初启', '', 3000, 4000),
    ];
    const result = dedupeRanchActivities(rows);
    assert.equal(result.length, 2);
});
