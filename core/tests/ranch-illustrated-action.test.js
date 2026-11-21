const assert = require('node:assert/strict');
const test = require('node:test');

const { ACTIONS } = require('../dist/services/ranch/contract');

/**
 * 牧场图鉴「全部已读」此前复用农场 /api/illustrated/clear-new（无场景切换的 sendMsgAsync），
 * 账号停在场景1时会把已读状态清到农场图鉴。修复后改为牧场自有 action，走 inScene(2)。
 * 这里锁住 action 已注册，确保前端 request('clearIllustrated') 不会被 planAction 拒绝。
 */
test('clearIllustrated 已注册为牧场写操作', () => {
    assert.ok(ACTIONS.includes('clearIllustrated'), 'clearIllustrated 必须在 ACTIONS 中，否则 prepare/operate 会拒绝');
});

test('图鉴相关写操作齐全：领奖与清除已读都在', () => {
    assert.ok(ACTIONS.includes('claimIllustrated'), '牧场图鉴领奖应保留');
    assert.ok(ACTIONS.includes('clearIllustrated'), '牧场图鉴已读应可清除');
    const set = new Set(ACTIONS);
    assert.equal(set.size, ACTIONS.length, 'ACTIONS 不应有重复项');
});
