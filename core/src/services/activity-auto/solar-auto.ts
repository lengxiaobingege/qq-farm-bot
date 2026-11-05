export {};
/**
 * 节令日历自动化
 * - 节令开始（开放窗口内）才执行操作；窗口外不打扰、不写日志
 * - 当天（服务器日期）只执行一次：查询一次 → 领取奖励/答题/领季度奖 → 记账静默
 * - 答题使用本地题库（src/activity-data/solar-calendar.json）的标准答案
 */

import type { AutoResult } from './shared';
const { isAutomationOn } = require('../../models/store');
const { getServerTimeSec, toNum, log, sleep } = require('../../utils/utils');
const { getSolarCalendar, operateSolarCalendar } = require('../solar-calendar');
const { logActivityError } = require('./shared');

// 记录最近一次执行的服务器日期，同一天内不再查询/操作
let lastSolarRunDay = '';

function serverDayKey(serverTimeSec: number): string {
    return new Date(serverTimeSec * 1000).toISOString().slice(0, 10);
}

async function autoSolar(): Promise<AutoResult> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    try {
        const todayKey = serverDayKey(getServerTimeSec());
        if (todayKey === lastSolarRunDay) return { claimed: 0, message: '' };

        const calendar: any = await getSolarCalendar();
        const now = toNum(calendar.serverTime);
        // 查询成功即视为今天已执行过；明天(服务器时间)才会再次检查
        lastSolarRunDay = serverDayKey(now);
        // 只有节令开始（开放窗口内）才执行操作；窗口外不打扰、不写日志
        const active = (calendar.events || []).filter((v: any) =>
            toNum(v.startTime) <= now && toNum(v.endTime) >= now);
        if (active.length === 0) return { claimed: 0, message: '' };

        let claimed = 0;
        const done: string[] = [];
        for (const event of active) {
            if (event.canClaim) {
                await operateSolarCalendar('claim', { id: event.id });
                claimed += 1;
                done.push(`节令「${event.name}」领取奖励`);
                log('活动任务', `节令「${event.name}」自动领取奖励`, { module: 'activity_task', event: 'claim_solar', result: 'ok', solarId: event.id });
                await sleep(500);
            }
            if (event.canAnswer && event.question && event.answerIndex !== null) {
                const result: any = await operateSolarCalendar('answer', {
                    id: event.id,
                    optionIndex: event.answerIndex,
                    expectedQuestion: event.question,
                });
                claimed += 1;
                done.push(`节令「${event.name}」${result?.correct === false ? '答题' : '答对'}`);
                log('活动任务', `节令「${event.name}」自动答题${result?.correct === false ? '（答错）' : '正确'}`, { module: 'activity_task', event: 'answer_solar', result: 'ok', solarId: event.id });
                await sleep(500);
            }
        }
        // 季度奖励点亮后可领
        for (const season of calendar.seasons || []) {
            if (season.canClaim) {
                await operateSolarCalendar('season', { id: season.id });
                claimed += 1;
                log('活动任务', `节令季度「${season.name}」自动领取累计奖励`, { module: 'activity_task', event: 'claim_solar_season', result: 'ok', seasonId: season.id });
                await sleep(500);
            }
        }
        return { claimed, message: done.length > 0 ? done.join('，') : (claimed > 0 ? `节令完成 ${claimed} 项` : '') };
    } catch (e: any) {
        return { claimed: 0, message: logActivityError('solar', '节令日历', e) };
    }
}

module.exports = { autoSolar };
