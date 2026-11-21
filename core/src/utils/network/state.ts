import type {
    ConnectionContext,
    PendingRequest,
    QueuedRequest,
} from './types';

export {};
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const schedulerMod = require('../../services/scheduler');
const gatewayTokenMod = require('../gateway-token');

/**
 * 网络层的全部模块级可变状态。
 * 拆分前它们是 src/utils/network.ts 的顶层 let/const；收进单对象后各子模块共享同一份引用，
 * 语义与拆分前完全一致（闭包共享同一批变量）。
 * now 可被测试替换，用于精确控制单调时钟。
 */
const S = {
    events: new EventEmitter(),
    ws: null as any,
    connection: null as any as ConnectionContext | null,
    nextConnectionId: 1,
    clientSeq: 1,
    serverSeq: 0,
    pending: new Map<number, PendingRequest>(),
    queue: [] as QueuedRequest[],
    nextRequestId: 1,
    wsError: { code: 0, at: 0, message: '' },
    lastPressureLogAt: 0,
    scheduler: schedulerMod.createScheduler('network'),
    gatewayTokens: new gatewayTokenMod.GatewayTokenProvider(),
    lastHeartbeatMono: performance.now(),
    lastInboundMono: performance.now(),
    heartbeatMisses: 0,
    user: {
        gid: 0,
        name: '',
        level: 0,
        gold: 0,
        exp: 0,
        coupon: 0,
        goldBean: 0,
        openId: '',
        avatarUrl: '',
        ranchLevel: 0,
        // 当前所处游戏场景（1=农场，2=牧场/大农场）。牧场写操作要求在场景 2 内发出。
        globalSceneId: 1,
        // 已解锁场景 id 列表，登录回包 unlocked_scene_ids 提供；不含 2 表示牧场尚未解锁。
        unlockedSceneIds: [] as number[],
    },
    now: (): number => performance.now(),
    /** 可注入 socket 工厂（默认在 connection 模块中赋值为 ws） */
    createSocket: null as any as (url: string, options: any) => any,
};

/** 拆分前位于 codec 段的连接判定，多个子模块都要用，收进 state。 */
function isCurrentConnection(context: ConnectionContext): boolean {
    return S.connection === context && S.ws === context.socket && !context.finalized;
}

export { isCurrentConnection, S };
