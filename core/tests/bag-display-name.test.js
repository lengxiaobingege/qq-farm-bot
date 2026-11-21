const assert = require('node:assert/strict');
const test = require('node:test');

const gc = require('../dist/config/gameConfig');
const { itemDto } = require('../dist/services/ranch/model');

/**
 * 背包里的作物/果实常以「植株 id」出现（Plant.json 的主键，如 1020001=草莓）。
 * 这类 id 在全局 ItemInfo 里没有条目，getFruitName 查的又是果实 id（40001 段）映射，
 * 于是之前只能显示「物品1020001」/「果实1020001」，图标也可能取不到。
 * getItemDisplayName 依次兜底 ItemInfo → 植株主键 → 牧场 MCItemInfo → 果实映射。
 */
test('背包植株 id 解析为真实作物名，不再是 物品<id>', () => {
    const cases = [
        [1020001, '草莓'],
        [1020010, '南瓜'],
        [1020050, '蘑菇'],
        [1020529, '森野芭乐'],
        [1028001, '哈哈南瓜塔'],
    ];
    for (const [id, name] of cases) {
        assert.equal(gc.getItemDisplayName(id), name, `植株 id ${id} 应解析为 ${name}`);
        assert.notEqual(gc.getItemDisplayName(id), `物品${id}`);
    }
});

test('普通道具与牧场专属物品名称仍能解析', () => {
    assert.equal(gc.getItemDisplayName(1011), '普通化肥容器', '全局 ItemInfo 名称优先');
    assert.equal(gc.getItemDisplayName(65001), '巨大鸡幼崽', '牧场专属物品走 MCItemInfo 兜底');
    assert.equal(gc.getItemDisplayName(46038), '款冬花', '牧场花卉走 MCItemInfo 兜底');
});

test('植株 id 有对应图片资源时能取到图标 URL', () => {
    for (const id of [1020001, 1020050, 1028001]) {
        const image = gc.getItemImageById(id);
        assert.ok(image && image.includes(`${id}.png`), `植株 id ${id} 应能取到同 id 图片`);
    }
});

test('牧场 itemDto 名称对牧场专属物品不再显示 物品<id>', () => {
    for (const id of [46038, 26038, 65001, 60013]) {
        const dto = itemDto({ id, count: 1 });
        assert.notEqual(dto.name, `物品${id}`, `牧场物品 ${id} 应有真实名称`);
        assert.ok(dto.name && !dto.name.startsWith('物品'), `牧场物品 ${id} 名称: ${dto.name}`);
    }
});
