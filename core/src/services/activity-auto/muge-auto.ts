/**
 * 牧歌初启自动化（2026-11-17 牧场限时活动，2026111700）
 *
 * 职责：自动领取已达标的免费奖励——
 *   - 兴牧庆典：全服饲养计数达标的档位奖励
 *   - 牧友同行：已开牧场好友数达标的档位奖励
 *   - 成长手册：已完成任务的奖励 + 章节累计档位奖励
 *
 * 不做：牧场人格测试 / 分享（主观操作且涉及社交分享，交由用户手动）。
 *
 * 安全性：所有领取都先读状态、只领 status=2（可领取）的项；muge-activity 的
 * perform 有严格回包确认 + 串行的 mutationTail 防重复提交；这里再逐类 sleep 串行，
 * 单步失败通过 safeStep 隔离，不影响后续步骤。
 */

import type { AutoResult } from './shared';
const { isAutomationOn } = require('../../models/store');
const { log, sleep } = require('../../utils/utils');
const { getMugeActivity, operateMugeActivity } = require('../muge-activity');
const { logActivityError, safeStep, takeStepFailures } = require('./shared');

async function autoMuge(): Promise<AutoResult> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    try {
        const state: any = await getMugeActivity();
        if (!state || !state.active) return { claimed: 0, message: '牧歌初启活动未开放' };

        let claimed = 0;
        const done: string[] = [];

        // 兴牧庆典：全服计数档位（tier_id=0 批量领所有可领档位）
        const celebrationTiers = (state.celebration?.tiers || []).filter((t: any) => t.status === 2);
        if (celebrationTiers.length) {
            const ok = await safeStep('兴牧庆典档位奖励', async () => {
                await operateMugeActivity('claimCelebration', {});
                claimed += 1;
                done.push(`兴牧庆典${celebrationTiers.length}档`);
                log('活动任务', `牧歌初启自动领取兴牧庆典档位奖励（${celebrationTiers.length}档）`, { module: 'activity_task', event: 'claim_muge_celebration', result: 'ok' });
            });
            if (ok) await sleep(500);
        }

        // 牧友同行：好友数档位
        const friendTiers = (state.friends?.tiers || []).filter((t: any) => t.status === 2);
        if (friendTiers.length) {
            const ok = await safeStep('牧友同行档位奖励', async () => {
                await operateMugeActivity('claimFriends', {});
                claimed += 1;
                done.push(`牧友同行${friendTiers.length}档`);
                log('活动任务', `牧歌初启自动领取牧友同行档位奖励（${friendTiers.length}档）`, { module: 'activity_task', event: 'claim_muge_friends', result: 'ok' });
            });
            if (ok) await sleep(500);
        }

        // 成长手册：已完成任务奖励
        const tasks = (state.handbook?.tasks || []).filter((t: any) => t.status === 2);
        if (tasks.length) {
            const ok = await safeStep('成长手册任务奖励', async () => {
                await operateMugeActivity('claimTask', {});
                claimed += 1;
                done.push(`成长手册任务${tasks.length}项`);
                log('活动任务', `牧歌初启自动领取成长手册任务奖励（${tasks.length}项）`, { module: 'activity_task', event: 'claim_muge_task', result: 'ok' });
            });
            if (ok) await sleep(500);
        }

        // 成长手册：章节累计档位奖励
        const handbookTiers = (state.handbook?.tiers || []).filter((t: any) => t.status === 2);
        if (handbookTiers.length) {
            await safeStep('成长手册章节奖励', async () => {
                await operateMugeActivity('claimHandbook', {});
                claimed += 1;
                done.push(`成长手册章节${handbookTiers.length}档`);
                log('活动任务', `牧歌初启自动领取成长手册章节奖励（${handbookTiers.length}档）`, { module: 'activity_task', event: 'claim_muge_handbook', result: 'ok' });
            });
        }

        const failures = takeStepFailures();
        if (failures.length > 0) {
            const summary = new Error(failures.join('；'));
            return { claimed, message: `${done.length > 0 ? `牧歌初启${done.join('，')}，` : ''}${logActivityError('muge', '牧歌初启', summary)}` };
        }
        return { claimed, message: done.length > 0 ? `牧歌初启${done.join('，')}` : '' };
    } catch (e: any) {
        return { claimed: 0, message: logActivityError('muge', '牧歌初启', e) };
    }
}

module.exports = { autoMuge };
