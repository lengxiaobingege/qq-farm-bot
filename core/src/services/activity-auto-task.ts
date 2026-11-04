export {};
/**
 * 活动任务自动化 - 自动执行活动中心的每日任务与奖励领取
 */

const { types } = require('../utils/proto');
const { getServerTimeSec, toNum, log, sleep } = require('../utils/utils');
const { isAutomationOn } = require('../models/store');
const { getMilkTeaActivity, operateMilkTeaActivity } = require('./milk-tea');
const { getSolarCalendar, operateSolarCalendar } = require('./solar-calendar');

const MILK_GROUP_ID = '2026110100';

// 同一活动的同一错误短时间内不重复写日志，避免活动结束/资源不足时每个 tick 刷屏
const ERROR_REPEAT_WINDOW_MS = 30 * 60 * 1000;
const lastErrorByActivity = new Map<string, { message: string; at: number }>();

function logActivityError(key: string, label: string, e: any): string {
    const message = String(e?.message || e);
    const now = Date.now();
    const last = lastErrorByActivity.get(key);
    if (last && last.message === message && now - last.at < ERROR_REPEAT_WINDOW_MS) {
        return `${label}失败(已静默): ${message}`;
    }
    lastErrorByActivity.set(key, { message, at: now });
    const ended = e?.code === 'AUTUMN_ACTIVITY_ENDED' || e?.code === 'SHARE_REWARD_ENDED';
    log('活动任务', `${label}${ended ? '已结束或未开放' : `自动化失败: ${message}`}`, {
        module: 'activity_task', event: key, result: 'error',
    });
    return `${label}失败: ${message}`;
}

// 单步失败不阻断整轮：奶茶某一步（如奶茶券不足）抛错时跳过该步，继续后续步骤
const stepFailures: string[] = [];
async function safeStep(label: string, fn: () => Promise<void>): Promise<boolean> {
    try {
        await fn();
        return true;
    } catch (e: any) {
        const message = String(e?.message || e);
        stepFailures.push(`${label}: ${message}`);
        return false;
    }
}

