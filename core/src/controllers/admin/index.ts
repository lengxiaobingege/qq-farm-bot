import type { AdminContext } from './context';
export {};

/**
 * Admin panel HTTP server orchestrator.
 * Thin wrapper that wires up Express, routes, Socket.IO, and shared context.
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { CONFIG } = require('../../config/config');
const { getResourcePath } = require('../../config/runtime-paths');
const { createModuleLogger } = require('../../services/logger');

const { createAdminContext } = require('./context');
const { mountAuthRoutes } = require('./auth-routes');
const { mountAccountRoutes } = require('./account-routes');
const { mountFarmRoutes } = require('./farm-routes');
const { mountFriendRoutes } = require('./friend-routes');
const { mountActivityCenterRoutes } = require('./activity-center-routes');
const { mountCommerceRoutes } = require('./commerce-routes');
const { mountWxLoginRoutes } = require('./wx-login-routes');
const {
    setupSocketIO,
    emitRealtimeStatus: _emitStatus,
    emitRealtimeLog: _emitLog,
    emitRealtimeAccountLog: _emitAccountLog,
} = require('./socket');
const { applyCors } = require('./cors');

const adminLogger = createModuleLogger('admin');

let ctx: AdminContext | null = null;

function startAdminServer(dataProvider: any): void {
    if (ctx) return;

    const adminCtx = createAdminContext(dataProvider);
    ctx = adminCtx;

    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());

    adminCtx.app = app;

    // 收紧跨域：仅白名单/同源可访问，其余跨域请求（含预检）直接 403
    app.use((req: any, res: any, next: any) => {
        if (!applyCors(req, res)) return;
        next();
    });

    const webDist = path.join(__dirname, '../../../../web/dist');
    if (fs.existsSync(webDist)) {
        app.use(express.static(webDist));
    } else {
        adminLogger.warn('web build not found', { webDist });
        app.get('/', (_req: any, res: any) => res.send('web build not found. Please build the web project.'));
    }
    app.use('/game-config', express.static(getResourcePath('gameConfig')));

    // Mount route modules
    mountAuthRoutes(app, adminCtx);
    mountWxLoginRoutes(app, adminCtx);
    mountFarmRoutes(app, adminCtx);
    mountFriendRoutes(app, adminCtx);
    mountAccountRoutes(app, adminCtx);
    mountActivityCenterRoutes(app, adminCtx);
    mountCommerceRoutes(app, adminCtx);

    // SPA fallback
    app.get('*', (req: any, res: any) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
             return res.status(404).json({ ok: false, error: 'Not Found' });
        }
        if (fs.existsSync(webDist)) {
            res.sendFile(path.join(webDist, 'index.html'));
        } else {
            res.status(404).send('web build not found. Please build the web project.');
        }
    });

    const port: number = CONFIG.adminPort || 3007;
    adminCtx.server = app.listen(port, '0.0.0.0', () => {
        adminLogger.info('admin panel started', { url: `http://localhost:${port}`, port });
    });

    // Setup Socket.IO
    setupSocketIO(adminCtx);

}

function emitRealtimeStatus(accountId: string, status: any): void {
    if (!ctx) return;
    _emitStatus(ctx, accountId, status);
}

function emitRealtimeLog(entry: any): void {
    if (!ctx) return;
    _emitLog(ctx, entry);
}

function emitRealtimeAccountLog(entry: any): void {
    if (!ctx) return;
    _emitAccountLog(ctx, entry);
}

module.exports = {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
};
