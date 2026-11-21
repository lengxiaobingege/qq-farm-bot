const assert = require('node:assert/strict');
const test = require('node:test');

const { allocatePlaceItems } = require('../dist/services/ranch/actions');

// 真实幼崽配置：60001 是窝、70001 是棚，id 即 animal_id。
const coopCub = { id: 60001, husbandry_type: '窝', giantCubItemId: 0 };
const shedCub = { id: 70001, husbandry_type: '棚', giantCubItemId: 0 };

function rawWith(facilities) {
    return { cells: { facilities } };
}

function coopFacility(instanceId, capacity, animalCount) {
    return { instance_id: String(instanceId), ranch: { husbandry_type: 1, capacity, animal_count: animalCount } };
}

function shedFacility(instanceId, capacity, animalCount) {
    return { instance_id: String(instanceId), ranch: { husbandry_type: 2, capacity, animal_count: animalCount } };
}

test('买放分离：单栏舍空位充足时足额分配', () => {
    const items = allocatePlaceItems(rawWith([coopFacility(11, 6, 2)]), coopCub, 3);
    assert.ok(items, '空位足够应返回分配');
    assert.equal(items.length, 3);
    assert.ok(items.every(item => item.ranch_inst_id === '11' && item.animal_id === 60001));
});

test('买放分离：跨多个同类栏舍按空位分配', () => {
    const raw = rawWith([
        coopFacility(11, 4, 3),  // 空 1
        coopFacility(12, 6, 2),  // 空 4
        coopFacility(13, 4, 0),  // 空 4
    ]);
    const items = allocatePlaceItems(raw, coopCub, 5);
    assert.ok(items);
    assert.equal(items.length, 5);
    const byRanch = items.reduce((acc, item) => {
        acc[item.ranch_inst_id] = (acc[item.ranch_inst_id] || 0) + 1;
        return acc;
    }, {});
    assert.deepEqual(byRanch, { '11': 1, '12': 4 }, '先填满空位少的栏舍，恰好凑够 5 只');
});

test('买放分离：只分配同类栏舍，忽略棚/非栏舍设施', () => {
    const raw = rawWith([
        shedFacility(21, 10, 0),  // 棚空 10，但买的是窝幼崽
        { instance_id: '22', feed_machine: { feed_count: 5 } },
        coopFacility(12, 4, 2),   // 窝空 2
    ]);
    const items = allocatePlaceItems(raw, coopCub, 2);
    assert.ok(items);
    assert.equal(items.length, 2);
    assert.ok(items.every(item => item.ranch_inst_id === '12' && item.animal_id === 60001), '不得混入棚或饲料机');
});

test('买放分离：空位不足时返回 null（判结果未知，保留防重复扣款底线）', () => {
    const raw = rawWith([coopFacility(11, 4, 3), coopFacility(12, 4, 4)]);
    assert.equal(allocatePlaceItems(raw, coopCub, 3), null, '总空位 1 < 3，应判定无法放养');
});

test('买放分离：总数恰好等于空位时足额分配', () => {
    const raw = rawWith([coopFacility(11, 4, 2), coopFacility(12, 4, 3)]); // 空 2 + 1
    const items = allocatePlaceItems(raw, coopCub, 3);
    assert.ok(items);
    assert.equal(items.length, 3);
});

test('买放分离：棚幼崽只分配到棚', () => {
    const raw = rawWith([coopFacility(11, 10, 0), shedFacility(21, 6, 4)]);
    const items = allocatePlaceItems(raw, shedCub, 2);
    assert.ok(items);
    assert.equal(items.length, 2);
    assert.ok(items.every(item => item.ranch_inst_id === '21' && item.animal_id === 70001));
});
