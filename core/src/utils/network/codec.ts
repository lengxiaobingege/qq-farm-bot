export {};
const stateMod: typeof import('./state') = require('./state');
const typesMod: typeof import('./types') = require('./types');
const queueMod: typeof import('./queue') = require('./queue');
const { Buffer } = require('node:buffer');
const cryptoWasm = require('../crypto-wasm');
const { types } = require('../proto');
const lowPriorityMod = require('../low-priority-gate');
const requestContextMod = require('../request-context');
const requestPriorityMod = require('../request-priority');
const utilsMod = require('../utils');
const { S, isCurrentConnection } = stateMod;

import type {
    ConnectionContext,
    CriticalLane,
    PendingRequest,
    QueuedRequest,
    RequestClass,
    SendMsgOptions,
} from './types';

// ============ 消息编解码 ============
async function encodeMsg(serviceName: string, methodName: string, bodyBytes: Buffer, clientSeqValue: number): Promise<Buffer> {
    let finalBody = bodyBytes || Buffer.alloc(0);
    if (finalBody.length > 0) {
        finalBody = await cryptoWasm.encryptBuffer(finalBody);
    }
    const msg = types.GateMessage.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1,
            client_seq: utilsMod.toLong(clientSeqValue),
            server_seq: utilsMod.toLong(S.serverSeq),
        },
        body: finalBody,
        token: S.gatewayTokens.next(),
    });
    return types.GateMessage.encode(msg).finish();
}


async function sendMsg(context: ConnectionContext, serviceName: string, methodName: string, bodyBytes: Buffer, pending?: PendingRequest): Promise<boolean> {
    if (!stateMod.isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
        utilsMod.log('系统', '[WS] 连接未打开');
        return false;
    }
    const seq = S.clientSeq;
    S.clientSeq += 1;
    // 加密前登记在途请求，确保排队器能准确计算并发槽位。
    if (pending) S.pending.set(seq, pending);
    const encoded = await encodeMsg(serviceName, methodName, bodyBytes, seq);
    if (pending && S.pending.get(seq) !== pending) return false;
    if (!stateMod.isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
        if (pending) {
            S.pending.delete(seq);
            pending.callback(new Error(`连接未打开: ${methodName}`));
        }
        return false;
    }
    try {
        context.socket.send(encoded);
    } catch (err: any) {
        if (pending) {
            S.pending.delete(seq);
            pending.callback(err);
        }
        return false;
    }
    return true;
}

/** Promise 版发送 */
function sendMsgAsync(serviceName: string, methodName: string, bodyBytes: Buffer, timeoutOrOptions: number | SendMsgOptions = 20000): Promise<{ body: Buffer; meta: any }> {
    const options: SendMsgOptions = typeof timeoutOrOptions === 'number'
        ? { timeoutMs: timeoutOrOptions }
        : (timeoutOrOptions || {});
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 20000);
    const expectedErrorCodes = new Set((options.expectedErrorCodes || []).map(Number).filter(Number.isFinite));
    const criticalLane: CriticalLane | undefined = options.criticalLane === 'heartbeat' || options.criticalLane === 'ace'
        ? options.criticalLane
        : undefined;
    const expectReply = options.expectReply !== false;
    // 班次由「显式 requestClass > priority 兼容映射 > 调度器注入的环境班次 > 前台」决定。
    const requestClass: RequestClass = requestPriorityMod.resolveRequestClass(
        { priority: options.priority, requestClass: options.requestClass, criticalLane },
        requestContextMod.getAmbientRequestClass(),
    );
    return new Promise((resolve, reject) => {
        const context = S.connection;
        if (!context || !stateMod.isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
            reject(new Error(`连接未打开: ${methodName}`));
            return;
        }
        if (context.phase !== 'online') {
            reject(new Error(`账号尚未登录: ${methodName}`));
            return;
        }

        // 每个班次有独立的排队配额：后台任务把自己的配额排满，也不会占掉前台/心跳的名额。
        if (requestPriorityMod.isClassQueueFull(S.queue, requestClass)) {
            reject(new Error(
                `请求等待队列已满: ${methodName} (class=${requestClass}, limit=${requestPriorityMod.maxQueuedForClass(requestClass)}, `
                + `queued=${S.queue.length}, pending=${S.pending.size})`,
            ));
            return;
        }

        const requestId = S.nextRequestId++;
        const request: QueuedRequest = {
            context,
            serviceName,
            methodName,
            bodyBytes,
            expectedErrorCodes,
            resolve,
            reject,
            timeoutKey: `request_timeout_${requestId}`,
            queueWaitKey: `request_queue_wait_${requestId}`,
            seq: null,
            settled: false,
            requestClass,
            criticalLane,
            enqueuedAt: S.now(),
            expectReply,
        };
        S.queue.push(request);
        S.scheduler.setTimeoutTask(request.timeoutKey, timeoutMs, () => {
            if (request.seq !== null) S.pending.delete(request.seq);
            const index = S.queue.indexOf(request);
            if (index >= 0) S.queue.splice(index, 1);
            const stage = request.seq === null ? 'queued' : 'pending';
            queueMod.settleQueuedRequest(request, new Error(`请求超时: ${methodName} (stage=${stage}, pending=${S.pending.size}, queued=${S.queue.length}, active=${queueMod.describePendingRequests()})`));
            queueMod.drainRequestQueue();
        });
        if (requestClass === 'background') {
            // background 是「后台补数据」：拿不到空闲槽位就早点让路，而不是一路熬到请求超时——
            // 熬着既拖长队列，也会给调用方刷一堆看着像故障的超时日志。
            const queueWaitMs = Math.min(timeoutMs, lowPriorityMod.LOW_PRIORITY_QUEUE_WAIT_MS);
            S.scheduler.setTimeoutTask(request.queueWaitKey, queueWaitMs, () => {
                if (request.settled || request.seq !== null) return;
                const index = S.queue.indexOf(request);
                if (index >= 0) S.queue.splice(index, 1);
                queueMod.settleQueuedRequest(request, new typesMod.GatewayBusyError(
                    `网关繁忙，后台请求已让路: ${methodName} (waited=${queueWaitMs}ms, `
                    + `pending=${S.pending.size}, queued=${S.queue.length}, active=${queueMod.describePendingRequests()})`,
                ));
            });
        }
        queueMod.drainRequestQueue();
        queueMod.logRequestPressure();
    });
}

async function sendMsgNoReply(serviceName: string, methodName: string, bodyBytes: Buffer): Promise<void> {
    // 即使调用方不需要回包，也必须经过同一调度器，不能绕过心跳/ACE保护和并发上限。
    // 不写死班次，交给环境班次判定：后台任务发的通知不该被当成前台流量。
    await sendMsgAsync(serviceName, methodName, bodyBytes, { expectReply: false });
}

export { encodeMsg, sendMsg, sendMsgAsync, sendMsgNoReply };
