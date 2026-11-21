export {};
/**
 * 定时调度：每日任务、农场/好友统一 tick、神秘商人定时器与网关退避。
 */
const { CONFIG } = require('../../config/config');
const { st, workerConfig } = require('./state');
const { getAutomation } = require('../../models/store');
const { checkAndClaimEmails } = require('../../services/email');
const { checkDailyShareStatus } = require('../../services/share');
const { performDailyMonthCardGift } = require('../../services/monthcard');
const { buyFreeGifts, getFreeGiftDailyState } = require('../../services/mall');
const { checkFarm, startFarmCheckLoop, stopFarmCheckLoop, refreshFarmCheckLoop, runFertilizerByConfig } = require('../../services/farm');
const { checkFriends, startFriendCheckLoop, stopFriendCheckLoop, refreshFriendCheckLoop } = require('../../services/friend');
const ranchAutomation = require('../../services/ranch/automation');
const { isRanchMarketEnabled } = require('../../config/ranch-automation');
const { checkAndClaimTasks } = require('../../services/task');
const { checkAndClaimActivityTasks } = require('../../services/activity-auto-task');
const { openFertilizerGiftPacksSilently } = require('../../services/warehouse');
const { runExclusiveAutomationTask } = require('../../services/automation-lock');
const { isGatewayHealthyForBusiness, nextBusinessBackoffMs } = require('../../utils/low-priority-gate');
const { getGatewayLoad } = require('../../utils/network');
const { runWithRequestClass } = require('../../utils/request-context');
const { getSystemDateKey, log, logWarn } = require('../../utils/utils');
const { sendToMaster } = require('./channel');
const { syncStatus } = require('./status-sync');

async function runDailyRoutines(force: boolean = false): Promise<void> {
    if (!st.loginReady) return;
    try {
        await checkAndClaimEmails(force);
        await checkDailyShareStatus(force);
        await performDailyMonthCardGift(force);
        await buyFreeGifts(force);
    } catch (e: any) {
        log('系统', `每日任务调度失败: ${e.message}`, { module: 'system', event: '每日任务', result: 'error' });
    }
}

function stopDailyRoutineTimer(): void {
    st.workerScheduler.clear('daily_routine_interval');
}

function startDailyRoutineTimer(runImmediately: boolean = true): void {
    stopDailyRoutineTimer();
    st.lastDailyRunDate = getSystemDateKey();
    // 新账号登录后强制执行一次领取
    if (runImmediately) runExclusiveAutomationTask('daily_routines', () => runDailyRoutines(true)).catch(() => null);
    st.workerScheduler.setIntervalTask('daily_routine_interval', 30 * 1000, () => {
        if (!st.loginReady) return;
        const today = getSystemDateKey();
        if (today === st.lastDailyRunDate) return;
        st.lastDailyRunDate = today;
        runExclusiveAutomationTask('daily_routines', () => runDailyRoutines(true)).catch(() => null);
    });
}

function normalizeIntervalRangeSec(minSec: any, maxSec: any, fallbackSec: any): { min: number; max: number } {
    const fallback = Math.max(1, Number.parseInt(fallbackSec, 10) || 1);
    let min = Math.max(1, Number.parseInt(minSec, 10) || fallback);
    let max = Math.max(1, Number.parseInt(maxSec, 10) || fallback);
    if (min > max) [min, max] = [max, min];
    return { min, max };
}

