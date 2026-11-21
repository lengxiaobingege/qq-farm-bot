export {};
const { toNum } = require('../utils');

export type ConnectionPhase = 'connecting' | 'login' | 'online';
export type RequestPriority = 'low' | 'normal' | 'high';
/** 请求班次，见 utils/request-priority.ts。 */
export type RequestClass = 'critical' | 'foreground' | 'farm' | 'friend' | 'background';
export type CriticalLane = 'heartbeat' | 'ace';

export interface ConnectionContext {
    id: number;
    socket: WebSocket;
    phase: ConnectionPhase;
    intentionalClose: boolean;
    finalized: boolean;
    loginInitialized: boolean;
    clientVersion: string;
    startedMono?: number;
    onlineMono?: number;
    heartbeat?: { attempts: number; replies: number; failures: number };
}

export interface SendMsgOptions {
    timeoutMs?: number;
    expectedErrorCodes?: readonly number[];
    /** 兼容旧调用：high→critical、low→background、normal 视为「未表态」交给环境班次。 */
    priority?: RequestPriority;
    /** 显式指定班次，优先于 priority 与环境班次。 */
    requestClass?: RequestClass;
    criticalLane?: CriticalLane;
    expectReply?: boolean;
    /**
     * 真正发出前的最后一道闸：返回 Error 表示放弃发送（例如自动化任务已被取消、
     * 账号已切换）。牧场切场期间用它避免旧队列里的请求落到错误场景。
     */
    beforeSend?: () => Error | null;
    /** 写请求成功发出后的回调（牧场用它记账本轮动作）。 */
    onSent?: () => void;
}

export interface PendingRequest {
    callback: (err: Error | null, body?: Buffer, meta?: any) => void;
    expectedErrorCodes: Set<number>;
    serviceName?: string;
    methodName?: string;
    startedMono?: number;
    requestClass: RequestClass;
    criticalLane?: CriticalLane;
}

export interface QueuedRequest {
    context: ConnectionContext;
    serviceName: string;
    methodName: string;
    bodyBytes: Buffer;
    expectedErrorCodes: Set<number>;
    resolve: (value: { body: Buffer; meta: any }) => void;
    reject: (reason: Error) => void;
    timeoutKey: string;
    queueWaitKey: string;
    seq: number | null;
    settled: boolean;
    requestClass: RequestClass;
    criticalLane?: CriticalLane;
    enqueuedAt: number;
    expectReply: boolean;
    /** 发送前闸门（见 SendMsgOptions.beforeSend） */
    beforeSend?: () => Error | null;
    /** 发送成功回调（见 SendMsgOptions.onSent） */
    onSent?: () => void;
}

export class GatewayError extends Error {
    code: number;
    serviceName: string;
    methodName: string;
    errorMessage: string;
    clientSeq: number;

    constructor(meta: any) {
        const code = toNum(meta && meta.error_code);
        const serviceName = String((meta && meta.service_name) || '');
        const methodName = String((meta && meta.method_name) || '');
        const errorMessage = String((meta && meta.error_message) || '');
        super(`${serviceName}.${methodName} 错误: code=${code} ${errorMessage}`.trim());
        this.name = 'GatewayError';
        this.code = code;
        this.serviceName = serviceName;
        this.methodName = methodName;
        this.errorMessage = errorMessage;
        this.clientSeq = toNum(meta && meta.client_seq);
    }
}

/** background 班次请求让路时抛出的错误：不是业务失败，而是「现在不该占用连接」。 */
export class GatewayBusyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GatewayBusyError';
    }
}

