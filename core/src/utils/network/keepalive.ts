export {};
const stateMod: typeof import('./state') = require('./state');
const queueMod: typeof import('./queue') = require('./queue');
const codecMod: typeof import('./codec') = require('./codec');
const connectionMod: typeof import('./connection') = require('./connection');
const { Buffer } = require('node:buffer');
const { types } = require('../proto');
const profileMod = require('../client-profile');
const keepalivePolicyMod = require('../keepalive-policy');
const aceMod = require('../../services/ace');
const utilsMod = require('../utils');
const ignoreErrorMod = require('../ignore-error');
const configMod = require('../../config/config');
const forecastMod = require('../../services/level-forecast');
const cryptoWasm = require('../crypto-wasm');
const { S } = stateMod;

import type { ConnectionContext } from './types';

// ============ 心跳 ============
const HEARTBEAT_REQUEST_TIMEOUT = 20000;

function buildHeartbeatBody(gid: number, clientVersion = profileMod.getClientVersion()): Buffer {
    return Buffer.from(types.HeartbeatRequest.encode(types.HeartbeatRequest.create({
        gid: utilsMod.toLong(gid),
        client_version: clientVersion,
        field_3: utilsMod.toLong(0),
    })).finish());
}

function startHeartbeat(context: ConnectionContext): void {
    S.scheduler.clear('heartbeat_interval');
    const heartbeat = { attempts: 0, replies: 0, failures: 0 };
    context.heartbeat = heartbeat;
    S.lastHeartbeatMono = S.now();
    S.lastInboundMono = S.now();
    S.heartbeatMisses = 0;

    S.scheduler.setIntervalTask('heartbeat_interval', configMod.CONFIG.heartbeatInterval, async () => {
        if (!stateMod.isCurrentConnection(context) || context.phase !== 'online' || !S.user.gid) return;

        const body = buildHeartbeatBody(S.user.gid, context.clientVersion);
        heartbeat.attempts += 1;
        try {
            const { body: replyBody } = await codecMod.sendMsgAsync(
                'gamepb.userpb.UserService',
                'Heartbeat',
                body,
                { timeoutMs: HEARTBEAT_REQUEST_TIMEOUT, priority: 'high', criticalLane: 'heartbeat' },
            );
            if (!stateMod.isCurrentConnection(context)) return;
            heartbeat.replies += 1;
            S.lastHeartbeatMono = S.now();
            S.heartbeatMisses = 0;
            try {
                const reply = types.HeartbeatReply.decode(replyBody);
                if (reply.server_time) utilsMod.syncServerTime(utilsMod.toNum(reply.server_time));
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:1014', err); }
        } catch {
            if (!stateMod.isCurrentConnection(context)) return;
            heartbeat.failures += 1;
            S.heartbeatMisses += 1;
            const now = S.now();
            const inboundSilenceMs = Math.max(0, now - S.lastInboundMono);
            const heartbeatSilenceMs = Math.max(0, now - S.lastHeartbeatMono);
            utilsMod.logWarn(
                '心跳',
                `心跳未响应 (miss=${S.heartbeatMisses}/${keepalivePolicyMod.MAX_HEARTBEAT_MISSES}, `
                + `heartbeat=${Math.round(heartbeatSilenceMs / 1000)}s, inbound=${Math.round(inboundSilenceMs / 1000)}s, `
                + `pending=${S.pending.size}, queued=${S.queue.length}, active=${queueMod.describePendingRequests()})`,
            );
            if (!keepalivePolicyMod.shouldTerminateForHeartbeat(S.heartbeatMisses, inboundSilenceMs)) return;

            utilsMod.log('心跳', '连续心跳超时且连接无入站数据，账号将停止运行...');
            finalizeConnection(context, {
                source: 'heartbeat_timeout',
                reason: `${Math.round(inboundSilenceMs / 1000)}s 无入站数据，连续 ${S.heartbeatMisses} 次心跳失败`,
            });
            try { (context.socket as any).terminate(); } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:1035', err); }
        }
    }, { preventOverlap: true });
}

interface DisconnectDetails {
    source: string;
    code?: number;
    reason?: string;
}

function clearNetworkRuntime(reason: string): void {
    queueMod.rejectAllQueuedRequests(`请求已中断: ${reason}`);
    queueMod.rejectAllPendingRequests(`请求已中断: ${reason}`);
    S.scheduler.clearAll();
    aceMod.stopAceRuntime(true);
    S.gatewayTokens.clear();
    forecastMod.invalidateLandForecast();
    S.user.gid = 0;
    S.user.openId = '';
}

function getConnectionDiagnostics(context: ConnectionContext | null) {
    return {
        platform: configMod.CONFIG.platform,
        clientVersion: context?.clientVersion || profileMod.getClientVersion(),
        connectionAgeMs: context?.startedMono !== undefined ? Math.max(0, S.now() - context.startedMono) : 0,
        onlineAgeMs: context?.onlineMono !== undefined ? Math.max(0, S.now() - context.onlineMono) : 0,
        heartbeat: context?.heartbeat ? { ...context.heartbeat } : null,
        ...queueMod.getGatewayLoad(),
        lastInboundAgeMs: Math.max(0, S.now() - S.lastInboundMono),
        lastHeartbeatAgeMs: Math.max(0, S.now() - S.lastHeartbeatMono),
        heartbeatMissCount: S.heartbeatMisses,
        pendingRequests: queueMod.describePendingRequests(),
        queuedRequests: queueMod.describeQueuedRequests(),
        ace: context?.phase === 'online' ? aceMod.getAceDiagnostics() : null,
        tsdk: cryptoWasm.getDiagnostics(),
    };
}

function finalizeConnection(context: ConnectionContext, details: DisconnectDetails): void {
    if (context.finalized) return;
    context.finalized = true;
    const wasCurrent = S.connection === context;
    const wasLoginReady = context.phase === 'online';
    // Snapshot before cleanup destroys TSDK state and clears request queues.
    const diagnostics = getConnectionDiagnostics(context);
    if (wasCurrent) {
        utilsMod.log('连接', '会话结束', {
            event: 'connection_summary',
            connectionId: context.id,
            source: details.source,
            disconnectCode: Number(details.code) || 0,
            phase: context.phase,
            intentionalClose: context.intentionalClose,
            diagnostics,
        });
        S.connection = null;
        S.ws = null;
        clearNetworkRuntime(details.reason || details.source);
    }
    if (!wasCurrent || context.intentionalClose) return;
    S.events.emit('disconnected', {
        connectionId: context.id,
        source: details.source,
        code: Number(details.code) || 0,
        reason: details.reason || '',
        phase: context.phase,
        wasLoginReady,
        diagnostics,
        at: Date.now(),
    });
}

export { buildHeartbeatBody, startHeartbeat, getConnectionDiagnostics, finalizeConnection, clearNetworkRuntime };
