const assert = require('node:assert/strict');
const test = require('node:test');

const { RANCH_AUTOMATION_DEFAULTS } = require('../dist/config/ranch-automation');
const { DEFAULT_ACCOUNT_CONFIG, ALLOWED_AUTOMATION_KEYS } = require('../dist/models/store/shared-state');

/**
 * 牧场自动化有两个默认值来源：config/ranch-automation 的 RANCH_AUTOMATION_DEFAULTS
 * 与 models/store 的 DEFAULT_ACCOUNT_CONFIG.automation。前者供 ranch 模块读取，
 * 后者决定 ALLOWED_AUTOMATION_KEYS 白名单和账号配置的归一化。
 * 此前 ranch_illustrated / 集市兑换三个开关只写在前者，导致后者白名单过滤、
 * enabled() 永远读到 undefined —— 图鉴经验与集市兑换实际没有运行。
 * 这里锁住所有布尔牧场开关在两个来源一致，防止再次漏同步。
 */
const accountAutomation = DEFAULT_ACCOUNT_CONFIG.automation;
const ranchBoolKeys = Object.entries(RANCH_AUTOMATION_DEFAULTS)
    .filter(([, value]) => typeof value === 'boolean')
    .map(([key]) => key);

test('所有布尔牧场开关都在账号默认配置中声明', () => {
    const missing = ranchBoolKeys.filter(key => !(key in accountAutomation));
    assert.deepEqual(missing, [], `这些开关在 DEFAULT_ACCOUNT_CONFIG.automation 缺失，会被 ALLOWED_AUTOMATION_KEYS 过滤: ${missing.join(', ')}`);
});

// 注意：其余布尔开关两个来源的历史默认值本就不同（RANCH_AUTOMATION_DEFAULTS 多为 false，
// DEFAULT_ACCOUNT_CONFIG 按「默认只开收产物」设为 true），这是既有设计，不在此强求一致。
// 这里只锁这次同步的 4 个开关：它们的默认值取自 RANCH_AUTOMATION_DEFAULTS。
const syncedKeys = ['ranch_illustrated', 'ranch_market_organic', 'ranch_market_organic_poop', 'ranch_market_organic_pinecone'];

test('同步的图鉴/集市开关默认值在两个来源一致', () => {
    const mismatched = syncedKeys.filter(key => accountAutomation[key] !== RANCH_AUTOMATION_DEFAULTS[key]);
    assert.deepEqual(mismatched, [], `默认值不一致: ${mismatched.join(', ')}`);
});

test('图鉴与集市兑换开关在白名单中放行', () => {
    for (const key of syncedKeys) {
        assert.ok(ALLOWED_AUTOMATION_KEYS.has(key), `${key} 不在 ALLOWED_AUTOMATION_KEYS，enabled() 永远读不到`);
    }
});
