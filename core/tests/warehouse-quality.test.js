const assert = require('node:assert/strict');
const test = require('node:test');

const {
    isFertilizerGiftCooling,
    noteFertilizerGiftOutcome,
    resetFertilizerGiftCooldown,
    SPECIAL_GIFT_CHECK_COOLDOWN_MS,
} = require('../dist/services/warehouse');

/**
 * 化肥礼包失败冷却。
 * 背景：背包里有化肥道具但 BatchUse 全部失败（服务端报「不足」）时，
 * 农场巡查每轮都会重发这些必然失败的请求，2026-11-20 单日产生 6000+ 条无效告警。
 */
test('化肥礼包默认不冷却', () => {
    resetFertilizerGiftCooldown();
    assert.equal(isFertilizerGiftCooling(0), false);
});

test('全部失败进入冷却，窗口内一直跳过', () => {
    resetFertilizerGiftCooldown();
    const base = 1_700_000_000_000;

    noteFertilizerGiftOutcome(0, true, base);
    assert.equal(isFertilizerGiftCooling(base), true, '刚失败就在冷却中');
    assert.equal(isFertilizerGiftCooling(base + SPECIAL_GIFT_CHECK_COOLDOWN_MS - 1), true, '窗口末尾仍在冷却');
    assert.equal(isFertilizerGiftCooling(base + SPECIAL_GIFT_CHECK_COOLDOWN_MS), false, '到点自动解除');
});

test('成功使用道具立刻清零冷却', () => {
    resetFertilizerGiftCooldown();
    const base = 1_700_000_000_000;

    noteFertilizerGiftOutcome(0, true, base);
    assert.equal(isFertilizerGiftCooling(base + 1000), true);

    noteFertilizerGiftOutcome(2, false, base + 1000);
    assert.equal(isFertilizerGiftCooling(base + 1000), false, '成功用掉道具后立即恢复检测');
});

test('无道具（未尝试）不触发冷却', () => {
    resetFertilizerGiftCooldown();
    const base = 1_700_000_000_000;

    noteFertilizerGiftOutcome(0, false, base);
    assert.equal(isFertilizerGiftCooling(base), false, '背包没道具、未发请求时不应冷却');
});

test('冷却以最后一次失败重新计时', () => {
    resetFertilizerGiftCooldown();
    const base = 1_700_000_000_000;

    noteFertilizerGiftOutcome(0, true, base);
    const second = base + SPECIAL_GIFT_CHECK_COOLDOWN_MS + 1;
    noteFertilizerGiftOutcome(0, true, second);
    assert.equal(isFertilizerGiftCooling(second + SPECIAL_GIFT_CHECK_COOLDOWN_MS - 1), true);
    assert.equal(isFertilizerGiftCooling(second + SPECIAL_GIFT_CHECK_COOLDOWN_MS), false);
});

const { collectFertilizerUsePayload } = require('../dist/services/warehouse');

/**
 * 化肥按 (id, uid) 逐堆收集，保留真实 uid。
 * 背景：化肥须走 Use 协议并带 uid；BatchUse（无 uid）对化肥返回「不足」。
 */
test('化肥道具按 uid 逐堆保留，不合并不同堆', () => {
    const items = [
        { id: 80001, count: 5, uid: 100 },
        { id: 80001, count: 3, uid: 200 }, // 同 id 不同 uid：必须分成两堆
        { id: 80001, count: 2, uid: 100 }, // 同 uid 合并到 100 那堆 → 7
        { id: 80011, count: 4, uid: 300 },
    ];
    const payloads = collectFertilizerUsePayload(items);
    assert.deepEqual(
        payloads.sort((a, b) => a.uid - b.uid),
        [
            { id: 80001, count: 7, uid: 100 },
            { id: 80001, count: 3, uid: 200 },
            { id: 80011, count: 4, uid: 300 },
        ],
    );
});

test('锁定堆与非化肥道具被忽略', () => {
    const items = [
        { id: 80001, count: 5, uid: 100, locked: true }, // 锁定 → 跳过
        { id: 7004, count: 10, uid: 101 },               // 牧草，非化肥 → 跳过
        { id: 1011, count: 100, uid: 102 },              // 容器道具 → 跳过
        { id: 80001, count: 2, uid: 103 },               // 正常 → 保留
    ];
    // locked 判定依赖 isItemLocked，构造 locked 字段（测试里仓库锁定态来自字段）
    const payloads = collectFertilizerUsePayload(items);
    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0], { id: 80001, count: 2, uid: 103 });
});
