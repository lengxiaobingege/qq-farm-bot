const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    applyCors,
    isOriginAllowed,
    getAllowedOrigins,
} = require(path.resolve(__dirname, '../dist/controllers/admin/cors.js'));

function mockRes() {
    const headers = {};
    return {
        headers,
        statusCode: null,
        body: null,
        header(key, value) { headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
    };
}

function mockReq({ origin, host = '127.0.0.1:3000', method = 'GET' } = {}) {
    const headers = { host };
    if (origin !== undefined) headers.origin = origin;
    return { headers, method };
}

test('默认白名单包含本地开发地址，且不含通配符', () => {
    const list = getAllowedOrigins();
    assert.ok(list.includes('http://localhost:5173'));
    assert.ok(list.includes('http://127.0.0.1:5173'));
    assert.ok(!list.includes('*'));
});

test('同源来源自动放行（无需配置白名单）', () => {
    assert.equal(
        isOriginAllowed('https://panel.example.com', 'panel.example.com'),
        true,
    );
    assert.equal(
        isOriginAllowed('https://evil.example.com', 'panel.example.com'),
        false,
    );
    assert.equal(isOriginAllowed(undefined, 'panel.example.com'), true);
});

test('白名单来源回显 ACAO 与 credentials，并设置 Vary: Origin', () => {
    const res = mockRes();
    const ok = applyCors(mockReq({ origin: 'http://localhost:5173' }), res);
    assert.equal(ok, true);
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
    assert.equal(res.headers['Access-Control-Allow-Credentials'], 'true');
    assert.equal(res.headers['Vary'], 'Origin');
});

test('非白名单跨域来源返回 403，且不回显 ACAO / credentials', () => {
    const res = mockRes();
    const ok = applyCors(mockReq({ origin: 'https://evil.example.com' }), res);
    assert.equal(ok, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Origin not allowed');
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(res.headers['Access-Control-Allow-Credentials'], undefined);
});

test('非白名单的 OPTIONS 预检同样被拒绝', () => {
    const res = mockRes();
    const ok = applyCors(mockReq({ origin: 'https://evil.example.com', method: 'OPTIONS' }), res);
    assert.equal(ok, false);
    assert.equal(res.statusCode, 403);
});

test('无 Origin 请求不再返回通配符来源，且可继续处理', () => {
    const res = mockRes();
    const ok = applyCors(mockReq(), res);
    assert.equal(ok, true);
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(res.headers['Access-Control-Allow-Credentials'], undefined);
});

test('无 Origin 的 OPTIONS 预检返回 204 并结束响应', () => {
    const res = mockRes();
    const ok = applyCors(mockReq({ method: 'OPTIONS' }), res);
    assert.equal(ok, false);
    assert.equal(res.statusCode, 204);
});

test('CORS_ALLOWED_ORIGINS 可追加自定义域名（逗号分隔）', () => {
    const previous = process.env.CORS_ALLOWED_ORIGINS;
    try {
        process.env.CORS_ALLOWED_ORIGINS = 'https://a.example.com, https://b.example.com/';
        const list = getAllowedOrigins();
        assert.ok(list.includes('https://a.example.com'));
        assert.ok(list.includes('https://b.example.com'));
        const res = mockRes();
        assert.equal(applyCors(mockReq({ origin: 'https://a.example.com' }), res), true);
        assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://a.example.com');
    } finally {
        if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
        else process.env.CORS_ALLOWED_ORIGINS = previous;
    }
});
