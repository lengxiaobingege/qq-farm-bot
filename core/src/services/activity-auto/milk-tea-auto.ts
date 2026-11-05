export {};
/**
 * 奶茶热销中自动化（2026110100，营业期 10-15 ~ 11-16）
 * 职责：领取收银台收益/员工工资、阶梯雇佣（24h→12h→4h，有多少花多少）、
 *       加速收银台、升级店铺、制作饮品、工作互动（涨薪）、成长基金
 */

import type { AutoResult } from './shared';
const { isAutomationOn } = require('../../models/store');
const { getServerTimeSec, toNum, log, sleep } = require('../../utils/utils');
const { getMilkTeaActivity, operateMilkTeaActivity } = require('../milk-tea');
const { logActivityError, safeStep, takeStepFailures } = require('./shared');


async function autoMilkTea(): Promise<AutoResult> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    takeStepFailures();
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
            // 优先 24 小时档（durationId 3），奶茶券不够时降档（12h→4h），有多少花多少
            const DURATIONS = [
                { durationId: 3, label: '24小时' },
                { durationId: 2, label: '12小时' },
                { durationId: 1, label: '4小时' },
            ];
            let hired = false;
            for (const dur of DURATIONS) {
                const list = dur.durationId === 3
                    ? hireState
                    : await getMilkTeaActivity('hireList', { durationId: dur.durationId });
                const wage = dur.durationId === 3 ? wageTotal : toNum(list.hire.wage_total);
                const ok = await safeStep(`雇佣员工(${dur.label})`, async () => {
                    await operateMilkTeaActivity('hire', {
                        targetGid,
                        expectedCosts: [{ id: 1041, count: wage }]
                    });
                    claimed += 1;
                    log('活动任务', `奶茶自动雇佣员工（${dur.label}档，工资 ${wage} 奶茶券）`, { module: 'activity_task', event: 'hire_milk_employee', result: 'ok', durationId: dur.durationId, wage });
                });
                if (ok) { hired = true; break; }
            }
            await sleep(500);
            if (!hired) { hireSkipped = true; break; }
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
        const failures = takeStepFailures();
        if (failures.length > 0) {
            const summary = new Error(failures.join('；'));
            return { claimed, message: `${claimed > 0 ? `奶茶完成 ${claimed} 项，` : ''}${logActivityError('milk', '奶茶', summary)}` };
        }
        return { claimed, message: claimed > 0 ? `奶茶完成 ${claimed} 项` : '奶茶无可执行任务' };
    } catch (e: any) {
        return { claimed: 0, message: logActivityError('milk', '奶茶', e) };
    }
}

module.exports = { autoMilkTea };
