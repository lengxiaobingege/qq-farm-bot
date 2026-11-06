export {};
/**
 * 子进程 Worker - 负责运行单个账号的挂机逻辑
 */
const { ignoreError } = require('../utils/ignore-error');
const { parentPort, workerData } = require('node:worker_threads');

const { CONFIG, updateRuntimeConfig } = require('../config/config');
const { getLevelExpProgress, loadConfigs } = require('../config/gameConfig');
const { getAutomation, getPreferredSeed, getConfigSnapshot, applyConfigSnapshot } = require('../models/store');
const { checkAndClaimEmails } = require('../services/email');
const { getEmailDailyState } = require('../services/email');
const { checkFarm, startFarmCheckLoop, stopFarmCheckLoop, refreshFarmCheckLoop, getLandsDetail, getAvailableSeeds, purchaseSeed, runFarmOperation, runFertilizerByConfig, fertilizeOwnLand, fertilizeOwnLands, removeOwnPlants } = require('../services/farm');
const { checkFriends, startFriendCheckLoop, stopFriendCheckLoop, refreshFriendCheckLoop, getFriendsList, getFriendsListCacheOnly, getFriendLandsDetail, doFriendOperation, deleteFriend } = require('../services/friend');
const { getInteractRecords } = require('../services/interact');
const { processInviteCodes } = require('../services/invite');
const { autoBuyFertilizer, checkAndBuyFertilizerBoth, buyFreeGifts, getFreeGiftDailyState } = require('../services/mall');
const { performDailyMonthCardGift, getMonthCardDailyState } = require('../services/monthcard');
const { runExclusiveAutomationTask } = require('../services/automation-lock');
const { createScheduler, getSchedulerRegistrySnapshot } = require('../services/scheduler');
const { checkDailyShareStatus, getShareDailyState } = require('../services/share');
const { refreshActivityWindows } = require('../services/activity-windows');
const { resetSessionGains, recordOperation, initStatsWithPersistence, saveStats } = require('../services/stats');
const { initStatusBar, setStatusPlatform, statusData } = require('../services/status');
const { setRecordGoldExpHook } = require('../services/status');
const { cleanupTaskSystem, checkAndClaimTasks, getTaskClaimDailyState, getTaskDailyStateLikeApp, getGrowthTaskStateLikeApp } = require('../services/task');
const { checkAndClaimActivityTasks } = require('../services/activity-auto-task');
const {
    sellAllFruits,
    getBag,
    getBagItems,
    openFertilizerGiftPacksSilently,
} = require('../services/warehouse');
const { checkAndClaimDogSkillGifts } = require('../services/dog-skill-gifts');
const { isGatewayHealthyForBusiness, nextBusinessBackoffMs } = require('../utils/low-priority-gate');
const { connect, cleanup, getWs, getUserState, networkEvents, getGatewayLoad } = require('../utils/network');
const { loadProto } = require('../utils/proto');
const { runWithRequestClass } = require('../utils/request-context');
const { setLogHook, log, logWarn, toNum, getSystemDateKey, formatSystemDateTime24 } = require('../utils/utils');
const { WX_FARM_APP_ID, WxLoginService, credentialsFromAccount } = require('../services/wx-login/service');


const { st } = require('./worker/state');
const { sendToMaster, onMasterMessage } = require('./worker/channel');
const { runDailyRoutines, startUnifiedScheduler, startDailyRoutineTimer, startMysteryShopTimer } = require('./worker/schedules');
const { applyRuntimeConfig } = require('./worker/runtime-config');
const { attemptAutoLogin } = require('./worker/auto-login');
const { detachRuntimeListeners, quiesceBot, stopBot, handleTerminalDisconnect, onKickout } = require('./worker/lifecycle');
const { handleApiCall } = require('./worker/api-handlers');
const { syncStatus } = require('./worker/status-sync');

if (parentPort) {
    process.env.FARM_WORKER = '1';
    if (workerData && workerData.accountId && !process.env.FARM_ACCOUNT_ID) {
        process.env.FARM_ACCOUNT_ID = String(workerData.accountId);
    }
}

