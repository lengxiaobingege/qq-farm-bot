export {};
/**
 * Worker 共享可变状态：原 worker.ts 的模块级 let 变量统一收进 st 对象。
 * 语义等价：闭包/模块间通过同一对象属性读写，与原先共享模块级变量一致。
 */
const { CONFIG } = require('../../config/config');
const { createScheduler } = require('../../services/scheduler');

interface WorkerRuntimeConfig {
    friendCheckIntervalMin: number;
    friendCheckIntervalMax: number;
    [key: string]: any;
}

const workerConfig = CONFIG as WorkerRuntimeConfig;

const st = {
    isRunning: false,
    loginReady: false,
    appliedConfigRevision: 0,
    unifiedSchedulerRunning: false,
    farmTaskRunning: false,
    nextFarmRunAt: 0,
    friendTaskRunning: false,
    nextFriendRunAt: 0,
    // 网关卡住时两条定时任务各自的退避时长（毫秒），0 表示按正常间隔跑
    businessBackoffMs: { farm: 0, friend: 0 },
    lastStatusHash: '',
    lastStatusSentAt: 0,
    onSellGain: null as ((deltaGold: any) => void) | null,
    onFarmHarvested: null as (() => Promise<void>) | null,
    onDogSkillGiftPending: null as ((count: any) => void) | null,
    harvestSellRunning: false,
    onWsError: null as ((payload: any) => void) | null,
    onDisconnected: null as ((payload: any) => void) | null,
    wsErrorHandledAt: 0,
    shutdownStarted: false,
    runtimeGeneration: 0,
    lastDailyRunDate: '',
    // 自动登录状态（仅在首次启动且无 Code 时使用）
    autoLoginFailCount: 0,
    autoLoginRetryTimer: null as any,
    isAutoLoginMode: false,
    autoLoginWxOpenId: '',
    autoLoginWxAccessToken: '',
    autoLoginWxRefreshToken: '',
    autoLoginLoginBuffer: '',
    autoLoginCanContinue: null as (() => boolean) | null,
    autoLoginOnLoginSuccess: null as (() => Promise<void>) | null,
    workerScheduler: createScheduler('worker'),
};

const AUTO_LOGIN_MAX_FAILS = 3;
const AUTO_LOGIN_RETRY_DELAY_MS = 30000;

module.exports = { st, workerConfig, AUTO_LOGIN_MAX_FAILS, AUTO_LOGIN_RETRY_DELAY_MS };
