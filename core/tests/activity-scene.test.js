const assert = require('node:assert/strict');
const test = require('node:test');

const { decodeActivityWindows, decodeActivityExtra } = require('../dist/services/activity-windows');
const activityScene = require('../dist/config/activity-scene');
const { activityScope, isRanchActivity, isGlobalActivity } = activityScene;

/**
 * 牧场活动页此前直接展示全局 ActivityList，把「奶茶热销中」「故友重逢」这类农场活动
 * 当成了牧场活动。归属只能靠 ActivityContent.extra.uid 判断（协议里没有场景字段），
 * 这里锁住解码与归类两段逻辑。
 */
function extra(value) {
    return Buffer.from(JSON.stringify(value), 'utf8');
}

test('decodeActivityExtra 解析界面标识并剥离富文本标签', () => {
    const result = decodeActivityExtra(extra({
        uid: 'MugeMainUI',
        tips: { txt: ['<b>【活动时间】</b>', '2026年11月17日 — 2026年11月30日'] },
    }));
    assert.equal(result.uid, 'MugeMainUI');
    assert.deepEqual(result.rules, ['【活动时间】', '2026年11月17日 — 2026年11月30日']);
});

test('decodeActivityExtra 对非 JSON 内容返回空值而不是抛错', () => {
    assert.deepEqual(decodeActivityExtra(Buffer.from('not json')), { uid: '', rules: [] });
    assert.deepEqual(decodeActivityExtra(undefined), { uid: '', rules: [] });
});

test('decodeActivityWindows 把活动树里的 uid 与说明带到时间窗口上', () => {
    const windows = decodeActivityWindows({
        activity_windows: [
            { id: '2026111700', name: '牧歌初启', begin_time: 1794880800, end_time: 1796054399 },
            { id: '2026110100', name: '奶茶热销中', begin_time: 1792029600, end_time: 1794844799 },
        ],
        activities: [
            {
                activity: {
                    activity_id: '2026111700',
                    type: 1,
                    name: '牧歌初启',
                    extra: extra({ uid: 'MugeMainUI', tips: { txt: ['牧场活动'] } }),
                },
            },
            {
                activity: { activity_id: '2026110100', type: 1, name: '奶茶热销中', extra: extra({ uid: 'MilkTeaActivity' }) },
            },
        ],
    });
    assert.equal(windows.get('2026111700').uid, 'MugeMainUI');
    assert.deepEqual(windows.get('2026111700').rules, ['牧场活动']);
    assert.equal(windows.get('2026110100').uid, 'MilkTeaActivity');
});

test('activityScope 按 uid 前缀与已确认 id 区分牧场活动', () => {
    assert.equal(activityScope({ id: '2026111700', beginTime: 0, endTime: 0, uid: 'MugeMainUI' }), 'ranch');
    // ActivityList 的树里没有牧场活动节点时拿不到 uid，靠 id 兜底
    assert.equal(activityScope({ id: '2026111707', beginTime: 0, endTime: 0 }), 'ranch');
    assert.equal(activityScope({ id: '2026110100', beginTime: 0, endTime: 0, uid: 'MilkTeaActivity' }), 'global');
    assert.equal(activityScope({ id: '2026111800', beginTime: 0, endTime: 0 }), 'global');
    assert.equal(isRanchActivity({ id: '2026111700', beginTime: 0, endTime: 0, uid: 'MugeMainUI' }), true);
    assert.equal(isRanchActivity({ id: '2026092200', beginTime: 0, endTime: 0 }), false);
});

test('isGlobalActivity 反向过滤牧场活动，农场活动中心据此不串台', () => {
    // 牧场专属活动被排除（含没有 uid 的子活动 id）
    assert.equal(isGlobalActivity({ id: '2026111700', beginTime: 0, endTime: 0, uid: 'MugeMainUI' }), false);
    assert.equal(isGlobalActivity({ id: '2026111707', beginTime: 0, endTime: 0 }), false);
    assert.equal(isGlobalActivity({ id: '2026111702', beginTime: 0, endTime: 0 }), false);
    assert.equal(isGlobalActivity({ id: '2026111708', beginTime: 0, endTime: 0 }), false);
    // 农场/全局活动保留；18 日的故友重逢不能被 17 日前缀误伤
    assert.equal(isGlobalActivity({ id: '2026110100', beginTime: 0, endTime: 0, uid: 'MilkTeaActivity' }), true);
    assert.equal(isGlobalActivity({ id: '2026111800', beginTime: 0, endTime: 0 }), true);
    // 未识别、无 id 的兜底项按全局处理，避免误删
    assert.equal(isGlobalActivity({ beginTime: 0, endTime: 0 }), true);
});