/**
 * 登录完成后的启动序列。
 *
 * 以前这里是四个错峰定时器（2s / 8s / 45s / 60s），结果每日礼包和任务要等到登录一分钟后
 * 才领，而且那时农场和好友循环已经在跑，几件事叠在一起反而把连接打满。
 * 现在改成登录动作一结束就**串行**跑完：串行意味着同一时刻只有一个业务请求在飞，
 * 既领得及时，也不会和心跳抢连接。
 */
async function runStartupSequence(canContinue: () => boolean = () => st.loginReady): Promise<void> {
    if (!st.loginReady || !canContinue()) return;

    // 这个序列跑在登录初始化的 await 链上（心跳和 ACE 此时已经启动），
    // 抛出去会被 network.ts 当成「登录初始化失败」直接掐掉连接，所以整段自己兜住异常。
    try {
        // 登录期要领的东西按 farm 班次串行跑完：邮件 / 每日分享 / 月卡 / 免费礼包 / VIP → 任务。
        await runWithRequestClass('farm', async () => {
            if (!st.loginReady || !canContinue()) return;
            await runExclusiveAutomationTask('daily_routines', () => runDailyRoutines(true));

            if (!st.loginReady || !canContinue()) return;
            try {
                await checkAndClaimTasks();
            } catch (e: any) {
                log('系统', `登录后领取任务失败: ${e.message}`, { module: 'system', event: '启动序列', result: 'error' });
            }
        });

        if (!st.loginReady || !canContinue()) return;
        // 登录串行部分跑完，才挂上主循环和后续周期性定时器，避免启动期任务叠跑。
        startFarmCheckLoop({ externalScheduler: true });
        startFriendCheckLoop({ externalScheduler: true });
        startUnifiedScheduler();
        startDailyRoutineTimer(false);
        startMysteryShopTimer();
    } catch (e: any) {
        log('系统', `登录启动序列执行失败: ${e.message}`, { module: 'system', event: '启动序列', result: 'error' });
    }
}

/**
 * 登录成功事件推送。
 * 退避与去重：首次上线必推；自动重登恢复的场景在 10 分钟内最多推一次，
 * 避免网络抖动导致频繁重连时刷屏。
 */
let lastLoginNotifyAt = 0;
function notifyLoginSuccess(recoveredFromAutoLogin: boolean): void {
    try {
        if (!st.loginReady) return;
        const now = Date.now();
        if (recoveredFromAutoLogin && now - lastLoginNotifyAt < 10 * 60 * 1000) return;
        lastLoginNotifyAt = now;
        const state = getUserState();
        const name = String(state.name || '').trim() || '账号';
        const level = toNum(state.level);
        const gold = toNum(state.gold);
        const title = recoveredFromAutoLogin ? '农场已恢复在线' : '农场登录成功';
        const modeText = recoveredFromAutoLogin ? '掉线后已自动重新登录' : '扫码登录成功';
        const content = `${name}（Lv${level}）${modeText}，当前金币 ${gold}。`;
        sendToMaster({ type: 'push_notify', title, content });
    } catch (e: any) {
        // 推送失败不影响登录主流程
        log('错误', `登录成功提醒发送异常: ${e && e.message ? e.message : e}`);
    }
}

// 接收主进程指令
onMasterMessage(async (msg: any) => {
    try {
        if (msg.type === 'start') {
            await startBot(msg.config);
        } else if (msg.type === 'stop') {
            await stopBot();
        } else if (msg.type === 'api_call') {
            handleApiCall(msg);
        } else if (msg.type === 'config_sync') {
            applyRuntimeConfig(msg.config || {}, true);
        } else if (msg.type === 'reload_config') {
            if (typeof loadConfigs === 'function') loadConfigs();
        }
    } catch (e: any) {
        sendToMaster({
            type: 'error',
            error: {
                message: String(e?.message || e || 'Worker error'),
                code: e?.code,
                errorMessage: e?.errorMessage ?? e?.error_message,
                name: String(e?.name || 'Error'),
            },
        });
    }
});

