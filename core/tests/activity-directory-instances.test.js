const test = require('node:test');
const assert = require('node:assert/strict');
const { buildActivityDirectory } = require('../dist/services/activity-center');

test('milk tea and identically named share reward instances keep independent directory entries', () => {
    // endTime 设为未来，确保分组测试不受“隐藏已结束活动”过滤影响
    const future = Math.floor(Date.now() / 1000) + 86400;
    const windows = ['2026110100', '2026110101', '2026110102', '2026110103', '2026110104']
        .map(id => ({ id, name: '奶茶热销中', beginTime: 100, endTime: future }));
    const directory = buildActivityDirectory(windows, null, null, null, null);
    const milk = directory.find(entry => entry.gameplayKey === 'milk');
    assert.deepEqual(milk.activityIds, ['2026110100', '2026110101', '2026110102', '2026110103']);
    const share = directory.filter(entry => entry.gameplayKey === 'happy');
    assert.equal(share.length, 1);
    const instance = share.find(entry => entry.instanceId === '2026110104');
    assert.equal(instance.name, '快乐不独享');
    assert.deepEqual(instance.activityIds, ['2026110104']);
    assert.equal(instance.detailTarget, 'happy');
});
