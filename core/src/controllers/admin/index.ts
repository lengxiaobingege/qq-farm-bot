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
const { loadHttpsCredentials, resolveHstsHeader } = require('../../utils/https-loader');

const adminLogger = createModuleLogger('admin');

let ctx: AdminContext | null = null;

function startAdminServer(dataProvider: any): void {
    if (ctx) return;

    // HTTPS 凭据最先加载：配了却不可用时在挂载任何路由之前就失败，
    // 避免半个服务立起来又立刻崩，日志里只剩一堆无关噪音。
    const httpsConfig = loadHttpsCredentials();
    for (const warning of httpsConfig.warnings) {
        adminLogger.warn('HTTPS 配置提示', { warning });
    }
    if (httpsConfig.error) {
        const optional = String(process.env.HTTPS_OPTIONAL || '') === '1';
        adminLogger.error('HTTPS 凭据不可用', {
            error: httpsConfig.error,
            fallback: optional ? 'http' : 'refuse-to-start',
        });
        if (!optional) {
            throw new Error(`HTTPS 凭据不可用：${httpsConfig.error}（如确需回退明文 HTTP，设置 HTTPS_OPTIONAL=1）`);
        }
    }
    const tlsCredentials = httpsConfig.enabled ? httpsConfig.credentials : null;

    const adminCtx = createAdminContext(dataProvider);
    ctx = adminCtx;

    const app = express();
    // trust proxy 必须与 middleware 的 TRUSTED_PROXY_IPS 保持一致：
    // 直接写 true 会让 Express 无条件采信 X-Forwarded-For，req.ip 可被任意伪造。
    const trustedProxies = String(process.env.TRUSTED_PROXY_IPS || '')
        .split(',').map(item => item.trim()).filter(Boolean);
    app.set('trust proxy', trustedProxies.length ? trustedProxies : false);
    app.use(express.json());

    // HSTS 只在真正启用 TLS 且显式开启时下发：
    // 明文端口上发 HSTS 会把浏览器锁死在 https，一旦证书配错就无法回退。
    const hstsHeader = tlsCredentials ? resolveHstsHeader() : '';
    if (hstsHeader) {
        app.use((_req: any, res: any, next: any) => {
            res.setHeader('Strict-Transport-Security', hstsHeader);
            next();
        });
    }


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
    app.use('/game-config', express.static(getResourcePath('gameConfig'), {
        maxAge: '365d',
        immutable: true,
        setHeaders: (res: any) => { res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); },
    }));

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
    // 默认只监听回环：外部统一走 3000 的 socat/反代入口，避免 3007 被绕过直接访问。
    // 需要监听全部网卡（如容器内直接映射端口）时显式设置 HOST=0.0.0.0。
    const host: string = String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
    const scheme = tlsCredentials ? 'https' : 'http';
    if (tlsCredentials) {
        const https = require('node:https');
        const tlsServer = https.createServer(tlsCredentials, app);
        tlsServer.listen(port, host, () => {
            adminLogger.info('admin panel started', {
                url: `${scheme}://${host}:${port}`, port, host, tls: true,
                hsts: hstsHeader || 'off',
            });
        });
        adminCtx.server = tlsServer;
    } else {
        adminCtx.server = app.listen(port, host, () => {
            adminLogger.info('admin panel started', { url: `${scheme}://${host}:${port}`, port, host, tls: false });
        });
    }

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