function applyIntervalsToRuntime(intervals: any): void {
    const data = (intervals && typeof intervals === 'object') ? intervals : {};

    const farmLegacy = Math.max(1, Number.parseInt(data.farm, 10) || 2);
    const farmRange = normalizeIntervalRangeSec(data.farmMin, data.farmMax, farmLegacy);
    CONFIG.farmCheckIntervalMin = farmRange.min * 1000;
    CONFIG.farmCheckIntervalMax = farmRange.max * 1000;
    CONFIG.farmCheckInterval = CONFIG.farmCheckIntervalMin;

    // 好友帮助、偷菜、放虫放草共用一个好友任务间隔。
    const helpMin = Number.parseInt(data.helpMin, 10) || 12;
    const helpMax = Number.parseInt(data.helpMax, 10) || 15;
    const stealMin = Number.parseInt(data.stealMin, 10) || 12;
    const stealMax = Number.parseInt(data.stealMax, 10) || 15;
    const friendMin = data.friendMin ?? Math.min(helpMin, stealMin);
    const friendMax = data.friendMax ?? Math.min(helpMax, stealMax);
    const friendRange = normalizeIntervalRangeSec(friendMin, friendMax, 12);
    workerConfig.friendCheckIntervalMin = friendRange.min * 1000;
    workerConfig.friendCheckIntervalMax = friendRange.max * 1000;
}

function randomIntervalMs(minMs: number, maxMs: number): number {
    const minSec = Math.max(1, Math.floor(Math.max(1000, Number(minMs) || 1000) / 1000));
    const maxSec = Math.max(minSec, Math.floor(Math.max(1000, Number(maxMs) || minSec * 1000) / 1000));
    if (maxSec === minSec) return minSec * 1000;
    const sec = minSec + Math.floor(Math.random() * (maxSec - minSec + 1));
    return sec * 1000;
}

function resetUnifiedSchedule(): void {
    const farmMs = randomIntervalMs(
        CONFIG.farmCheckIntervalMin || CONFIG.farmCheckInterval || 2000,
        CONFIG.farmCheckIntervalMax || CONFIG.farmCheckInterval || 2000
    );
    const friendMs = randomIntervalMs(
        workerConfig.friendCheckIntervalMin || 12000,
        workerConfig.friendCheckIntervalMax || 15000
    );
    const now = Date.now();
    st.nextFarmRunAt = now + farmMs;
    st.nextFriendRunAt = now + friendMs;
    st.nextPastureRunAt = now + randomIntervalMs(30000, 45000);
    st.businessBackoffMs.farm = 0;
    st.businessBackoffMs.friend = 0;
    st.businessBackoffMs.pasture = 0;
}

const BUSINESS_TICK_LABEL: Record<string, string> = { farm: '农场定时任务', friend: '好友定时任务', pasture: '牧场定时任务' };

function describeGatewayStall(load: any): string {
    const parts: string[] = [];
    const misses = Number(load && load.heartbeatMisses) || 0;
    const oldest = Number(load && load.oldestPendingAgeMs) || 0;
    if (misses > 0) parts.push(`心跳漏 ${misses} 次`);
    if (oldest > 0) parts.push(`最老在途 ${(oldest / 1000).toFixed(1)}s`);
    parts.push(`pending=${Number(load && load.pending) || 0}`);
    parts.push(`queued=${Number(load && load.queued) || 0}`);
    return parts.join(', ');
}

/**
 * 网关卡住（心跳漏拍或有在途请求超过 5 秒没回包）时定时任务整轮让路，把连接留给心跳和 ACE 上报。
 * 返回本轮需要推迟的毫秒数，0 表示可以正常跑。日志只在进入/退出退避时各打一次，避免刷屏。
 */
function nextBusinessTickDeferMs(kind: string): number {
    const load = getGatewayLoad();
    if (isGatewayHealthyForBusiness(load)) {
        if (st.businessBackoffMs[kind] > 0) {
            st.businessBackoffMs[kind] = 0;
            log('系统', `网关已恢复，${BUSINESS_TICK_LABEL[kind]}回到正常间隔`, {
                module: 'system',
                event: '网关退避',
                result: 'resume',
                requestClass: kind,
            });
        }
        return 0;
    }

    const firstDefer = st.businessBackoffMs[kind] === 0;
    const backoffMs = nextBusinessBackoffMs(st.businessBackoffMs[kind]);
    st.businessBackoffMs[kind] = backoffMs;
    if (firstDefer) {
        logWarn('系统', `网关无回包，${BUSINESS_TICK_LABEL[kind]}退避 ${Math.round(backoffMs / 1000)}s (${describeGatewayStall(load)})`, {
            module: 'system',
            event: '网关退避',
            result: 'defer',
            requestClass: kind,
            backoffMs,
        });
    }
    return backoffMs;
}

