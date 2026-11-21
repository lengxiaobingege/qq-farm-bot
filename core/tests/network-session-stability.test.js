const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { CONFIG } = require('../dist/config/config');
const { loadProto, types } = require('../dist/utils/proto');

// 拆分后 network 由 src/utils/network/ 下多个模块组成，测试直接 require 子模块并替换
// 公开接缝（S.createSocket / S.scheduler / S.now / codec.sendMsgAsync …），不再整文件塞进 VM。
const stateMod = require('../dist/utils/network/state');
const codecMod = require('../dist/utils/network/codec');
const keepaliveMod = require('../dist/utils/network/keepalive');
const loginMod = require('../dist/utils/network/login');
const sessionMod = require('../dist/utils/network/session');
const connectionMod = require('../dist/utils/network/connection');

function harness() {
    const { S } = stateMod;
    const tasks = new Map();
    const requests = [];
    const sockets = [];
    let mono = 0;
    let wall = 100000;

    // 子模块共享同一份单例状态，每个 harness 先复位到干净基线
    S.ws = null;
    S.connection = null;
    S.nextConnectionId = 1;
    S.clientSeq = 1;
    S.serverSeq = 0;
    S.pending = new Map();
    S.queue.length = 0;
    S.nextRequestId = 1;
    S.wsError = { code: 0, at: 0, message: '' };
    S.lastPressureLogAt = 0;
    S.heartbeatMisses = 0;
    S.now = () => mono;
    S.lastInboundMono = 0;
    S.lastHeartbeatMono = 0;
    S.events.removeAllListeners();
    S.scheduler = {
        setIntervalTask: (key, _ms, fn) => tasks.set(key, fn),
        setTimeoutTask: (key, _ms, fn) => tasks.set(key, fn),
        clear: key => tasks.delete(key),
        clearAll: () => tasks.clear(),
    };

    class Socket extends EventEmitter {
        static OPEN = 1;

        readyState = 1;

        constructor(url, options) {
            super();
            this.url = url;
            this.options = options;
            sockets.push(this);
        }

        terminate() {
            this.terminated = true;
            this.emit('close', 1006);
        }

        close() {
            this.emit('close', 1000);
        }
    }
    S.createSocket = (url, options) => new Socket(url, options);

    codecMod.sendMsg = async (_context, _service, method, body, options) => {
        requests.push({ method, body });
        await options.callback(null, types[`${method}Reply`].encode({ basic: { gid: 1, level: 1 } }).finish());
    };
    // 默认让场景登录回包合法，否则 sendLogin 会走 login_init_failed 并清空调度器
    codecMod.sendMsgAsync = async (_service, method, body) => {
        requests.push({ method, body });
        return { body: types.PlayerSceneLoginReply.encode({ global_scene_id: 1, farm_scene_ext_data: Buffer.from([8, 1]) }).finish() };
    };
    sessionMod.fetchUserSettings = async () => {};

    const api = {
        connect: connectionMod.connect,
        cleanup: connectionMod.cleanup,
        getWs: connectionMod.getWs,
        networkEvents: S.events,
        login: () => loginMod.sendLogin(S.connection),
        setSender: fn => { codecMod.sendMsgAsync = fn; },
        snapshot: () => keepaliveMod.getConnectionDiagnostics(S.connection),
    };
    return { api, sockets, requests, tasks, advance: (ms) => { mono += ms; wall += ms; }, jumpWall: (ms) => { wall += ms; } };
}

test('each session pins its platform version from handshake through login and heartbeat', async () => {
    await loadProto();
    const saved = { platform: CONFIG.platform, clientVersion: CONFIG.clientVersion, wxClientVersion: CONFIG.wxClientVersion };
    try {
        for (const platform of ['qq', 'wx', 'wechat']) {
            CONFIG.platform = platform;
            CONFIG.clientVersion = '1.15.0.2_qq';
            CONFIG.wxClientVersion = '1.15.0.2_wx';
            const expected = platform === 'qq' ? CONFIG.clientVersion : CONFIG.wxClientVersion;
            const h = harness();
            h.api.connect('synthetic-code');
            assert.equal(new URL(h.sockets[0].url).searchParams.get('ver'), expected);
            assert.equal(new URL(h.sockets[0].url).searchParams.get('platform'), platform === 'qq' ? 'qq' : 'wx');
            assert.equal(h.sockets[0].options.handshakeTimeout, 20000);
            // A settings broadcast while connecting must not change the login RPC or version.
            CONFIG.clientVersion = '1.14.2.15_old';
            CONFIG.wxClientVersion = '1.14.2.13_old';
            await h.api.login();
            assert.equal(h.requests[0].method, 'PlayerLogin');
            assert.equal(types.PlayerLoginRequest.decode(h.requests[0].body).device_info.client_version, expected);
            h.api.setSender(async (_service, method, body) => {
                assert.equal(method, 'Heartbeat');
                assert.equal(types.HeartbeatRequest.decode(body).client_version, expected);
                return { body: Buffer.alloc(0) };
            });
            await h.tasks.get('heartbeat_interval')();
            assert.equal(h.api.snapshot().clientVersion, expected);
            h.api.cleanup();
        }
    } finally { Object.assign(CONFIG, saved); }
});

test('wall-clock jumps cannot disconnect a recently active connection or conceal a stale one', async () => {
    await loadProto();
    const h = harness();
    const disconnects = [];
    h.api.networkEvents.on('disconnected', event => disconnects.push(event));
    h.api.connect('synthetic-code');
    await h.api.login();
    h.api.setSender(async () => { throw new Error('synthetic timeout'); });
    const heartbeat = h.tasks.get('heartbeat_interval');
    h.advance(20000);
    h.jumpWall(86400000);
    await heartbeat(); await heartbeat(); await heartbeat();
    assert.equal(disconnects.length, 0);
    assert.equal(h.api.snapshot().lastInboundAgeMs, 20000);
    assert.equal(h.api.snapshot().onlineAgeMs, 20000);
    h.advance(20000);
    h.jumpWall(-172800000);
    await heartbeat();
    assert.equal(disconnects.length, 1);
    assert.equal(disconnects[0].source, 'heartbeat_timeout');
    assert.equal(disconnects[0].diagnostics.lastInboundAgeMs, 40000);
    assert.equal(disconnects[0].diagnostics.connectionAgeMs, 40000);
    assert.equal(h.sockets[0].terminated, true);
    assert.equal(h.sockets.length, 1); // No automatic replay of the one-time Code.
    assert.equal(h.tasks.size, 0);
});

test('a failed handshake ends once and never reuses its Code', () => {
    const h = harness();
    const disconnects = [];
    h.api.networkEvents.on('disconnected', event => disconnects.push(event));
    h.api.connect('synthetic-code');
    h.sockets[0].emit('error', new Error('Opening handshake has timed out'));
    h.sockets[0].emit('close', 1006);
    h.sockets[0].emit('close', 1006);
    assert.equal(disconnects.length, 1);
    assert.equal(disconnects[0].phase, 'connecting');
    assert.equal(h.api.getWs(), null);
    assert.equal(h.sockets.length, 1);
});
