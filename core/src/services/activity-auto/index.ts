export {};
/**
 * 活动任务自动化编排入口：每个活动一个独立文件，这里只负责按顺序执行并汇总日志
 *
 * - milk-tea-auto.ts  奶茶热销中（2026110100）
 * - happy-auto.ts     快乐不独享（2026110104）
 * - solar-auto.ts     节令日历（节令开始当天执行一次）
 */

import type { AutoPushMessage, AutoResult } from './shared';
const { isAutomationOn } = require('../../models/store');
const { log } = require('../../utils/utils');
const { autoMilkTea } = require('./milk-tea-auto');
const { autoHappy } = require('./happy-auto');
const { autoSolar } = require('./solar-auto');

interface ActivityTaskResult {
    /** 需要推送给用户的提醒，由调度层转交主进程发送 */
    pushes: AutoPushMessage[];
}

async function checkAndClaimActivityTasks(): Promise<ActivityTaskResult> {
    if (!isAutomationOn('activity_task')) return { pushes: [] };

    const messages: string[] = [];
    const pushes: AutoPushMessage[] = [];
    // 串行执行，避免并发请求触发服务器限速
    const run = async (task: () => Promise<AutoResult>): Promise<void> => {
        const result = await task();
        if (result.message) messages.push(result.message);
        if (result.push?.title && result.push?.content) pushes.push(result.push);
    };

    await run(autoMilkTea);
    await run(autoHappy);
    await run(autoSolar);

    if (messages.length > 0) {
        log('活动任务', messages.join('，'), { module: 'activity_task', event: 'activity_task_tick', result: 'ok' });
    }
    return { pushes };
}

module.exports = {
    checkAndClaimActivityTasks,
    autoMilkTea,
    autoHappy,
    autoSolar,
};
