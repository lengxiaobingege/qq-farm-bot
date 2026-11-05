export {};
/**
 * 快乐不独享自动化（当前场次 2026110104，挂奶茶活动分组下，10-15 ~ 11-16）
 * 职责：领取每日快乐值、每日首次分享、领取可用档位奖励
 * 官方换场次时，在 src/activity-data/share-reward-instances.json 增加新 ID 并更新本文件常量即可
 */

import type { AutoResult } from './shared';
const { isAutomationOn } = require('../../models/store');
const { log, sleep } = require('../../utils/utils');
const { getShareRewardActivity, operateShareRewardActivity } = require('../share-reward-activity');
const { logActivityError, safeStep, takeStepFailures } = require('./shared');

const HAPPY_ACTIVITY_ID = '2026110104';

async function autoHappy(): Promise<AutoResult> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    try {
        const state: any = await getShareRewardActivity(HAPPY_ACTIVITY_ID);
        if (!state || !state.active) return { claimed: 0, message: '快乐包活动未开放' };

        let claimed = 0;
        const done: string[] = [];
        if (state.canClaimDaily) {
            await safeStep('领取每日快乐值', async () => {
                await operateShareRewardActivity(HAPPY_ACTIVITY_ID, 'daily');
                claimed += 1;
                done.push('领取每日快乐值');
                log('活动任务', '快乐包领取每日快乐值', { module: 'activity_task', event: 'claim_happy_daily', result: 'ok' });
            });
            await sleep(500);
        }
        if (state.canShare) {
            await safeStep('每日首次分享', async () => {
                await operateShareRewardActivity(HAPPY_ACTIVITY_ID, 'share');
                claimed += 1;
                done.push('每日首次分享');
                log('活动任务', '快乐包执行每日首次分享', { module: 'activity_task', event: 'share_happy', result: 'ok' });
            });
            await sleep(500);
        }
        if (state.canClaimMilestones) {
            await safeStep('档位奖励', async () => {
                await operateShareRewardActivity(HAPPY_ACTIVITY_ID, 'milestones');
                claimed += 1;
                done.push('档位奖励');
                log('活动任务', '快乐包领取可用档位奖励', { module: 'activity_task', event: 'claim_happy_milestones', result: 'ok' });
            });
        }
        const failures = takeStepFailures();
        if (failures.length > 0) {
            const summary = new Error(failures.join('；'));
            return { claimed, message: `${done.length > 0 ? `快乐包${done.join('，')}，` : ''}${logActivityError('happy', '快乐包', summary)}` };
        }
        return { claimed, message: done.length > 0 ? `快乐包${done.join('，')}` : '' };
    } catch (e: any) {
        return { claimed: 0, message: logActivityError('happy', '快乐包', e) };
    }
}

module.exports = { autoHappy, HAPPY_ACTIVITY_ID };