async function startBot(config: any): Promise<void> {
    if (st.isRunning) return;
    st.isRunning = true;
    st.shutdownStarted = false;
    st.runtimeGeneration += 1;

    const { code, platform, systemTimeZone, systemServerUrl, systemClientVersion, systemWxClientVersion, systemDeviceInfo, wxOpenId, wxAccessToken, wxRefreshToken, loginBuffer } = config;

    // 保存微信凭证，以便连接断开后自动换码重连（不论是 code 登录还是自动登录启动）
    st.autoLoginWxOpenId = String(wxOpenId || '');
    st.autoLoginWxAccessToken = String(wxAccessToken || '');
    st.autoLoginWxRefreshToken = String(wxRefreshToken || '');
    st.autoLoginLoginBuffer = String(loginBuffer || '');

    if (systemTimeZone !== undefined) updateRuntimeConfig({ timeZone: systemTimeZone });
    if (systemServerUrl !== undefined) updateRuntimeConfig({ serverUrl: String(systemServerUrl || '') });
    if (systemDeviceInfo) updateRuntimeConfig({ deviceInfo: systemDeviceInfo });
    if (systemWxClientVersion !== undefined) updateRuntimeConfig({ wxClientVersion: String(systemWxClientVersion || '') });
    if (systemClientVersion !== undefined) updateRuntimeConfig({ clientVersion: String(systemClientVersion || '') });
    CONFIG.platform = 'wx';
    // 注意：间隔配置由 applyIntervalsToRuntime 统一处理，不要在这里覆盖

    await loadProto();

    log('系统', '正在连接服务器...');

    // 加载保存的配置
    applyRuntimeConfig(getConfigSnapshot(), false);

    initStatusBar();
    setStatusPlatform(CONFIG.platform);

    if (st.onWsError) {
        networkEvents.off('ws_error', st.onWsError);
        st.onWsError = null;
    }
    st.onWsError = (payload: any) => {
        if ((Number(payload?.code) || 0) !== 400) return;
        const now = Date.now();
        if (now - st.wsErrorHandledAt < 4000) return;
        st.wsErrorHandledAt = now;
        log('系统', '连接被拒绝，可能需要更新 Code');
        sendToMaster({
            type: 'ws_error',
            code: 400,
            message: payload?.message || '',
        });
        if (st.isRunning) {
            handleTerminalDisconnect({
                source: 'ws_error',
                code: 400,
                reason: payload?.message || '连接被拒绝',
                phase: 'connecting',
            });
        }
    };
    networkEvents.on('ws_error', st.onWsError);

    if (st.onDisconnected) {
        networkEvents.off('disconnected', st.onDisconnected);
    }
    st.onDisconnected = (payload: any) => {
        handleTerminalDisconnect(payload);
    };
    networkEvents.on('disconnected', st.onDisconnected);
    networkEvents.on('kickout', onKickout);

    const generation = st.runtimeGeneration;
    const canContinueLogin = (): boolean => st.isRunning && !st.shutdownStarted && generation === st.runtimeGeneration;
    const onLoginSuccess = async (): Promise<void> => {
        if (!canContinueLogin() || st.loginReady) return;
        // 先记录登录来源再重置标志：true 表示掉线后自动恢复，false 表示扫码登录
        const recoveredFromAutoLogin = st.isAutoLoginMode;
        st.loginReady = true;
        st.isAutoLoginMode = false;
        st.autoLoginFailCount = 0;
        if (st.autoLoginRetryTimer) {
            clearTimeout(st.autoLoginRetryTimer);
            st.autoLoginRetryTimer = null;
        }
        notifyLoginSuccess(recoveredFromAutoLogin);
        if (st.onSellGain) {
            networkEvents.off('sell', st.onSellGain);
        }
        st.onSellGain = (deltaGold: any) => {
            const delta = Number(deltaGold || 0);
            if (!Number.isFinite(delta) || delta <= 0) return;
            recordOperation('sell', 1);
        };
        networkEvents.on('sell', st.onSellGain);

        if (st.onFarmHarvested) {
            networkEvents.off('farmHarvested', st.onFarmHarvested);
        }
        st.onFarmHarvested = async () => {
            if (st.harvestSellRunning) return;
            if (!getAutomation().sell) return;
            st.harvestSellRunning = true;
            try {
                await runExclusiveAutomationTask('harvest_sell', sellAllFruits);
            } catch (e: any) {
                log('仓库', `收获后自动出售失败: ${e.message}`, { module: 'warehouse', event: '收获后出售', result: 'error' });
            } finally {
                st.harvestSellRunning = false;
            }
        };
        networkEvents.on('farmHarvested', st.onFarmHarvested);

        if (st.onDogSkillGiftPending) {
            networkEvents.off('dogSkillGiftPending', st.onDogSkillGiftPending);
        }
        st.onDogSkillGiftPending = (count: any) => {
            const pendingCount = Math.max(0, toNum(count));
            if (pendingCount <= 0 || !st.loginReady) return;
            runExclusiveAutomationTask('dog_skill_gifts', () => checkAndClaimDogSkillGifts(pendingCount)).catch(() => null);
        };
        networkEvents.on('dogSkillGiftPending', st.onDogSkillGiftPending);

        try {
            await runExclusiveAutomationTask('activity_windows_refresh', refreshActivityWindows);
        } catch (e: any) {
            logWarn('仓库', `活动时间初始化失败: ${e?.message || e}`);
        }
        if (!canContinueLogin()) return;

        // 登录后只拉一次背包，同时初始化点券（1002）和金豆豆（1005）
        try {
            const bagReply = await runExclusiveAutomationTask('login_bag_init', getBag);
            const items = getBagItems(bagReply);
            let coupon = 0;
            let goldBean = 0;
            for (const it of (items || [])) {
                const id = toNum(it && it.id);
                if (id === 1002) {
                    coupon = toNum(it.count);
                } else if (id === 1005) {
                    goldBean = toNum(it.count);
                }
            }
            const state = getUserState();
            state.coupon = Math.max(0, coupon);
            state.goldBean = Math.max(0, goldBean);
        } catch {
            // ignore
        }
        // 登录成功后，以当前金币/经验/点券作为统计基线，并清空会话增量
        const latest = getUserState();
        const accountId = process.env.FARM_ACCOUNT_ID || '';
        initStatsWithPersistence(accountId, Number(latest.gold || 0), Number(latest.exp || 0), Number(latest.coupon || 0));
        resetSessionGains();

        // 登录成功后启动各模块
        await runExclusiveAutomationTask('invite_codes', processInviteCodes);
        if (!canContinueLogin()) return;
        if (getAutomation().fertilizer_gift) {
            await runExclusiveAutomationTask('fertilizer_gifts_login', openFertilizerGiftPacksSilently).catch(() => 0);
            if (!canContinueLogin()) return;
        }

        if (!canContinueLogin()) return;
        // 立即发送一次状态，再串行跑启动序列（不阻塞状态上报）
        syncStatus();
        await runExclusiveAutomationTask('startup_sequence', () => runStartupSequence(canContinueLogin));
    };

    // 如果没有 Code 但有微信登录凭证，进入自动登录模式
    const hasWxCreds = !!(String(wxOpenId || '').trim() && String(wxAccessToken || '').trim()) || String(loginBuffer || '').trim();
    if (!code && hasWxCreds) {
        st.isAutoLoginMode = true;
        st.autoLoginFailCount = 0;
        st.autoLoginWxOpenId = String(wxOpenId || '');
        st.autoLoginWxAccessToken = String(wxAccessToken || '');
        st.autoLoginWxRefreshToken = String(wxRefreshToken || '');
        st.autoLoginLoginBuffer = String(loginBuffer || '');
        st.autoLoginCanContinue = canContinueLogin;
        st.autoLoginOnLoginSuccess = onLoginSuccess;
        await attemptAutoLogin(st.autoLoginWxOpenId, st.autoLoginWxAccessToken, st.autoLoginWxRefreshToken, st.autoLoginLoginBuffer, canContinueLogin, onLoginSuccess);
        return;
    }

    st.autoLoginCanContinue = canContinueLogin;
    st.autoLoginOnLoginSuccess = onLoginSuccess;
    connect(code, onLoginSuccess);

    // 启动定时状态同步
    st.workerScheduler.setIntervalTask('status_sync', 3000, syncStatus, { preventOverlap: true });
}