async function autoMilkTea(): Promise<{ claimed: number; message: string }> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    stepFailures.length = 0;
    try {
        const state: any = await getMilkTeaActivity('shop');
        if (!state || !state.active) return { claimed: 0, message: '奶茶活动未开放' };

        let claimed = 0;
        const now = getServerTimeSec();

        // 领取收银台收益
        const pending = Array.isArray(state.shop?.pending_rewards) ? state.shop.pending_rewards.filter((v: any) => toNum(v.count) > 0) : [];
        if (pending.length > 0) {
            await safeStep('领取收银台收益', async () => {
                await operateMilkTeaActivity('claim');
                claimed += 1;
                log('活动任务', '奶茶领取收银台收益', { module: 'activity_task', event: 'claim_milk_cashier', result: 'ok' });
            });
            await sleep(500);
        }

        // 领取员工工资
        const slips = Array.isArray(state.work?.slips) ? state.work.slips : [];
        const hasWages = slips.some((v: any) => toNum(v.wage_status) === 1);
        if (hasWages) {
            await safeStep('领取员工工资', async () => {
                await operateMilkTeaActivity('wages');
                claimed += 1;
                log('活动任务', '奶茶领取员工工资', { module: 'activity_task', event: 'claim_milk_wages', result: 'ok' });
            });
            await sleep(500);
        }

        // 刷新店铺状态
        let shopState: any = await getMilkTeaActivity('shop');

        // 雇佣员工（雇佣所有空位，直到无空位或无可用员工；奶茶券不足则放弃雇佣这一轮）
        let hireSkipped = false;
        while (toNum(shopState.summary.shop_open_at) > 0 && !hireSkipped) {
            const slots = Array.isArray(shopState.shop?.slots) ? shopState.shop.slots : [];
            const hasEmptySlot = !slots.some((v: any) => toNum(v.end_at) > now);
            if (!hasEmptySlot) break;
            const hireState = await getMilkTeaActivity('hireList', { durationId: 3 });
            const candidates = [...(hireState.hire?.friends || []), ...(hireState.hire?.robots || [])]
                .filter((v: any) => toNum(v.state) === 0 && toNum(v.rehire_available_at) <= now);
            if (candidates.length === 0) break;
            const target = candidates[0];
            const targetGid = String(target.friend?.gid || target.robot?.gid || target.gid);
            const wageTotal = toNum(hireState.hire.wage_total);
            const ok = await safeStep('雇佣员工', async () => {
                await operateMilkTeaActivity('hire', {
                    targetGid,
                    expectedCosts: [{ id: 1041, count: wageTotal }]
                });
                claimed += 1;
                log('活动任务', '奶茶自动雇佣员工', { module: 'activity_task', event: 'hire_milk_employee', result: 'ok' });
            });
            await sleep(500);
            if (!ok) { hireSkipped = true; break; }
            shopState = await getMilkTeaActivity('shop');
        }

        // 加速收银台
        shopState = await getMilkTeaActivity('shop');
        if (!shopState.shop.is_settling && shopState.shop.sales_item_id && toNum(shopState.summary.shop_open_at) > 0) {
            await safeStep('加速收银台', async () => {
                await operateMilkTeaActivity('boost', {
                    count: 1,
                    expectedCosts: [{ id: toNum(shopState.shop.sales_item_id), count: 1 }]
                });
                claimed += 1;
                log('活动任务', '奶茶加速收银台', { module: 'activity_task', event: 'boost_milk_cashier', result: 'ok' });
            });
            await sleep(500);
        }

        // 升级店铺
        shopState = await getMilkTeaActivity('shop');
        if (shopState.summary.can_upgrade && toNum(shopState.summary.shop_open_at) > 0) {
            await safeStep('升级店铺', async () => {
                await operateMilkTeaActivity('upgrade', {
                    expectedLevel: toNum(shopState.summary.level)
                });
                claimed += 1;
                log('活动任务', '奶茶升级店铺', { module: 'activity_task', event: 'upgrade_milk_shop', result: 'ok' });
            });
            await sleep(500);
        }

        // 制作饮品（使用所有可用果实）
        if (toNum(shopState.summary.shop_open_at) > 0 && !shopState.shop.is_settling) {
            const workshopState = await getMilkTeaActivity('workshop');
            const availableFruits = (workshopState.fruits || []).filter((v: any) => !v.locked && toNum(v.count) > 0);
            if (availableFruits.length > 0) {
                await safeStep('制作饮品', async () => {
                    const fruitUids = availableFruits.map((v: any) => String(v.uid));
                    await operateMilkTeaActivity('craft', { fruit_uids: fruitUids });
                    claimed += availableFruits.length;
                    log('活动任务', `奶茶制作饮品 ${availableFruits.length} 杯`, { module: 'activity_task', event: 'craft_milk_drink', result: 'ok' });
                });
                await sleep(500);
            }
        }

        // 工作互动（需店铺已开业）
        let workState = null;
        if (toNum(shopState.summary.shop_open_at) > 0) {
            workState = await getMilkTeaActivity('work');
        }
        const shift = workState?.work?.my_shift;
        // interaction_type 取 1-5，"涨薪"为最后一个，即 5
        const INTERACT_TYPE_RAISE_SALARY = 5;
        if (shift && !workState.work.interact_done && toNum(shift.end_at) > now && toNum(shift.interact_count) < toNum(shift.interact_limit)) {
            const interactions = workState.interactions || workState.work?.interactions || [];
            const interaction = interactions.find((v: any) => v.interaction_id === INTERACT_TYPE_RAISE_SALARY && v.ready);
            if (interaction) {
                await safeStep('工作互动（涨薪）', async () => {
                    await operateMilkTeaActivity('interact', {
                        interactionType: INTERACT_TYPE_RAISE_SALARY,
                        expectedShiftId: String(shift.shift_id)
                    });
                    claimed += 1;
                    log('活动任务', '奶茶工作互动（涨薪）', { module: 'activity_task', event: 'interact_milk_work_raise', result: 'ok' });
                });
                await sleep(500);
            }
        }

        // 解锁成长基金
        const fundState = await getMilkTeaActivity('fund');
        if (!fundState.fund.unlocked && fundState.fund.costs?.length > 0) {
            await safeStep('解锁成长基金', async () => {
                await operateMilkTeaActivity('unlock', {
                    expectedCosts: fundState.fund.costs
                });
                claimed += 1;
                log('活动任务', '奶茶解锁成长基金', { module: 'activity_task', event: 'unlock_milk_fund', result: 'ok' });
            });
            await sleep(500);
        }

        // 领取成长基金奖励
        const fundState2 = await getMilkTeaActivity('fund');
        if (fundState2.fund.unlocked && fundState2.fund.tiers?.some((v: any) => v.state === 2)) {
            await safeStep('领取成长基金奖励', async () => {
                await operateMilkTeaActivity('fundClaim');
                claimed += 1;
                log('活动任务', '奶茶领取成长基金奖励', { module: 'activity_task', event: 'claim_milk_fund', result: 'ok' });
            });
        }

        // 有单步失败时汇总上报（沿用 30 分钟去重）
        if (stepFailures.length > 0) {
            const summary = new Error(stepFailures.join('；'));
            return { claimed, message: `${claimed > 0 ? `奶茶完成 ${claimed} 项，` : ''}${logActivityError('milk', '奶茶', summary)}` };
        }
        return { claimed, message: claimed > 0 ? `奶茶完成 ${claimed} 项` : '奶茶无可执行任务' };
    } catch (e: any) {
        return { claimed: 0, message: logActivityError('milk', '奶茶', e) };
    }
}

// 节令日历当天只执行一次：记录最近一次执行的服务器日期，同一天内不再查询/操作
let lastSolarRunDay = '';

function serverDayKey(serverTimeSec: number): string {
    return new Date(serverTimeSec * 1000).toISOString().slice(0, 10);
}

async function autoSolar(): Promise<{ claimed: number; message: string }> {
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

async function checkAndClaimActivityTasks(): Promise<void> {
    if (!isAutomationOn('activity_task')) return;

    const results: string[] = [];
    const milkResult = await autoMilkTea();
    if (milkResult.message) results.push(milkResult.message);

    const solarResult = await autoSolar();
    if (solarResult.message) results.push(solarResult.message);

    if (results.length > 0) {
        log('活动任务', results.join('，'), { module: 'activity_task', event: 'activity_task_tick', result: 'ok' });
    }
}

module.exports = {
    checkAndClaimActivityTasks,
    autoMilkTea,
    autoSolar,
};
