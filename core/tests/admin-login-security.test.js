const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

// 用隔离的临时数据文件加载限流模块，避免污染真实 core/data
function loadSecurity() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-sec-'));
    const file = path.join(dir, 'attempts.json');
    const filename = path.resolve(__dirname, '../dist/models/auth-security.js');
    const realRequire = createRequire(filename);
    const sandbox = {
        require: name => name === '../config/runtime-paths'
            ? { getDataFile: () => file, ensureDataDir() {} }
            : realRequire(name),
        module: { exports: {} }, exports: {}, process, console, Buffer,
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return sandbox.module.exports;
}

function loadMiddleware() {
    const filename = path.resolve(__dirname, '../dist/controllers/admin/middleware.js');
    const realRequire = createRequire(filename);
    const sandbox = {
        require: name => name === '../../models/store' ? {} : realRequire(name),
        module: { exports: {} }, exports: {}, process, console, Buffer,
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return sandbox.module.exports;
}

function req(remoteAddress, headers = {}) {
    return { headers, socket: { remoteAddress } };
}

test('direct public clients cannot spoof cf-connecting-ip / x-real-ip / x-forwarded-for', () => {
    const { getClientIp } = loadMiddleware();
    const spoofed = {
        'cf-connecting-ip': '1.2.3.4',
        'x-real-ip': '5.6.7.8',
        'x-forwarded-for': '9.10.11.12',
    };
    assert.equal(getClientIp(req('203.0.113.50', spoofed)), '203.0.113.50');
    assert.equal(getClientIp(req('203.0.113.51')), '203.0.113.51');
    assert.equal(getClientIp(req('::ffff:203.0.113.52')), '203.0.113.52');
    // 回环直连同样不得采信伪造头（否则本机即可任意拆分限流桶）
    assert.equal(getClientIp(req('127.0.0.1', spoofed)), '127.0.0.1');
    assert.equal(getClientIp(req('::1', spoofed)), '::1');
});

test('trusted proxies resolve the rightmost non-proxy hop, ignoring forged left values', () => {
    const { getClientIp } = loadMiddleware();
    // 客户端伪造最左值，代理追加真实客户端 IP 到最右
    assert.equal(getClientIp(req('10.0.0.4', {
        'x-forwarded-for': '1.2.3.4, 203.0.113.77',
    })), '203.0.113.77');
    assert.equal(getClientIp(req('10.0.0.5', {
        'x-forwarded-for': '203.0.113.88, 10.0.0.5',
    })), '203.0.113.88');
    // 纯私网链回退到最靠近代理的一跳
    assert.equal(getClientIp(req('172.24.0.1', {
        'x-forwarded-for': '10.0.0.9, 172.24.0.42',
    })), '172.24.0.42');
});

test('failed-attempt lockout is scoped per IP: one source cannot lock out the admin', () => {
    const sec = loadSecurity();
    sec.loadLoginAttempts();
    const attacker = '198.51.100.10';
    for (let i = 0; i < 5; i += 1) sec.recordFailedAttempt(attacker);
    assert.equal(sec.checkAdminLockout(attacker).locked, true);
    // 管理员从另一个 IP 登录不受攻击者影响
    assert.equal(sec.checkAdminLockout('198.51.100.99').locked, false);
    // 成功后只清除该 IP 的计数
    sec.clearFailedAttempts('198.51.100.99');
    assert.equal(sec.checkAdminLockout(attacker).locked, true);
});

test('rate limit still caps attempts from a single IP', () => {
    const sec = loadSecurity();
    sec.loadLoginAttempts();
    const ip = '198.51.100.20';
    for (let i = 0; i < 10; i += 1) assert.equal(sec.checkRateLimit(ip).allowed, true);
    assert.equal(sec.checkRateLimit(ip).allowed, false);
    assert.equal(sec.checkRateLimit('198.51.100.21').allowed, true);
});
