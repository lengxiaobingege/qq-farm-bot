import type { Application } from 'express';
import type { Server } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';
export {};

const { createSessionStore } = require('./session-store');
/** 会话存储实例类型（由 session-store 的类推断） */
type SessionStore = ReturnType<typeof createSessionStore>;

/**
 * AdminContext factory
 * Creates and holds all shared state for the admin server.
 */

export interface AdminContext {
    /** 带生命周期的会话存储：签发/校验/滑动续期/单会话强制都由它管 */
    tokens: SessionStore;
    app: Application | null;
    server: Server | null;
    io: SocketIOServer | null;
    provider: any;
}

function createAdminContext(dataProvider: any): AdminContext {
    // 启动时从磁盘恢复会话（已过期的会被自动剔除），服务重启后已登录的管理端不必重新登录
    const tokens = createSessionStore();
    return {
        tokens,
        app: null,
        server: null,
        io: null,
        provider: dataProvider,
    };
}

module.exports = { createAdminContext };
