const assert = require('node:assert/strict');
const test = require('node:test');

const {
    isFertilizerCooling,
    noteFertilizerOutcome,
    resetFertilizerCooldown,
    FERTILIZER_RETRY_COOLDOWN_MS,
} = require('../dist/services/farm/scheduler');

/**
 * 巡田补肥失败冷却。
 * 背景：化肥耗尽时，农场循环每 21 秒重新检测并重发必然失败的施肥请求，
 * 2026-11-14 18:59–19:53 累计 201 条「容器不足」告警、上千次无效请求。
 */
test('默认不冷却', () => {
    resetFertilizerCooldown();
    assert.equal(isFertilizerCooling(0), false);
});

test('0 成功进入冷却，窗口内一直跳过', () => {
    resetFertilizerCooldown();
    const base = 1_700_000_000_000;

    noteFertilizerOutcome(0, base);
    assert.equal(isFertilizerCooling(base), true, '刚失败就在冷却中');
    assert.equal(isFertilizerCooling(base + 60_000), true, '1 分钟后仍在冷却');
    assert.equal(isFertilizerCooling(base + FERTILIZER_RETRY_COOLDOWN_MS - 1), true, '窗口末尾仍在冷却');
    assert.equal(isFertilizerCooling(base + FERTILIZER_RETRY_COOLDOWN_MS), false, '到点自动解除');
});

test('有成功就清零冷却', () => {
    resetFertilizerCooldown();
    const base = 1_700_000_000_000;

    noteFertilizerOutcome(0, base);
    assert.equal(isFertilizerCooling(base + 1000), true);

    noteFertilizerOutcome(3, base + 1000);
    assert.equal(isFertilizerCooling(base + 1000), false, '施肥成功后立刻恢复检测');
});

test('冷却窗口可重复触发且以最后一次失败计时', () => {
    resetFertilizerCooldown();
    const base = 1_700_000_000_000;

    noteFertilizerOutcome(0, base);
    // 窗口过后又失败一次：从第二次失败重新计 10 分钟
    const second = base + FERTILIZER_RETRY_COOLDOWN_MS + 1;
    noteFertilizerOutcome(0, second);
    assert.equal(isFertilizerCooling(second + FERTILIZER_RETRY_COOLDOWN_MS - 1), true);
    assert.equal(isFertilizerCooling(second + FERTILIZER_RETRY_COOLDOWN_MS), false);
});
