const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const DIST = path.resolve(__dirname, '../dist');

/**
 * 起一个隔离的面板认证实例：
 * - admin.json / login-attempts.json 落到临时目录，绝不碰真实 core/data
 * - 推送换成假实现，可断言内容、可模拟失败
 * - 日志换成 no-op，避免测试写生产日志（历史上踩过这个坑）
 */
function buildServer(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-login-'));
    fs.chmodSync(dir, 0o700);
    const dataFile = name => path.join(dir, name);
    // session-store 每次调用都读这个变量，运行时设置即可生效；避免污染真实 core/data
    process.env.ADMIN_SESSIONS_FILE = dataFile('admin-sessions.json');

    // ── 1. 隔离加载 runtime-paths（重定向数据目录）
    const runtimePaths = {
        getDataFile: dataFile,
        ensureDataDir: () => dir,
        getDataDir: () => dir,
        getResourcePath: (...seg) => path.join(DIST, '..', 'src', ...seg),
        getShareFilePath: () => path.join(dir, 'share.txt'),
        isPackaged: false,
    };

    // ── 2. 隔离加载 auth-security（限流记录写临时目录）
    const securityFile = path.resolve(DIST, 'models/auth-security.js');
    const securityRequire = createRequire(securityFile);
    const securitySandbox = {
        require: name => name === '../config/runtime-paths' ? runtimePaths : securityRequire(name),
        module: { exports: {} }, exports: {}, process, console, Buffer,
    };
    vm.runInNewContext(fs.readFileSync(securityFile, 'utf8'), securitySandbox, { filename: securityFile });
    const security = securitySandbox.module.exports;

    // ── 3. 隔离加载 admin-store（admin.json 写临时目录）
    const storeFile = path.resolve(DIST, 'models/admin-store.js');
    const storeRequire = createRequire(storeFile);
    const storeSandbox = {
        require: name => {
            if (name === '../config/runtime-paths') return runtimePaths;
            if (name === './auth-security') return security;
            return storeRequire(name);
        },
        module: { exports: {} }, exports: {}, process, console: { log() {}, warn() {}, error() {} }, Buffer,
    };
    vm.runInNewContext(fs.readFileSync(storeFile, 'utf8'), storeSandbox, { filename: storeFile });
    const adminStore = storeSandbox.module.exports;

    // ── 4. 假推送：记录所有安全通知，可指定失败
    const pushes = [];
    let pushShouldFail = options.pushShouldFail === true;
    const adminNotify = {
        pushSecurityMessage: async () => ({ ok: true }),
        notifyLoginSuccess: async payload => { pushes.push({ type: 'success', ...payload }); return { ok: true }; },
        notifyLoginCode: async payload => {
            pushes.push({ type: 'code', ...payload });
            return pushShouldFail ? { ok: false, reason: '渠道未配置' } : { ok: true };
        },
        notifyLoginLocked: async payload => { pushes.push({ type: 'locked', ...payload }); return { ok: true }; },
        formatTime: () => 'test',
    };

    const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

    // 每个实例独立加载挑战模块：挑战只存内存，隔离后各用例互不干扰
    const challengeFile = path.resolve(DIST, 'models/login-challenge.js');
    const challengeRequire = createRequire(challengeFile);
    const challengeSandbox = {
        require: name => challengeRequire(name),
        module: { exports: {} }, exports: {}, process, console, Buffer,
    };
    vm.runInNewContext(fs.readFileSync(challengeFile, 'utf8'), challengeSandbox, { filename: challengeFile });
    const loginChallenge = challengeSandbox.module.exports;

    // ── 5. 加载 auth-routes，替换其依赖
    const routesFile = path.resolve(DIST, 'controllers/admin/auth-routes.js');
    const routesRequire = createRequire(routesFile);
    const routesSandbox = {
        require: name => {
            if (name === '../../models/admin-store') return adminStore;
            if (name === '../../models/login-challenge') return loginChallenge;
            if (name === '../../services/admin-notify') return adminNotify;
            if (name === '../../services/logger') return { createModuleLogger: () => quietLogger };
            if (name === '../../config/config') return { getRuntimeConfig: () => ({ clientVersion: '1', wxClientVersion: '1' }) };
            if (name === '../../services/scheduler') return { getSchedulerRegistrySnapshot: () => ({}) };
            return routesRequire(name);
        },
        module: { exports: {} }, exports: {}, process, console, Buffer,
    };
    vm.runInNewContext(fs.readFileSync(routesFile, 'utf8'), routesSandbox, { filename: routesFile });
    const { mountAuthRoutes } = routesSandbox.module.exports;

    const express = require('express');
    const app = express();
    app.use(express.json());

    const { createSessionStore } = require(path.resolve(DIST, 'controllers/admin/session-store.js'));
    const ctx = { tokens: createSessionStore(), app: null, server: null, io: null, provider: {} };
    mountAuthRoutes(app, ctx);

    const server = app.listen(0);
    const { port } = server.address();

    return {
        adminStore,
        ctx,
        pushes,
        port,
        url: p => `http://127.0.0.1:${port}${p}`,
        setPushFail: value => { pushShouldFail = value; },
        close: () => new Promise(resolve => server.close(resolve)),
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
}

function post(env, pathName, body, headers = {}) {
    return fetch(env.url(pathName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    }).then(async res => ({ status: res.status, body: await res.json() }));
}

const DEVICE_A = 'a'.repeat(32);
const DEVICE_B = 'b'.repeat(32);
const PASSWORD = 'Str0ng!Passw0rd#9';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function setupAdmin(env) {
    env.adminStore.setupPassword(PASSWORD);
}

test('密码错误不触发验证码，也不签发令牌', async () => {
    const env = buildServer();
    setupAdmin(env);
    const res = await post(env, '/api/login', { username: 'admin', password: 'wrong-pass', deviceId: DEVICE_A }, { 'user-agent': UA });
    assert.equal(res.status, 401);
    assert.equal(res.body.errorType, 'invalid_credentials');
    assert.equal(env.pushes.filter(p => p.type === 'code').length, 0, '密码错不应发验证码');
    assert.equal(env.ctx.tokens.size, 0);
    env.close(); env.cleanup();
});

test('首次登录（无受信任设备、无活跃会话）自动信任当前设备并通知', async () => {
    const env = buildServer();
    setupAdmin(env);
    const res = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.token, '应直接签发令牌');
    assert.equal(env.adminStore.isTrustedDevice(DEVICE_A), true);
    const success = env.pushes.find(p => p.type === 'success');
    assert.ok(success, '应推送登录成功通知');
    assert.equal(success.firstTime, true);
    assert.match(success.device, /macOS|Chrome/);
    env.close(); env.cleanup();
});

