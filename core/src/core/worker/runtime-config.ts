export {};
/**
 * 配置快照下发：应用自动化开关、间隔与系统配置，并按需触发即时任务。
 */
const { updateRuntimeConfig } = require('../../config/config');
const { st, workerConfig } = require('./state');
const { getAutomation, applyConfigSnapshot } = require('../../models/store');
const { applyIntervalsToRuntime, resetUnifiedSchedule, scheduleUnifiedNextTick, startMysteryShopTimer } = require('./schedules');
const { refreshFarmCheckLoop, runFertilizerByConfig } = require('../../services/farm');
const { refreshFriendCheckLoop } = require('../../services/friend');
const { runExclusiveAutomationTask } = require('../../services/automation-lock');
const { log, logWarn } = require('../../utils/utils');
const { syncStatus } = require('./status-sync');

function applyRuntimeConfig(snapshot: any, syncNow: boolean = false): number {
    const rev = Number((snapshot || {}).__revision || 0);
    if (rev > 0 && rev < st.appliedConfigRevision) {
        if (syncNow) syncStatus();
        return st.appliedConfigRevision;
    }

    const prevAuto = getAutomation();
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    if (snapshot && snapshot.systemTimeZone !== undefined) {
        updateRuntimeConfig({ timeZone: snapshot.systemTimeZone });
    }
    if (!st.loginReady && snapshot && snapshot.systemServerUrl !== undefined) {
        updateRuntimeConfig({ serverUrl: String(snapshot.systemServerUrl || '') });
    }
    if (!st.loginReady && snapshot?.systemDeviceInfo) {
        updateRuntimeConfig({ deviceInfo: snapshot.systemDeviceInfo });
    }
    if (!st.loginReady && snapshot?.systemWxClientVersion !== undefined) {
        updateRuntimeConfig({ wxClientVersion: String(snapshot.systemWxClientVersion || '') });
    }
    if (!st.loginReady && snapshot && snapshot.systemClientVersion !== undefined) {
        updateRuntimeConfig({ clientVersion: String(snapshot.systemClientVersion || '') });
    }
    applyConfigSnapshot(snapshot || {}, { persist: false, accountId });
    if (rev > st.appliedConfigRevision) st.appliedConfigRevision = rev;

    // 优先使用本次下发的间隔，避免 worker 内部 store 漂移导致回退默认值
    const incomingIntervals = (snapshot && snapshot.intervals && typeof snapshot.intervals === 'object')
        ? snapshot.intervals
        : null;
    if (incomingIntervals) {
        applyIntervalsToRuntime(incomingIntervals);
    }

    if (st.loginReady) {
        refreshFarmCheckLoop(200);
        refreshFriendCheckLoop(200);
        resetUnifiedSchedule();
        scheduleUnifiedNextTick();

        const hasAutomationPayload = !!(snapshot && snapshot.automation && typeof snapshot.automation === 'object');
        if (hasAutomationPayload) {
            const nextAuto = getAutomation();

            const prevFertilizerMode = String(prevAuto && prevAuto.fertilizer ? prevAuto.fertilizer : '').toLowerCase();
            const nextFertilizerMode = String(nextAuto && nextAuto.fertilizer ? nextAuto.fertilizer : '').toLowerCase();
            const fertilizerChanged = prevFertilizerMode !== nextFertilizerMode;
            if (fertilizerChanged && (nextFertilizerMode === 'both' || nextFertilizerMode === 'organic' || nextFertilizerMode === 'smart')) {
                st.workerScheduler.setTimeoutTask('fertilizer_immediate_after_save', 600, async () => {
                    if (!st.loginReady) return;
                    try {
                        await runExclusiveAutomationTask('fertilizer_immediate', () => runFertilizerByConfig([], { skipNormal: true }));
                    } catch (e: any) {
                        log('施肥', `保存配置后立即施肥失败: ${e.message}`, {
                            module: 'farm',
                            event: '施肥',
                            result: 'error',
                        });
                    }
                });
            }

            startMysteryShopTimer();
        }
    }

    if (syncNow) syncStatus();
    return st.appliedConfigRevision;
}
module.exports = { applyRuntimeConfig };
