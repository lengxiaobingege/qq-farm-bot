export {};
const stateMod: typeof import('./state') = require('./state');
const codecMod: typeof import('./codec') = require('./codec');
const lowPriorityMod = require('../low-priority-gate');
const requestPriorityMod = require('../request-priority');
const requestPressureMod = require('../request-pressure');
const utilsMod = require('../utils');
const { S, isCurrentConnection } = stateMod;

import type { PendingRequest, QueuedRequest, RequestClass } from './types';

const MAX_DESCRIBED_PENDING_REQUESTS = 6;

function settleQueuedRequest(request: QueuedRequest, error?: Error, value?: { body: Buffer; meta: any }): void {
    if (request.settled) return;
    request.settled = true;
    S.scheduler.clear(request.timeoutKey);
    S.scheduler.clear(request.queueWaitKey);
    if (error) request.reject(error);
    else request.resolve(value!);
}

function pendingClassCount(requestClass: RequestClass): number {
    let count = 0;
    for (const pending of S.pending.values()) {
        if (pending.requestClass === requestClass) count += 1;
    }
    return count;
}

function pendingBusinessCount(): number {
    return pendingClassCount('foreground') + pendingClassCount('farm') + pendingClassCount('friend');
}

interface GatewayLoad {
    pending: number;
    queued: number;
    /** 队列里非 background 的请求数：只有这些代表「有人真的在等连接」。 */
    blockingQueued: number;
    criticalPending: number;
    businessPending: number;
    foregroundPending: number;
    backgroundPending: number;
    heartbeatMisses: number;
    oldestPendingAgeMs: number;
}

function oldestPendingAgeMs(): number {
    const now = S.now();
    let oldest = 0;
    for (const pending of S.pending.values()) {
        if (pending.startedMono === undefined) continue;
        const age = Math.max(0, now - pending.startedMono);
        if (age > oldest) oldest = age;
    }
    return oldest;
}

/** 后台任务用来判断「现在该不该占用连接」的负载快照。 */
function getGatewayLoad(): GatewayLoad {
    return {
        pending: S.pending.size,
        queued: S.queue.length,
        blockingQueued: requestPressureMod.countBlockingQueuedRequests(S.queue),
        criticalPending: pendingClassCount('critical'),
        businessPending: pendingBusinessCount(),
        foregroundPending: pendingClassCount('foreground'),
        backgroundPending: pendingClassCount('background'),
        heartbeatMisses: S.heartbeatMisses,
        oldestPendingAgeMs: oldestPendingAgeMs(),
    };
}

function isGatewayIdleForBackground(): boolean {
    return lowPriorityMod.isGatewayIdleForLowPriority(getGatewayLoad());
}

/**
 * 等网关空闲到可以插入后台请求；等不到就返回 false，由调用方整轮让路。
 * 只观察不排队，所以等待期间一点压力都不加给网关。
 */
async function waitForGatewayIdle(
    maxWaitMs: number = lowPriorityMod.LOW_PRIORITY_IDLE_WAIT_MAX_MS,
    pollMs: number = lowPriorityMod.LOW_PRIORITY_IDLE_POLL_MS,
): Promise<boolean> {
    const deadline = S.now() + Math.max(0, Number(maxWaitMs) || 0);
    for (;;) {
        if (isGatewayIdleForBackground()) return true;
        if (S.now() >= deadline) return false;
        await utilsMod.sleep(Math.max(20, Number(pollMs) || lowPriorityMod.LOW_PRIORITY_IDLE_POLL_MS));
    }
}

/**
 * 挑出下一个可发送的请求。分层与容量规则全部在 utils/request-priority.ts 里，
 * 这里只负责清掉已结算的队列项、把选中项摘出来。
 */
function takeDispatchableRequest(): QueuedRequest | null {
    for (let index = S.queue.length - 1; index >= 0; index--) {
        if (S.queue[index].settled) S.queue.splice(index, 1);
    }
    if (S.queue.length === 0) return null;
    const index = requestPriorityMod.selectDispatchIndex(S.queue, Array.from(S.pending.values()), S.now());
    if (index < 0) return null;
    return S.queue.splice(index, 1)[0];
}

function drainRequestQueue(): void {
    while (S.queue.length > 0) {
        const request = takeDispatchableRequest();
        if (!request) break;

        if (!stateMod.isCurrentConnection(request.context) || request.context.phase !== 'online') {
            settleQueuedRequest(request, new Error(`连接未打开: ${request.methodName}`));
            continue;
        }

        const seq = S.clientSeq;
        request.seq = seq;
        const pending: PendingRequest | undefined = request.expectReply ? {
            serviceName: request.serviceName,
            methodName: request.methodName,
            startedMono: S.now(),
            requestClass: request.requestClass,
            criticalLane: request.criticalLane,
            expectedErrorCodes: request.expectedErrorCodes,
            callback: (err, body, meta) => {
                if (err) settleQueuedRequest(request, err);
                else settleQueuedRequest(request, undefined, { body: body!, meta });
                drainRequestQueue();
            },
        } : undefined;
        codecMod.sendMsg(request.context, request.serviceName, request.methodName, request.bodyBytes, pending).then((sent) => {
            if (sent) {
                if (!request.expectReply) {
                    settleQueuedRequest(request, undefined, { body: Buffer.alloc(0), meta: {} });
                    drainRequestQueue();
                }
                return;
            }
            S.pending.delete(seq);
            settleQueuedRequest(request, new Error(`发送失败: ${request.methodName}`));
            drainRequestQueue();
        }).catch((error: any) => {
            S.pending.delete(seq);
            settleQueuedRequest(request, error instanceof Error ? error : new Error(String(error)));
            drainRequestQueue();
        });
    }
}

function rejectAllQueuedRequests(reason: string): number {
    const entries = S.queue.splice(0);
    for (const request of entries) settleQueuedRequest(request, new Error(reason));
    return entries.length;
}

function rejectAllPendingRequests(reason = '请求被中断'): number {
    const entries = Array.from(S.pending.entries());
    S.pending.clear();
    for (const [, pending] of entries) {
        try {
            pending.callback(new Error(reason));
        } catch {
            // ignore callback failure
        }
    }
    return entries.length;
}

function describePendingRequests(): string {
    if (S.pending.size === 0) return 'none';
    const now = S.now();
    return Array.from(S.pending.entries())
        .slice(0, MAX_DESCRIBED_PENDING_REQUESTS)
        .map(([seq, pending]) => {
            const method = pending.methodName || 'unknown';
            const ageMs = pending.startedMono !== undefined ? Math.max(0, now - pending.startedMono) : 0;
            return `${method}#${seq}:${ageMs}ms`;
        })
        .join(',');
}

function describeQueuedRequests(): string {
    if (S.queue.length === 0) return 'none';
    return S.queue
        .slice(0, 8)
        .map(request => `${requestPriorityMod.describeRequestClassMarker(request)}${request.methodName || 'unknown'}`)
        .join(',');
}

function logRequestPressure(): void {
    const now = S.now();
    if (!requestPressureMod.shouldLogRequestPressure(S.queue, now, S.lastPressureLogAt)) return;
    S.lastPressureLogAt = now;
    utilsMod.logWarn('系统', `Gateway 请求压力: pending=${S.pending.size}, queued=${S.queue.length}, active=${describePendingRequests()}, queuedMethods=${describeQueuedRequests()}`);
}

export { settleQueuedRequest, drainRequestQueue, rejectAllQueuedRequests, rejectAllPendingRequests, describePendingRequests, describeQueuedRequests, logRequestPressure, getGatewayLoad, isGatewayIdleForBackground, waitForGatewayIdle };
