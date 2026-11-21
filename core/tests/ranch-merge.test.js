const assert = require('node:assert/strict');
const test = require('node:test');

const { mergeRanches } = require('../dist/services/ranch/state');

/**
 * 收获/催产/清理的回包带最新栏舍，service 层直接把它拼进快照以省掉一次全量 AllCells。
 * 这里只验证「拼得对不对」：覆盖到的栏舍要换新，没覆盖的保持原样，且不能改动入参。
 */
function cells() {
    return {
        facilities: [
            { instance_id: '11', facility_id: 1, ranch: { ranch_inst_id: '11', animal_count: 4, shelves: [{ slot_index: 1, can_collect: true }] } },
            { instance_id: '12', facility_id: 1, ranch: { ranch_inst_id: '12', animal_count: 2, shelves: [] } },
            { instance_id: '13', facility_id: 3, state: 1, feed_machine: { feed_count: 10 } },
        ],
    };
}

test('mergeRanches 只替换回包覆盖到的栏舍', () => {
    const after = mergeRanches(cells(), [{ ranch_inst_id: '11', animal_count: 0, shelves: [] }]);
    assert.equal(after.facilities[0].ranch.animal_count, 0);
    assert.deepEqual(after.facilities[0].ranch.shelves, []);
    assert.equal(after.facilities[1].ranch.animal_count, 2, '未回传的栏舍应保持原样');
    assert.equal(after.facilities[2].feed_machine.feed_count, 10, '非栏舍设施不受影响');
});

test('mergeRanches 不改动传入的 cells', () => {
    const before = cells();
    mergeRanches(before, [{ ranch_inst_id: '11', animal_count: 0 }]);
    assert.equal(before.facilities[0].ranch.animal_count, 4, '快照合并不能就地修改 before');
});

test('mergeRanches 遇到空回包时原样返回', () => {
    const before = cells();
    assert.equal(mergeRanches(before, []), before);
    assert.equal(mergeRanches(before, null), before);
    assert.equal(mergeRanches(before, undefined), before);
});