test('归属规则可由配置注入：新增 uid/id 前缀、精确 id 立即生效', () => {
    try {
        activityScene.setRanchActivityScopeRules({
            uidPrefixes: ['NewRanchUI'],
            idPrefixes: ['20261201'],
            exactIds: ['2026999999'],
            excludeIds: [],
        });
        assert.equal(activityScope({ id: '2026120100', beginTime: 0, endTime: 0 }), 'ranch');
        assert.equal(activityScope({ id: 'x', beginTime: 0, endTime: 0, uid: 'NewRanchUI' }), 'ranch');
        assert.equal(activityScope({ id: '2026999999', beginTime: 0, endTime: 0 }), 'ranch');
        // 旧前缀已从配置移除，不再判为牧场
        assert.equal(activityScope({ id: '2026111700', beginTime: 0, endTime: 0 }), 'global');
        assert.ok(activityScene.getRanchActivityScopeRules().idPrefixes.includes('20261201'));
    } finally {
        // 恢复默认配置，避免污染后续用例
        activityScene.reloadRanchActivityScope();
    }
});

test('excludeIds 修正前缀误判：即使命中牧场 id 前缀也判为全局', () => {
    try {
        activityScene.setRanchActivityScopeRules({
            uidPrefixes: [], idPrefixes: ['20261117'], exactIds: [], excludeIds: ['2026111799'],
        });
        assert.equal(activityScope({ id: '2026111700', beginTime: 0, endTime: 0 }), 'ranch');
        assert.equal(isGlobalActivity({ id: '2026111799', beginTime: 0, endTime: 0 }), true);
        assert.equal(isRanchActivity({ id: '2026111799', beginTime: 0, endTime: 0 }), false);
    } finally {
        activityScene.reloadRanchActivityScope();
    }
});

test('归属规则对脏配置做清洗，过滤非字符串与空值', () => {
    try {
        const rules = activityScene.setRanchActivityScopeRules({
            uidPrefixes: ['Valid', '', 123, null, '  '],
            idPrefixes: 'not-array',
        });
        assert.deepEqual(rules.uidPrefixes, ['Valid']);
        assert.deepEqual(rules.idPrefixes, []);
    } finally {
        activityScene.reloadRanchActivityScope();
    }
});

test('buildActivityDirectory 不把牧场活动混进农场活动目录', () => {
    const { buildActivityDirectory } = require('../dist/services/activity-center');
    const windows = [
        { id: '2026111700', name: '牧歌初启', beginTime: 1794880800, endTime: 1796054399, uid: 'MugeMainUI' },
        { id: '2026111702', name: '牧歌初启-子活动', beginTime: 0, endTime: 0 },
        { id: '2026111707', name: '以薯换福', beginTime: 0, endTime: 0 },
        { id: '2026111708', name: '以薯换福-子活动', beginTime: 0, endTime: 0 },
        { id: '2026110100', name: '奶茶热销中', beginTime: 1792029600, endTime: 1794844799, uid: 'MilkTeaActivity' },
        { id: '2026111800', name: '故友重逢', beginTime: 0, endTime: 0 },
    ];
    const names = buildActivityDirectory(windows, null, null, null, null).map((g) => g.name);
    assert.ok(!names.includes('奶茶热销中'), '已过期的农场活动不应出现（奶茶活动 2026-11-16 23:59:59 结束）');
    assert.ok(names.includes('故友重逢'), '无结束时间的全局活动应保留');
    assert.ok(!names.some(n => n.startsWith('牧歌初启')), '牧场活动不应出现在农场目录');
    assert.ok(!names.some(n => n.startsWith('以薯换福')), '牧场活动不应出现在农场目录');
});

test('buildActivityDirectory 隐藏已结束活动、保留进行中与长期活动', () => {
    const { buildActivityDirectory } = require('../dist/services/activity-center');
    const nowSec = Math.floor(Date.now() / 1000);
    const windows = [
        { id: '2099010100', name: '远古已结束活动', beginTime: nowSec - 86400 * 30, endTime: nowSec - 60 },
        { id: '2099010200', name: '正在进行活动', beginTime: nowSec - 3600, endTime: nowSec + 86400 },
        { id: '2099010300', name: '长期活动无结束时间', beginTime: 0, endTime: 0 },
        { id: '2099010400', name: '负时间戳垃圾活动', beginTime: -62135596800, endTime: -62135596800 },
    ];
    const names = buildActivityDirectory(windows, null, null, null, null).map((g) => g.name);
    assert.ok(!names.includes('远古已结束活动'), 'endTime 已过的活动应隐藏');
    assert.ok(names.includes('正在进行活动'), '未结束的活动应保留');
    assert.ok(names.includes('长期活动无结束时间'), 'endTime===0 的长期活动应保留');
    assert.ok(!names.includes('负时间戳垃圾活动'), '负数 endTime（DateTime.MinValue 垃圾值）应隐藏');
});