async function runFarmTick(auto: any): Promise<void> {
    if (st.farmTaskRunning) return;
    const generation = st.runtimeGeneration;
    const farmDeferMs = nextBusinessTickDeferMs('farm');
    if (farmDeferMs > 0) {
        st.nextFarmRunAt = Date.now() + farmDeferMs;
        return;
    }
    st.farmTaskRunning = true;
    const farmMs = randomIntervalMs(
        CONFIG.farmCheckIntervalMin || CONFIG.farmCheckInterval || 2000,
        CONFIG.farmCheckIntervalMax || CONFIG.farmCheckInterval || 2000
    );
    try {
        // 自己农场的定时任务统一挂在 farm 班次：优先级高于好友任务，低于用户前台操作。
        await runWithRequestClass('farm', async () => {
            if (auto.farm) await checkFarm();
            if (auto.task) await checkAndClaimTasks();
            if (auto.activity_task) {
                const activityResult = await checkAndClaimActivityTasks();
                // 活动提醒（如奶茶结算期）交给主进程统一推送，未配置渠道时自动跳过
                for (const push of activityResult?.pushes || []) {
                    if (push?.title && push?.content) sendToMaster({ type: 'push_notify', title: push.title, content: push.content });
                }
            }
            if (auto.fertilizer_gift) await openFertilizerGiftPacksSilently();
        });
    } catch {
        // ignore
    } finally {
        // 与好友/牧场班次一致：重连/切号使 generation 递增后，旧轮次的收尾不得覆盖新一轮调度状态。
        if (generation === st.runtimeGeneration) {
            st.nextFarmRunAt = Date.now() + farmMs;
            st.farmTaskRunning = false;
        }
    }
}

// ============ 好友统一任务：偷菜、帮助、放虫放草 ============
async function runFriendTick(auto: any): Promise<void> {
    if (st.friendTaskRunning) return;
    const generation = st.runtimeGeneration;
    const friendMs = randomIntervalMs(
        workerConfig.friendCheckIntervalMin || 12000,
        workerConfig.friendCheckIntervalMax || 15000
    );
    // friend 总开关仍控制好友任务总入口；关闭时也要推进到期时间，避免调度器每秒空转。
    if (!auto.friend) {
        st.nextFriendRunAt = Date.now() + friendMs;
        return;
    }

    const friendDeferMs = nextBusinessTickDeferMs('friend');
    if (friendDeferMs > 0) {
        st.nextFriendRunAt = Date.now() + friendDeferMs;
        return;
    }

    st.friendTaskRunning = true;
    try {
        // checkFriends 内部保留各自开关、经验上限、黑名单和每日捣乱次数判断。
        // 好友农场任务排在自己农场之后，前台操作永远优先于它。
        await runWithRequestClass('friend', () => checkFriends());
    } catch (e: any) {
        log('系统', `好友统一任务执行失败: ${e.message}`, { module: 'system', event: '好友统一任务', result: 'error' });
    } finally {
        if (generation === st.runtimeGeneration) {
            st.nextFriendRunAt = Date.now() + friendMs;
            st.friendTaskRunning = false;
            scheduleUnifiedNextTick();
        }
    }
}

// ============ 牧场统一任务（services/ranch：收获/催产/喂养/补草/清灾害/好友互动/每日任务） ============
// 说明：牧场由 services/ranch 模块统一实现。
// 该模块内部的自动化会自己判断每个动作的开关与到期时间，这里只负责按间隔把它唤醒；
// 它的写操作全部包裹在 transport.inScene(2) 里（切到牧场场景再发），这是之前牧场
// 收获/喂养一直失败的根本原因。

