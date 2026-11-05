export {};
/**
 * 活动任务自动化编排入口：每个活动一个独立文件，这里只负责按顺序执行并汇总日志
 *
 * - milk-tea-auto.ts  奶茶热销中（2026110100）
 * - happy-auto.ts     快乐不独享（2026110104）
 * - solar-auto.ts     节令日历（节令开始当天执行一次）
 */

import type { AutoResult } from './shared';
const { isAutomationOn } = require('../../models/store');
const { log } = require('../../utils/utils');
const { autoMilkTea } = require('./milk-tea-auto');
const { autoHappy } = require('./happy-auto');
const { autoSolar } = require('./solar-auto');

async function checkAndClaimActivityTasks(): Promise<void> {
    if (!isAutomationOn('activity_task')) return;

    const messages: string[] = [];
    // 串行执行，避免并发请求触发服务器限速
    const run = async (task: () => Promise<AutoResult>): Promise<void> => {
        const result = await task();
        if (result.message) messages.push(result.message);
    };

    await run(autoMilkTea);
    await run(autoHappy);
    await run(autoSolar);

    if (messages.length > 0) {
        log('活动任务', messages.join('，'), { module: 'activity_task', event: 'activity_task_tick', result: 'ok' });
    }
}

module.exports = {
    checkAndClaimActivityTasks,
    autoMilkTea,
    autoHappy,
    autoSolar,
};
