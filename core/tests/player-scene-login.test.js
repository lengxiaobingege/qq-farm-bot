const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProto, types } = require('../dist/utils/proto');
const { CONFIG } = require('../dist/config/config');

// 拆分后 sendLogin 位于 dist/utils/network/login.js；这里直接 patch 它依赖的模块对象
// （codec/session/keepalive/ace/crypto-wasm），不再把整份 network.js 塞进 VM。
const stateMod = require('../dist/utils/network/state');
const loginMod = require('../dist/utils/network/login');
const codecMod = require('../dist/utils/network/codec');
const keepaliveMod = require('../dist/utils/network/keepalive');
const sessionMod = require('../dist/utils/network/session');
const aceMod = require('../dist/services/ace');
const cryptoWasmMod = require('../dist/utils/crypto-wasm');

async function harness(platform) {
    await loadProto();
    CONFIG.platform = platform;
    const { S } = stateMod;
    const steps = [];
    let sceneResolve;

    S.events.removeAllListeners();
    S.scheduler = { setIntervalTask() {}, setTimeoutTask() {}, clear() {}, clearAll() {} };
    cryptoWasmMod.bindUser = async () => steps.push('bind');
    cryptoWasmMod.getEncryptedInitInfo = () => '';
    aceMod.startAceRuntime = () => steps.push('ace');
    keepaliveMod.startHeartbeat = () => steps.push('heartbeat');
    sessionMod.fetchUserSettings = async () => steps.push('settings');
    keepaliveMod.finalizeConnection = () => steps.push('failed');
    codecMod.sendMsg = async (_context, _service, method, body, options) => {
        steps.push(method);
        await options.callback(null, respond(method, body));
    };
    codecMod.sendMsgAsync = async (_service, method, body) => { steps.push(method); return scene(body); };

    const respond = (method, body) => {
        const request = types[`${method}Request`].decode(body);
        assert.ok(request.device_info.client_version);
        return types[`${method}Reply`].encode({ basic: { gid: 1, level: 1, open_id: 'synthetic' } }).finish();
    };
    const scene = body => {
        assert.equal(types.PlayerSceneLoginRequest.decode(body).global_scene_id, 1);
        return new Promise((resolve) => { sceneResolve = resolve; });
    };

    const socket = { readyState: 1, terminate: () => steps.push('terminate') };
    S.ws = socket;
    const context = { socket, phase: 'authenticating', finalized: false, loginInitialized: false };
    S.connection = context;

    const run = loginMod.sendLogin(context, () => steps.push('ready'));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return {
        steps,
        run,
        replace: () => { S.connection = null; },
        finish: data => sceneResolve({ body: types.PlayerSceneLoginReply.encode(data).finish() }),
    };
}

test('QQ and WeChat enter the farm scene before starting automation', async () => {
    const saved = CONFIG.platform;
    try {
        for (const platform of ['qq', 'wx', 'wechat']) {
            const h = await harness(platform);
            assert.deepEqual(h.steps, ['PlayerLogin', 'bind', 'ace', 'heartbeat', 'settings', 'PlayerSceneLogin']);
            assert.equal(h.steps.includes('ready'), false);
            h.finish({ global_scene_id: 1, farm_scene_ext_data: Buffer.from([8, 1]) });
            await h.run;
            assert.equal(h.steps.at(-1), 'ready');
        }
    } finally { CONFIG.platform = saved; }
});

test('incomplete or stale QQ and WeChat scene replies cannot start farming', async () => {
    const saved = CONFIG.platform;
    try {
        for (const platform of ['qq', 'wx']) {
            const broken = await harness(platform);
            broken.finish({ global_scene_id: 1 });
            await broken.run;
            assert.deepEqual(broken.steps.slice(-2), ['failed', 'terminate']);
            assert.equal(broken.steps.includes('ready'), false);
            const stale = await harness(platform);
            stale.replace();
            stale.finish({ global_scene_id: 1, farm_scene_ext_data: Buffer.from([8, 1]) });
            await stale.run;
            assert.equal(stale.steps.includes('ready'), false);
        }
    } finally { CONFIG.platform = saved; }
});

test('explicit historical QQ and WeChat clients retain single-stage login', async () => {
    const saved = { platform: CONFIG.platform, clientVersion: CONFIG.clientVersion, wxClientVersion: CONFIG.wxClientVersion };
    try {
        CONFIG.clientVersion = '1.14.2.15_20260922';
        CONFIG.wxClientVersion = '1.14.2.13_20260922';
        for (const platform of ['qq', 'wx']) {
            const old = await harness(platform);
            await old.run;
            assert.equal(old.steps[0], 'Login');
            assert.equal(old.steps.includes('PlayerSceneLogin'), false);
            assert.equal(old.steps.at(-1), 'ready');
        }
    } finally { Object.assign(CONFIG, saved); }
});
