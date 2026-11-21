export {};
/**
 * 状态同步：聚合运行状态并按变更/间隔推送给主进程。
 */
const { parentPort } = require('node:worker_threads');
const { st } = require('./state');
const { getUserState, getWs } = require('../../utils/network');
const { statusData } = require('../../services/status');
const { getLevelExpProgress } = require('../../config/gameConfig');
const { getAutomation, getPreferredSeed } = require('../../models/store');
const { sendToMaster } = require('./channel');

function syncStatus(force: boolean = false): void {
    if (!process.send && !parentPort) return;

    const userState = getUserState();
    const ws = getWs();
    const connected = !!(st.loginReady && ws && ws.readyState === 1);

    let expProgress: any = null;
    const level = (userState.level ?? statusData.level ?? 0);
    const exp = (userState.exp ?? statusData.exp ?? 0);

    if (level > 0 && exp >= 0) {
        expProgress = getLevelExpProgress(level, exp);
    }

    const limits = require('../../services/friend').getOperationLimits();
    const fullStats = require('../../services/stats').getStats(statusData, userState, connected, limits);
    const nowMs = Date.now();
    const farmRemainSec = Math.max(0, Math.ceil((Number(st.nextFarmRunAt || 0) - nowMs) / 1000));
    const friendRemainSec = Math.max(0, Math.ceil((Number(st.nextFriendRunAt || 0) - nowMs) / 1000));
    const visitStrategy = require('../../services/friend/visit-strategy');
    const friendQuiet = !!visitStrategy.inFriendQuietHours();
    const farmQuiet = !!visitStrategy.inFarmQuietHours();
    fullStats.nextChecks = {
        farmRemainSec,
        helpRemainSec: friendRemainSec,
        stealRemainSec: friendRemainSec,
        friendRemainSec,
        farmQuiet,
        friendQuiet,
        helpQuiet: friendQuiet,
        stealQuiet: friendQuiet,
    };

    fullStats.automation = getAutomation();
    fullStats.preferredSeed = getPreferredSeed();
    fullStats.levelProgress = expProgress;
    fullStats.levelForecast = require('../../services/level-forecast').getLevelForecast(
        userState, expProgress, fullStats, fullStats.automation, farmQuiet,
    );
    fullStats.configRevision = st.appliedConfigRevision;
    const hash = [
        Number(connected),
        fullStats.status && fullStats.status.gold,
        fullStats.status && fullStats.status.exp,
        fullStats.status && fullStats.status.level,
        fullStats.status && fullStats.status.coupon,
        fullStats.sessionGoldGained,
        fullStats.sessionExpGained,
        fullStats.operations && fullStats.operations.harvest,
        fullStats.operations && fullStats.operations.plant,
        fullStats.operations && fullStats.operations.steal,
        farmRemainSec,
        friendRemainSec,
        Number(farmQuiet),
        Number(friendQuiet),
        st.appliedConfigRevision,
        fullStats.preferredSeed,
        fullStats.levelForecast && fullStats.levelForecast.source,
        fullStats.levelForecast && fullStats.levelForecast.estimatedAt,
        fullStats.levelForecast && fullStats.levelForecast.scheduledExp,
    ].join('|');
    const now = Date.now();
    if (force || hash !== st.lastStatusHash || now - st.lastStatusSentAt > 8000) {
        st.lastStatusHash = hash;
        st.lastStatusSentAt = now;
        sendToMaster({ type: 'status_sync', data: fullStats });
    }
}
module.exports = { syncStatus };