/** 牧场自动化是否有任何一项被开启（含每日任务/分享）。 */
function isRanchAutomationEnabled(auto: any): boolean {
    const { RANCH_SWITCH_KEYS } = require('../../config/ranch-automation');
    return RANCH_SWITCH_KEYS.some((key: string) => auto[key] === true);
}

async function runPastureTick(auto: any): Promise<void> {
    if (st.pastureTaskRunning) return;
    const generation = st.runtimeGeneration;
    const idleMs = Math.max(60_000, (Number(auto.ranch_check_minutes) || 5) * 60_000);
    if (!isRanchAutomationEnabled(auto)) {
        st.nextPastureRunAt = Date.now() + idleMs;
        return;
    }

    const pastureDeferMs = nextBusinessTickDeferMs('pasture');
    if (pastureDeferMs > 0) {
        st.nextPastureRunAt = Date.now() + pastureDeferMs;
        return;
    }

    st.pastureTaskRunning = true;
    try {
        // 牧场自动化复用农场班次：pasture 不是合法 RequestClass，会让环境班次注入失败，
        // 进而 isManualRequest() 恒真、巡查自我让路。farm 班次与农场共用互斥锁串行，不抢槽位。
        await runWithRequestClass('farm', async () => {
            await ranchAutomation.run({
                // 农场即将巡查时，牧场本轮让路，避免两边同时改写场景。
                farmDeadline: () => Number(st.nextFarmRunAt) || Number.POSITIVE_INFINITY,
            });
        });
    } catch (e: any) {
        log('牧场', `自动任务失败: ${e.message}`, { module: 'ranch', event: '牧场定时任务', result: 'error' });
    } finally {
        if (generation === st.runtimeGeneration) {
            // 下一轮以 ranch 模块内部的 nextCheckAt 为准（它自己按 ranch_check_minutes 排期）。
            const routine = ranchAutomation.getRoutineState();
            const nextAt = Number(routine && routine.nextCheckAt) || 0;
            st.nextPastureRunAt = Math.max(Date.now() + 30_000, nextAt > 0 ? nextAt : Date.now() + idleMs);
            st.pastureTaskRunning = false;
        }
    }
}

async function runUnifiedTick(): Promise<void> {
    if (!st.unifiedSchedulerRunning || !st.loginReady) return;
    const generation = st.runtimeGeneration;
    const now = Date.now();
    const dueFarm = now >= st.nextFarmRunAt;
    const dueFriend = now >= st.nextFriendRunAt;
    const duePasture = now >= st.nextPastureRunAt;
    if (!dueFarm && !dueFriend && !duePasture) return;

    const auto = getAutomation();
    // 好友按单次访问持锁，等待间隔不阻塞后续农场巡查。
    if (dueFarm) await runExclusiveAutomationTask('farm_tick', () => runFarmTick(auto));
    if (!st.unifiedSchedulerRunning || !st.loginReady || generation !== st.runtimeGeneration) return;
    // 牧场排在好友之后，共用互斥锁避免与农场写操作叠发。
    if (duePasture && !st.pastureTaskRunning) {
        await runExclusiveAutomationTask('pasture_tick', () => runPastureTick(auto));
    }
    if (!st.unifiedSchedulerRunning || !st.loginReady || generation !== st.runtimeGeneration) return;
    if (dueFriend && !st.friendTaskRunning) void runFriendTick(auto);
}

/** 集市货币到账时唤醒牧场兑换例程，无需等待六小时兜底检查。 */
function wakeRanchMarketExchange(): void {
    if (!st.loginReady || !isRanchMarketEnabled(getAutomation())) return;
    if (typeof ranchAutomation.requestMarketCheck === 'function') ranchAutomation.requestMarketCheck();
    scheduleUnifiedNextTick();
}

/** 集市到访场次变化时排队一次兑换检查。 */
function onRanchMarketVisitChanged(rotation: any): void {
    if (!st.loginReady || !isRanchMarketEnabled(getAutomation())) return;
    if (typeof ranchAutomation.noteMarketVisit === 'function' && ranchAutomation.noteMarketVisit(rotation)) scheduleUnifiedNextTick();
}

