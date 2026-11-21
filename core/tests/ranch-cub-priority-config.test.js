const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeAccountConfig } = require('../dist/models/store/shared-state');
const accountConfig = require('../dist/models/store/account-config');
const { cubMap } = require('../dist/config/ranch-animals');

const coopCubs = [...cubMap.entries()].filter(([, animal]) => animal && animal.husbandry_type === '窝').slice(0, 2).map(([id]) => id);
const shedCub = [...cubMap.entries()].find(([, animal]) => animal && animal.husbandry_type === '棚')[0];

/**
 * 自动控制里选择「优先背包幼崽」后，窝/棚的幼崽优先级要能保存下来。
 * 之前 normalizeAccountConfig 的非布尔白名单漏了 ranch_coop_cub_priority /
 * ranch_shed_cub_priority，导致这两个数组走进 else 分支被 !!v 压成 true，
 * 保存后优先级顺序丢失、运行时 placeCubs 又兜底成空数组。
 * 这里锁住归一化会保留数组原值与顺序，且过滤不适用当前栏位的 id。
 */
test('归一化保留窝/棚幼崽优先级数组，不再压成布尔值', () => {
    const cfg = normalizeAccountConfig({
        automation: {
            ranch_coop_cub_priority: [coopCubs[0], coopCubs[1], coopCubs[0]],
            ranch_shed_cub_priority: [shedCub],
        },
    });
    assert.ok(Array.isArray(cfg.automation.ranch_coop_cub_priority), '窝优先级应保持数组');
    assert.ok(Array.isArray(cfg.automation.ranch_shed_cub_priority), '棚优先级应保持数组');
    assert.deepEqual(cfg.automation.ranch_coop_cub_priority, [coopCubs[0], coopCubs[1]], '保留顺序并去重');
    assert.deepEqual(cfg.automation.ranch_shed_cub_priority, [shedCub]);
});

test('归一化对栏位不匹配的幼崽 id 整段回退为空数组', () => {
    const cfg = normalizeAccountConfig({
        automation: {
            // 把棚幼崽混进窝的优先级：normalizeRanchSetting 校验失败，整段沿用默认空数组。
            ranch_coop_cub_priority: [shedCub, coopCubs[0]],
        },
    });
    assert.deepEqual(cfg.automation.ranch_coop_cub_priority, []);
});

/**
 * 真正保存链路用的是 applyConfigSnapshot（master 保存与 worker 应用都经过它），
 * 而不是 normalizeAccountConfig。这里曾有一段独立的 automation 遍历把所有非
 * fertilizer 字段 !!v 压成布尔，导致上次只修 normalizeAccountConfig 完全不生效：
 * 用户选「优先背包幼崽」并排好序后一点保存，策略回退成 level、优先级数组清空。
 * 锁住保存后各字段类型与值都正确保留。
 */
test('applyConfigSnapshot 保存后牧场非布尔字段保持类型与值', () => {
    const id = 'test-apply-ranch-types';
    accountConfig.ensureAccountConfig(id, { persist: false });
    accountConfig.applyConfigSnapshot({
        automation: {
            ranch_strategy: 'bag_priority',
            ranch_bag_fallback: 'preferred',
            ranch_check_minutes: 5,
            ranch_coop_animal: 60002,
            ranch_coop_cub_priority: [coopCubs[0], coopCubs[1]],
            ranch_shed_cub_priority: [shedCub],
            ranch_harvest: true,
        },
    }, { accountId: id, persist: false });

    const auto = accountConfig.getConfigSnapshot(id).automation;
    assert.equal(auto.ranch_strategy, 'bag_priority', '策略应保持字符串');
    assert.equal(auto.ranch_bag_fallback, 'preferred', '兜底策略应保持字符串');
    assert.equal(auto.ranch_check_minutes, 5, '巡查间隔应保持数字');
    assert.equal(auto.ranch_coop_animal, 60002, '窝动物应保持数字 id');
    assert.deepEqual(auto.ranch_coop_cub_priority, [coopCubs[0], coopCubs[1]], '窝优先级数组应保持');
    assert.deepEqual(auto.ranch_shed_cub_priority, [shedCub], '棚优先级数组应保持');
    assert.equal(auto.ranch_harvest, true, '布尔开关不受影响');
});
