export {};
/**
 * 生命周期管理：监听器摘除、静默停机、主动停止、断线与踢下线处理。
 */
const { st, AUTO_LOGIN_MAX_FAILS, AUTO_LOGIN_RETRY_DELAY_MS } = require('./state');
const { networkEvents, cleanup } = require('../../utils/network');
const { saveStats } = require('../../services/stats');
const { cleanupTaskSystem } = require('../../services/task');
const { stopFarmCheckLoop } = require('../../services/farm');
const { stopFriendCheckLoop } = require('../../services/friend');
const { stopUnifiedScheduler, stopDailyRoutineTimer } = require('./schedules');
const { syncStatus } = require('./status-sync');
const { sendToMaster, exitWorker } = require('./channel');
const { log, ignoreError } = require('../../utils/utils');

function detachRuntimeListeners(): void {
    networkEvents.off('kickout', onKickout);
    if (st.onDisconnected) {
        networkEvents.off('disconnected', st.onDisconnected);
        st.onDisconnected = null;
    }
    if (st.onWsError) {
        networkEvents.off('ws_error', st.onWsError);
        st.onWsError = null;
    }
    if (st.onSellGain) {
        networkEvents.off('sell', st.onSellGain);
        st.onSellGain = null;
    }
    if (st.onFarmHarvested) {
        networkEvents.off('farmHarvested', st.onFarmHarvested);
        st.onFarmHarvested = null;
    }
    if (st.onDogSkillGiftPending) {
        networkEvents.off('dogSkillGiftPending', st.onDogSkillGiftPending);
        st.onDogSkillGiftPending = null;
    }
}

function quiesceBot(reason: string): void {
    st.shutdownStarted = true;
    st.runtimeGeneration += 1;
    st.isRunning = false;
    st.loginReady = false;
    st.isAutoLoginMode = false;
    st.autoLoginCanContinue = null;
    st.autoLoginOnLoginSuccess = null;
    if (st.autoLoginRetryTimer) {
        clearTimeout(st.autoLoginRetryTimer);
        st.autoLoginRetryTimer = null;
    }
    stopUnifiedScheduler();
    stopFarmCheckLoop();
    stopFriendCheckLoop();
    stopDailyRoutineTimer();
    cleanupTaskSystem();
    st.workerScheduler.clearAll();
    detachRuntimeListeners();
    try { require('../../services/friend').clearFriendsListCache(); } catch (err) { ignoreError('core/src/core/worker.ts:835', err); }
    cleanup(reason);
    syncStatus(true);
}

async function stopBot(): Promise<void> {
    if (!st.shutdownStarted) {
        saveStats();
        quiesceBot('主动停止');
    }
    exitWorker(0);
}

function handleTerminalDisconnect(payload: any): void {
    if (st.shutdownStarted && !st.isAutoLoginMode) return;
    const source = String(payload?.source || 'ws_close');
    const code = Number(payload?.code) || 0;
    const reason = String(payload?.reason || '连接已断开');
    const phase = String(payload?.phase || 'unknown');

    const hasWxCreds = !!(String(st.autoLoginWxOpenId || '').trim() && String(st.autoLoginWxAccessToken || '').trim())
        || String(st.autoLoginLoginBuffer || '').trim();

    // 有微信凭证时，任何断开都尝试自动换码重连（包括在线阶段被挤下线）
    if (hasWxCreds) {
        if (!st.isAutoLoginMode) {
            st.isAutoLoginMode = true;
            st.autoLoginFailCount = 0;
        }
        st.autoLoginFailCount += 1;
        log('系统', `连接已断开，自动登录尝试第 ${st.autoLoginFailCount} 次：source=${source}, code=${code}, phase=${phase}`);
        if (st.autoLoginFailCount >= AUTO_LOGIN_MAX_FAILS) {
            log('系统', `自动登录已连续失败 ${AUTO_LOGIN_MAX_FAILS} 次，停止重试并提示前端扫码`);
            sendToMaster({
                type: 'need_wx_scan',
                accountId: process.env.FARM_ACCOUNT_ID || '',
                accountName: '',
            });
            quiesceBot(`自动登录失败达上限，需扫码`);
            setTimeout(exitWorker, 300, 0);
            return;
        }
        if (st.autoLoginRetryTimer) {
            clearTimeout(st.autoLoginRetryTimer);
            st.autoLoginRetryTimer = null;
        }
        st.autoLoginRetryTimer = setTimeout(() => {
            if (st.shutdownStarted && !st.isAutoLoginMode) return;
            void require("./auto-login").attemptAutoLogin(st.autoLoginWxOpenId, st.autoLoginWxAccessToken, st.autoLoginWxRefreshToken, st.autoLoginLoginBuffer, st.autoLoginCanContinue || (() => false), st.autoLoginOnLoginSuccess || (() => Promise.resolve()));
        }, AUTO_LOGIN_RETRY_DELAY_MS);
        return;
    }

    log('系统', `连接已断开，不再使用旧 Code 重连 (source=${source}, code=${code}, phase=${phase})`, {
        source, disconnectCode: code, reason, phase, diagnostics: payload?.diagnostics || null,
    });
    saveStats();
    quiesceBot(`连接断开: ${source}`);
    sendToMaster({
        type: 'account_disconnected',
        source,
        code,
        reason,
        phase,
        connectionId: Number(payload?.connectionId) || 0,
        diagnostics: payload?.diagnostics || null,
        at: Number(payload?.at) || Date.now(),
    });
    setTimeout(exitWorker, 300, 0);
}

function onKickout(payload: any): void {
    if (st.shutdownStarted) return;
    const reason = payload && payload.reason ? payload.reason : '未知';
    const reasonCode = Number(payload?.reasonCode) || 0;
    const diagnostics = payload?.diagnostics || null;
    log('系统', `检测到踢下线，准备自动停止账号。原因: ${reason} (${reasonCode})`, { reasonCode, diagnostics });
    saveStats();
    quiesceBot(`踢下线: ${reason}`);
    sendToMaster({ type: 'account_kicked', reason, reasonCode, diagnostics });
    setTimeout(exitWorker, 300, 0);
}
module.exports = { detachRuntimeListeners, quiesceBot, stopBot, handleTerminalDisconnect, onKickout };