function scheduleUnifiedNextTick(): void {
    if (!st.unifiedSchedulerRunning) return;
    st.workerScheduler.clear('unified_next_tick');
    if (!st.loginReady) return;

    const now = Date.now();
    const nextAt = Math.min(
        st.farmTaskRunning ? Number.POSITIVE_INFINITY : (Number(st.nextFarmRunAt) || (now + 1000)),
        st.friendTaskRunning ? Number.POSITIVE_INFINITY : (Number(st.nextFriendRunAt) || (now + 1000)),
        st.pastureTaskRunning ? Number.POSITIVE_INFINITY : (Number(st.nextPastureRunAt) || (now + 1000))
    );
    if (!Number.isFinite(nextAt)) return;
    const delayMs = Math.max(1000, nextAt - now); // 最低 1 秒

    st.workerScheduler.setTimeoutTask('unified_next_tick', delayMs, async () => {
        try {
            await runUnifiedTick();
        } finally {
            scheduleUnifiedNextTick();
        }
    });
}

function startUnifiedScheduler(): void {
    if (st.unifiedSchedulerRunning) return;
    st.unifiedSchedulerRunning = true;
    resetUnifiedSchedule();
    scheduleUnifiedNextTick();
}

function stopUnifiedScheduler(): void {
    st.unifiedSchedulerRunning = false;
    st.farmTaskRunning = false;
    st.friendTaskRunning = false;
    st.pastureTaskRunning = false;
    st.workerScheduler.clear('unified_next_tick');
}

function stopMysteryShopTimer(): void {
    st.workerScheduler.clear('mystery_shop_initial');
    st.workerScheduler.clear('mystery_shop_interval');
    st.workerScheduler.clear('mystery_shop_after_save');
}

function runMysteryShopTick(): Promise<void> {
    if (!st.loginReady) return Promise.resolve();
    const {
        isMysteryShopWatchEnabled,
        checkMysteryShopTick,
    } = require('../../services/mystery-shop-auto');
    if (!isMysteryShopWatchEnabled(getAutomation())) return Promise.resolve();
    return checkMysteryShopTick().then((result: any) => {
        if (result?.push?.title && result?.push?.content) {
            sendToMaster({ type: 'push_notify', title: result.push.title, content: result.push.content });
        }
    });
}

function startMysteryShopTimer(): void {
    const {
        isMysteryShopWatchEnabled,
        AUTO_BUY_CHECK_INTERVAL_MS,
    } = require('../../services/mystery-shop-auto');
    stopMysteryShopTimer();
    if (!st.loginReady || !isMysteryShopWatchEnabled(getAutomation())) return;
    // 登录后先补一次即时检查：商人可能正在场，没必要干等一整个巡检间隔
    st.workerScheduler.setTimeoutTask('mystery_shop_initial', 30 * 1000, () => {
        runExclusiveAutomationTask('mystery_shop', runMysteryShopTick).catch(() => null);
    });
    st.workerScheduler.setIntervalTask('mystery_shop_interval', AUTO_BUY_CHECK_INTERVAL_MS, () => {
        runExclusiveAutomationTask('mystery_shop', runMysteryShopTick).catch(() => null);
    });
}

module.exports = {
    runDailyRoutines, stopDailyRoutineTimer, startDailyRoutineTimer,
    normalizeIntervalRangeSec, applyIntervalsToRuntime, randomIntervalMs,
    resetUnifiedSchedule, describeGatewayStall, nextBusinessTickDeferMs,
    runFarmTick, runFriendTick, runUnifiedTick, scheduleUnifiedNextTick,
    wakeRanchMarketExchange, onRanchMarketVisitChanged,
    startUnifiedScheduler, stopUnifiedScheduler, stopMysteryShopTimer,
    runMysteryShopTick, startMysteryShopTimer,
};
