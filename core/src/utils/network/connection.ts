export {};
const stateMod: typeof import('./state') = require('./state');
const sessionMod: typeof import('./session') = require('./session');
const messagesMod: typeof import('./messages') = require('./messages');
const loginMod: typeof import('./login') = require('./login');
const keepaliveMod: typeof import('./keepalive') = require('./keepalive');
const WebSocket = require('ws');
const configMod = require('../../config/config');
const profileMod = require('../client-profile');
const utilsMod = require('../utils');
const ignoreErrorMod = require('../ignore-error');
const { S } = stateMod;

import type { ConnectionContext } from './types';

// 可注入的 socket 工厂：默认用 ws，测试可替换 S.createSocket 注入假 socket。
if (!S.createSocket) {
    S.createSocket = (url: string, options: any) => new WebSocket(url, options);
}

// ============ WebSocket 连接 ============
function connect(code: string | null, onLoginSuccess?: () => void): void {
    const authCode = String(code || '').trim();
    if (!authCode) throw new Error('连接缺少一次性 Code');
    if (S.connection && !S.connection.finalized) throw new Error('WebSocket 连接已存在');

    S.clientSeq = 1;
    S.serverSeq = 0;
    S.lastInboundMono = S.now();
    S.lastHeartbeatMono = S.now();
    S.heartbeatMisses = 0;
    const clientVersion = profileMod.getClientVersion();
    const url = new URL(configMod.CONFIG.serverUrl);
    url.search = new URLSearchParams({
        platform: profileMod.isWechatPlatform() ? 'wx' : configMod.CONFIG.platform,
        os: configMod.CONFIG.os,
        ver: clientVersion,
        code: authCode,
    }).toString();
    const di = configMod.CONFIG.deviceInfo || {};
    const socket = S.createSocket(url.toString(), {
        handshakeTimeout: 20000,
        headers: {
            'User-Agent': di.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
            'Origin': 'https://gate-obt.nqf.qq.com',
        },
    });
    const context: ConnectionContext = {
        id: S.nextConnectionId++,
        socket,
        phase: 'connecting',
        intentionalClose: false,
        finalized: false,
        loginInitialized: false,
        clientVersion,
        startedMono: S.now(),
    };
    S.connection = context;
    S.ws = socket;
    socket.binaryType = 'arraybuffer';

    (socket as any).on('open', () => {
        if (!stateMod.isCurrentConnection(context)) return;
        context.phase = 'login';
        S.scheduler.setTimeoutTask('login_timeout', 20000, () => {
            if (!stateMod.isCurrentConnection(context) || context.phase !== 'login') return;
            utilsMod.logWarn('登录', '登录响应超时，账号将停止运行...');
            keepaliveMod.finalizeConnection(context, { source: 'login_timeout', reason: '登录响应超时' });
            try { (socket as any).terminate(); } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:1157', err); }
        });
        loginMod.sendLogin(context, onLoginSuccess).catch((e: any) => {
            if (!stateMod.isCurrentConnection(context)) return;
            keepaliveMod.finalizeConnection(context, { source: 'login_send_failed', reason: e.message });
            try { (socket as any).terminate(); } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:1162', err); }
        });
    });

    (socket as any).on('message', (data: any, _isBinary: any) => {
        if (!stateMod.isCurrentConnection(context)) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        messagesMod.handleMessage(buf);
    });

    (socket as any).on('close', (closeCode: any, closeReason: any) => {
        const reason = Buffer.isBuffer(closeReason) ? closeReason.toString('utf8') : String(closeReason || '');
        console.warn(`[WS] 连接关闭 (code=${closeCode})`);
        keepaliveMod.finalizeConnection(context, { source: 'ws_close', code: Number(closeCode) || 0, reason });
    });

    (socket as any).on('error', (err: any) => {
        if (!stateMod.isCurrentConnection(context)) return;
        const message = err && err.message ? String(err.message) : '';
        utilsMod.logWarn('系统', `[WS] 错误: ${message}`);
        const match = message.match(/Unexpected server response:\s*(\d+)/i);
        if (match) {
            const errorCode = Number.parseInt(match[1], 10) || 0;
            if (errorCode) {
                sessionMod.setWsErrorState(errorCode, message);
                S.events.emit('ws_error', { code: errorCode, message });
            }
        }
    });
}

function cleanup(reason = '网络清理'): void {
    const context = S.connection;
    if (!context) {
        keepaliveMod.clearNetworkRuntime(reason);
        return;
    }
    context.intentionalClose = true;
    keepaliveMod.finalizeConnection(context, { source: 'intentional_close', reason });
    try { context.socket.close(); } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:1201', err); }
}

function getWs(): WebSocket | null { return S.ws; }

export { connect, cleanup, getWs };
