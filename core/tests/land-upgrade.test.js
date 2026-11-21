const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLandUpgradeDetail } = require('../dist/services/farm/land-upgrade');

test('land 21 keeps the exact server level and currency conditions and compares gold to crystal bonuses', () => {
    // 服务端 11/2 起改用 level_need / items_need / preceeding_lands_count_need 字段
    const info = buildLandUpgradeDetail({ id: 21, unlocked: true, level: 4, max_level: 5,
        buff: { plant_yield_bonus: 30000, planting_time_reduction: 2000, plant_exp_bonus: 2000 },
        upgrade_condition: { level_need: 150,
            items_need: [{ id: 1001, count: '450000000' }, { id: 1005, count: '18670' }] } },
        new Map([[21, { unlocked: true, level: 4 }]]));
    assert.equal(info.needLevel, 150);
    assert.deepEqual(info.costs.map(c => [c.id, c.count]), [['1001', '450000000'], ['1005', '18670']]);
    assert.equal(info.current.expBonus, 20);
    assert.equal(info.next.expBonus, 25);
    assert.equal(info.next.mutantMultiplier, 1.2);
    assert.equal(info.next.resonanceBonus, 25);
    assert.equal(info.unknown, false);
    assert.deepEqual(info.precedingLands, { name: '金土地', required: 1, owned: 1, met: true });
});

test('max level does not show upgrade costs; server bonuses override static defaults', () => {
    const info = buildLandUpgradeDetail({ unlocked: true, level: 5, max_level: 5, buff: { plant_exp_bonus: 5000 } });
    assert.equal(info.mode, 'max');
    assert.equal(info.current.expBonus, 50);
    assert.equal(info.next, null);
    assert.deepEqual(info.costs, []);
});

test('unlocking shows prerequisite land and exact price instead of upgrade requirements', () => {
    const raw = { id: 8, unlocked: false, unlock_condition: { preceding_land_id: 7, need_level: 10, need_gold: 100000 } };
    const info = buildLandUpgradeDetail(raw, new Map([[7, { unlocked: true }]]));
    assert.equal(info.mode, 'unlock');
    assert.equal(info.needLevel, 10);
    assert.equal(info.prerequisite.met, true);
    assert.equal(info.costs[0].count, '100000');
    assert.equal(buildLandUpgradeDetail(raw).prerequisite.met, false);
});

test('server upgrade conditions without a level requirement stay unknown; known official fallback does not imply upgrade permission', () => {
    const info = buildLandUpgradeDetail({ id: 21, unlocked: true, level: 4, max_level: 5,
        upgrade_condition: { condition_type: 99, items_need: [] } });
    assert.equal(info.unknown, true);
    assert.equal(info.needLevel, 0);
    assert.deepEqual(info.costs, []);
    assert.equal(info.serverAllowed, false);
    const fallback = buildLandUpgradeDetail({ id: 21, unlocked: true, level: 4, max_level: 5 });
    assert.equal(fallback.needLevel, 150);
    assert.equal(fallback.serverAllowed, false);
    assert.equal(fallback.costs[1].count, '18670');
    assert.equal(fallback.unknown, false);
    assert.equal(fallback.precedingLands, null);
});