test('已有受信任设备时，新设备必须过验证码，且不下发令牌', async () => {
    const env = buildServer();
    setupAdmin(env);
    // 先用 A 完成引导
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    // B 是新设备
    const res = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_B }, { 'user-agent': UA });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.errorType, 'verify_required');
    assert.ok(res.body.challengeId, '应返回挑战标识');
    assert.equal(res.body.data, undefined, '绝不能先给令牌');
    assert.equal(env.adminStore.isTrustedDevice(DEVICE_B), false);
    const codePush = env.pushes.find(p => p.type === 'code');
    assert.ok(codePush, '应推送验证码');
    assert.match(codePush.code, /^\d{6}$/);
    env.close(); env.cleanup();
});

test('回填正确验证码后签发令牌并信任该设备', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    const first = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_B }, { 'user-agent': UA });
    const code = env.pushes.find(p => p.type === 'code').code;
    const res = await post(env, '/api/login/verify', { challengeId: first.body.challengeId, code, deviceId: DEVICE_B }, { 'user-agent': UA });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.token);
    assert.equal(env.adminStore.isTrustedDevice(DEVICE_B), true);
    assert.equal(env.ctx.tokens.has(res.body.data.token), true);
    env.close(); env.cleanup();
});

test('验证码错误累计三次后作废，第四次直接判失效', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    const first = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_B }, { 'user-agent': UA });
    const challengeId = first.body.challengeId;
    const wrong = '000000';
    for (let i = 0; i < 3; i += 1) {
        const res = await post(env, '/api/login/verify', { challengeId, code: wrong, deviceId: DEVICE_B }, { 'user-agent': UA });
        assert.equal(res.status, 401);
        assert.equal(res.body.errorType, 'invalid_code');
    }
    const twice = await post(env, '/api/login/verify', { challengeId, code: wrong, deviceId: DEVICE_B }, { 'user-agent': UA });
    assert.equal(twice.status, 410, '用尽次数后挑战应作废');
    assert.equal(twice.body.errorType, 'challenge_expired');
    env.close(); env.cleanup();
});

