export {};
/**
 * 活动任务自动化 - 自动执行活动中心的每日任务与奖励领取
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { getServerTimeSec, toNum, log, sleep } = require('../utils/utils');
const { isAutomationOn } = require('../models/store');
const { getAutumnActivity, operateAutumnActivity } = require('./autumn-activities');
const { getShareRewardActivity, operateShareRewardActivity } = require('./share-reward-activity');
const { getMilkTeaActivity, operateMilkTeaActivity } = require('./milk-tea');

const EVENT_IDS = {
    wish: '2026092401',
    happy: '2026092501',
};

const MILK_GROUP_ID = '2026110100';

async function autoWish(): Promise<{ claimed: number; message: string }> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    try {
        const state: any = await getAutumnActivity('wish');
        if (!state || !state.active) return { claimed: 0, message: '秋祈活动未开放' };

        let claimed = 0;
        if (state.canClaim) {
            await operateAutumnActivity('wish', 'claim');
            claimed += 1;
            log('活动任务', '秋祈领取今日签文奖励', { module: 'activity_task', event: 'claim_wish', result: 'ok' });
            await sleep(500);
        }
        if (state.canDraw) {
            await operateAutumnActivity('wish', 'draw', { chooseId: 1 });
            claimed += 1;
            log('活动任务', '秋祈执行今日祈愿', { module: 'activity_task', event: 'draw_wish', result: 'ok' });
        }
        return { claimed, message: claimed > 0 ? `秋祈完成 ${claimed} 项` : '秋祈无可执行任务' };
    } catch (e: any) {
        log('活动任务', `秋祈自动化失败: ${e.message}`, { module: 'activity_task', event: 'wish', result: 'error' });
        return { claimed: 0, message: `秋祈失败: ${e.message}` };
    }
}

async function autoHappy(): Promise<{ claimed: number; message: string }> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    try {
        const state: any = await getShareRewardActivity(EVENT_IDS.happy);
        if (!state || !state.active) return { claimed: 0, message: '快乐包活动未开放' };

        let claimed = 0;
        if (state.canClaimDaily) {
            await operateShareRewardActivity(EVENT_IDS.happy, 'daily');
            claimed += 1;
            log('活动任务', '快乐包领取每日快乐值', { module: 'activity_task', event: 'claim_happy_daily', result: 'ok' });
            await sleep(500);
        }
        if (state.canShare) {
            await operateShareRewardActivity(EVENT_IDS.happy, 'share');
            claimed += 1;
            log('活动任务', '快乐包执行每日首次分享', { module: 'activity_task', event: 'share_happy', result: 'ok' });
            await sleep(500);
        }
        if (state.canClaimMilestones) {
            await operateShareRewardActivity(EVENT_IDS.happy, 'milestones');
            claimed += 1;
            log('活动任务', '快乐包领取可用档位奖励', { module: 'activity_task', event: 'claim_happy_milestones', result: 'ok' });
        }
        return { claimed, message: claimed > 0 ? `快乐包完成 ${claimed} 项` : '快乐包无可执行任务' };
    } catch (e: any) {
        log('活动任务', `快乐包自动化失败: ${e.message}`, { module: 'activity_task', event: 'happy', result: 'error' });
        return { claimed: 0, message: `快乐包失败: ${e.message}` };
    }
}

async function autoMilkTea(): Promise<{ claimed: number; message: string }> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    try {
        const state: any = await getMilkTeaActivity('shop');
        if (!state || !state.active) return { claimed: 0, message: '奶茶活动未开放' };

        let claimed = 0;
        const now = getServerTimeSec();

        // 领取收银台收益
        const pending = Array.isArray(state.shop?.pending_rewards) ? state.shop.pending_rewards.filter((v: any) => toNum(v.count) > 0) : [];
        if (pending.length > 0) {
            await operateMilkTeaActivity('claim');
            claimed += 1;
            log('活动任务', '奶茶领取收银台收益', { module: 'activity_task', event: 'claim_milk_cashier', result: 'ok' });
            await sleep(500);
        }

        // 领取员工工资
        const slips = Array.isArray(state.work?.slips) ? state.work.slips : [];
        const hasWages = slips.some((v: any) => toNum(v.wage_status) === 1);
        if (hasWages) {
            await operateMilkTeaActivity('wages');
            claimed += 1;
            log('活动任务', '奶茶领取员工工资', { module: 'activity_task', event: 'claim_milk_wages', result: 'ok' });
            await sleep(500);
        }

        // 刷新店铺状态
        let shopState: any = await getMilkTeaActivity('shop');

        // 雇佣员工（雇佣所有空位，直到无空位或无可用员工）
        while (toNum(shopState.summary.shop_open_at) > 0) {
            const slots = Array.isArray(shopState.shop?.slots) ? shopState.shop.slots : [];
            const hasEmptySlot = !slots.some((v: any) => toNum(v.end_at) > now);
            if (!hasEmptySlot) break;
            const hireState = await getMilkTeaActivity('hireList', { durationId: 1 });
            const candidates = [...(hireState.hire?.friends || []), ...(hireState.hire?.robots || [])]
                .filter((v: any) => toNum(v.state) === 0 && toNum(v.rehire_available_at) <= now);
            if (candidates.length === 0) break;
            const target = candidates[0];
            const targetGid = String(target.friend?.gid || target.robot?.gid || target.gid);
            const wageTotal = toNum(hireState.hire.wage_total);
            await operateMilkTeaActivity('hire', {
                targetGid,
                expectedCosts: [{ id: 1041, count: wageTotal }]
            });
            claimed += 1;
            log('活动任务', '奶茶自动雇佣员工', { module: 'activity_task', event: 'hire_milk_employee', result: 'ok' });
            await sleep(500);
            shopState = await getMilkTeaActivity('shop');
        }

        // 加速收银台
        shopState = await getMilkTeaActivity('shop');
        if (!shopState.shop.is_settling && shopState.shop.sales_item_id && toNum(shopState.summary.shop_open_at) > 0) {
            await operateMilkTeaActivity('boost', {
                count: 1,
                expectedCosts: [{ id: toNum(shopState.shop.sales_item_id), count: 1 }]
            });
            claimed += 1;
            log('活动任务', '奶茶加速收银台', { module: 'activity_task', event: 'boost_milk_cashier', result: 'ok' });
            await sleep(500);
        }

        // 升级店铺
        shopState = await getMilkTeaActivity('shop');
        if (shopState.summary.can_upgrade && toNum(shopState.summary.shop_open_at) > 0) {
            await operateMilkTeaActivity('upgrade', {
                expectedLevel: toNum(shopState.summary.level)
            });
            claimed += 1;
            log('活动任务', '奶茶升级店铺', { module: 'activity_task', event: 'upgrade_milk_shop', result: 'ok' });
            await sleep(500);
        }

        // 制作饮品（使用所有可用果实）
        if (toNum(shopState.summary.shop_open_at) > 0 && !shopState.shop.is_settling) {
            const workshopState = await getMilkTeaActivity('workshop');
            const availableFruits = (workshopState.fruits || []).filter((v: any) => !v.locked && toNum(v.count) > 0);
            if (availableFruits.length > 0) {
                const fruitUids = availableFruits.map((v: any) => String(v.uid));
                await operateMilkTeaActivity('craft', { fruit_uids: fruitUids });
                claimed += availableFruits.length;
                log('活动任务', `奶茶制作饮品 ${availableFruits.length} 杯`, { module: 'activity_task', event: 'craft_milk_drink', result: 'ok' });
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
                await operateMilkTeaActivity('interact', {
                    interactionType: INTERACT_TYPE_RAISE_SALARY,
                    expectedShiftId: String(shift.shift_id)
                });
                claimed += 1;
                log('活动任务', '奶茶工作互动（涨薪）', { module: 'activity_task', event: 'interact_milk_work_raise', result: 'ok' });
                await sleep(500);
            }
        }

        // 解锁成长基金
        const fundState = await getMilkTeaActivity('fund');
        if (!fundState.fund.unlocked && fundState.fund.costs?.length > 0) {
            await operateMilkTeaActivity('unlock', {
                expectedCosts: fundState.fund.costs
            });
            claimed += 1;
            log('活动任务', '奶茶解锁成长基金', { module: 'activity_task', event: 'unlock_milk_fund', result: 'ok' });
            await sleep(500);
        }

        // 领取成长基金奖励
        const fundState2 = await getMilkTeaActivity('fund');
        if (fundState2.fund.unlocked && fundState2.fund.tiers?.some((v: any) => v.state === 2)) {
            await operateMilkTeaActivity('fundClaim');
            claimed += 1;
            log('活动任务', '奶茶领取成长基金奖励', { module: 'activity_task', event: 'claim_milk_fund', result: 'ok' });
        }

        return { claimed, message: claimed > 0 ? `奶茶完成 ${claimed} 项` : '奶茶无可执行任务' };
    } catch (e: any) {
        log('活动任务', `奶茶自动化失败: ${e.message}`, { module: 'activity_task', event: 'milk', result: 'error' });
        return { claimed: 0, message: `奶茶失败: ${e.message}` };
    }
}

async function autoPumpkin(): Promise<{ claimed: number; message: string }> {
    if (!isAutomationOn('activity_task')) return { claimed: 0, message: '自动化未开启' };
    try {
        const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', types.GetGroupRequest.encode({ group_id: MILK_GROUP_ID }).finish());
        const reply = types.MilkTeaGetGroupReply.decode(replyBody);
        const entry = (reply.group?.children || []).find((v: any) => String(v?.head?.activity_id) === '2026030200');
        if (!entry) return { claimed: 0, message: '南瓜活动未找到' };
        const head = entry.head;
        const now = getServerTimeSec();
        const active = toNum(head.begin_time) <= now && toNum(head.end_time) > now;
        if (!active) return { claimed: 0, message: '南瓜活动未开放' };

        // 南瓜乐翻天无 gameplayKey 与明确操作协议，仅记录活跃状态，不执行写操作
        log('活动任务', '南瓜乐翻天处于活跃状态，暂无可自动化操作', { module: 'activity_task', event: 'pumpkin', result: 'ok' });
        return { claimed: 0, message: '南瓜活动活跃中，暂无可自动化操作' };
    } catch (e: any) {
        log('活动任务', `南瓜自动化失败: ${e.message}`, { module: 'activity_task', event: 'pumpkin', result: 'error' });
        return { claimed: 0, message: `南瓜失败: ${e.message}` };
    }
}

async function checkAndClaimActivityTasks(): Promise<void> {
    if (!isAutomationOn('activity_task')) return;

    const results: string[] = [];
    const wishResult = await autoWish();
    if (wishResult.message) results.push(wishResult.message);

    const happyResult = await autoHappy();
    if (happyResult.message) results.push(happyResult.message);

    const milkResult = await autoMilkTea();
    if (milkResult.message) results.push(milkResult.message);

    const pumpkinResult = await autoPumpkin();
    if (pumpkinResult.message) results.push(pumpkinResult.message);

    if (results.length > 0) {
        log('活动任务', results.join('，'), { module: 'activity_task', event: 'activity_task_tick', result: 'ok' });
    }
}

module.exports = {
    checkAndClaimActivityTasks,
    autoWish,
    autoHappy,
    autoMilkTea,
    autoPumpkin,
};