test('验证码不能跨设备使用', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    const first = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_B }, { 'user-agent': UA });
    const code = env.pushes.find(p => p.type === 'code').code;
    const res = await post(env, '/api/login/verify', {
        challengeId: first.body.challengeId, code, deviceId: 'c'.repeat(32),
    }, { 'user-agent': UA });
    assert.equal(res.status, 410);
    assert.equal(res.body.errorType, 'challenge_mismatch');
    assert.equal(env.adminStore.isTrustedDevice('c'.repeat(32)), false);
    env.close(); env.cleanup();
});

test('受信任设备直接登录，不再要求验证码', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    const before = env.pushes.filter(p => p.type === 'code').length;
    const res = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.token);
    assert.equal(env.pushes.filter(p => p.type === 'code').length, before, '受信任设备不应再发码');
    const success = env.pushes.filter(p => p.type === 'success').pop();
    assert.equal(success.trusted, true);
    env.close(); env.cleanup();
});

test('单会话强制：新登录把旧令牌挤下线', async () => {
    const env = buildServer();
    setupAdmin(env);
    const first = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    const oldToken = first.body.data.token;
    const second = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    const newToken = second.body.data.token;
    assert.notEqual(oldToken, newToken);
    assert.equal(env.ctx.tokens.has(oldToken), false, '旧令牌必须失效');
    assert.equal(env.ctx.tokens.has(newToken), true);
    assert.equal(env.ctx.tokens.size, 1, '同一时间只保留一个会话');
    const success = env.pushes.filter(p => p.type === 'success').pop();
    assert.equal(success.evicted, 1, '通知里应说明挤掉了几个会话');
    env.close(); env.cleanup();
});

test('推送失败时不签发令牌，并给出可操作提示', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    env.setPushFail(true);
    const res = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_B }, { 'user-agent': UA });
    assert.equal(res.status, 503);
    assert.equal(res.body.errorType, 'push_failed');
    assert.equal(res.body.data, undefined);
    assert.match(res.body.error, /日志|渠道/);
    assert.equal(env.adminStore.isTrustedDevice(DEVICE_B), false);
    env.close(); env.cleanup();
});

test('没有活跃会话时受信任设备被清空，下一次登录回到引导放行', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    // 清除全部会话与设备，模拟「撤销设备 + 退出登录」后的状态
    env.ctx.tokens.clearAll();
    env.adminStore.revokeTrustedDevices();
    const res = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_B }, { 'user-agent': UA });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.token, '无设备无会话时应按首次引导放行');
    const success = env.pushes.filter(p => p.type === 'success').pop();
    assert.equal(success.firstTime, true);
    env.close(); env.cleanup();
});

test('撤销受信任设备后，原设备也要重新过验证码', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    assert.equal(env.adminStore.isTrustedDevice(DEVICE_A), true);
    env.adminStore.revokeTrustedDevices();
    assert.equal(env.adminStore.isTrustedDevice(DEVICE_A), false);
    const res = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    // 仍有活跃会话，所以不走引导放行，必须验证码
    assert.equal(res.body.errorType, 'verify_required');
    env.close(); env.cleanup();
});

test('设备标识缺失时，验证码通过仍放行，但不登记信任', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    // 老版本前端不带 deviceId
    const first = await post(env, '/api/login', { username: 'admin', password: PASSWORD }, { 'user-agent': UA });
    assert.equal(first.body.errorType, 'verify_required');
    const code = env.pushes.find(p => p.type === 'code').code;
    const res = await post(env, '/api/login/verify', { challengeId: first.body.challengeId, code }, { 'user-agent': UA });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.token, '本人过了验证码就该放进来，不能因为缺标识锁死');
    assert.equal(env.adminStore.listTrustedDevices().length, 1, '只应有先前那台 A，不能凭空多出无标识设备');
    // 下次仍要验证码（没有可信任的标识）
    const again = await post(env, '/api/login', { username: 'admin', password: PASSWORD }, { 'user-agent': UA });
    assert.equal(again.body.errorType, 'verify_required');
    env.close(); env.cleanup();
});

test('设备标识非法时视为新设备，不能借格式绕过验证', async () => {
    const env = buildServer();
    setupAdmin(env);
    await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: DEVICE_A }, { 'user-agent': UA });
    const res = await post(env, '/api/login', { username: 'admin', password: PASSWORD, deviceId: 'not a valid id!' }, { 'user-agent': UA });
    assert.equal(res.body.errorType, 'verify_required');
    assert.equal(env.ctx.tokens.size, 1, '不应签发第二个会话');
    env.close(); env.cleanup();
});
