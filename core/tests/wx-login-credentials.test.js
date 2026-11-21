const test = require('node:test');
const assert = require('node:assert/strict');

const { WxLoginService, accountFieldsFromSession } = require('../dist/services/wx-login/service');

function stubFetch(responses) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        const body = responses.shift();
        assert.notEqual(body, undefined, `unexpected extra request: ${url}`);
        return { status: 200, headers: new Headers(), arrayBuffer: async () => Buffer.from(body) };
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
}

test('refreshing credentials keeps the new access token when the login buffer step fails', async () => {
    // 第一跳刷新成功下发新 accessToken，第二跳取登录缓冲被微信以 code!=0 拒绝。
    // 旧实现会把第一跳的成果一起丢掉，导致手里只剩过期 accessToken，之后每次刷新都被 -109。
    const stub = stubFetch([
        JSON.stringify({ code: 0, user_info: { access_token: 'fresh-access-token', refresh_token: 'fresh-refresh-token', expires_in: 7200 } }),
        JSON.stringify({ code: 12, msg: 'frequent' }),
    ]);

    try {
        const service = new WxLoginService();
        const credentials = {
            openid: 'openid-value',
            accessToken: 'stale-access-token',
            refreshToken: 'stale-refresh-token',
            loginType: 'WX',
            expiresAt: 1,
            expiresIn: 7200,
        };

        await assert.rejects(
            () => service.refreshLoginBuffer(credentials),
            (error) => {
                assert.match(String(error.message), /login buffer response is invalid/);
                assert.equal(error.credentials?.accessToken, 'fresh-access-token');
                assert.equal(error.credentials?.refreshToken, 'fresh-refresh-token');
                return true;
            },
        );
        assert.equal(stub.calls.length, 2);
    } finally {
        stub.restore();
    }
});

test('a failed refresh does not fake credentials on the error', async () => {
    const stub = stubFetch([JSON.stringify({ code: -109, msg: 'RC_PARAMS_INVALID' })]);

    try {
        const service = new WxLoginService();
        await assert.rejects(
            () => service.refreshLoginBuffer({ openid: 'openid-value', accessToken: 'stale', refreshToken: 'dead', loginType: 'WX' }),
            (error) => {
                assert.equal(Number(error.code), -109);
                assert.equal(error.credentials, undefined);
                return true;
            },
        );
    } finally {
        stub.restore();
    }
});

test('session fields carry the scan-issued expiry so the account stops looking "due for refresh"', () => {
    const now = Math.floor(Date.now() / 1000);
    const fields = accountFieldsFromSession({
        cookies: new Map(),
        loginBuffer: 'buffer-value',
        openid: 'openid-value',
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        loginType: 'WX',
        expiresAt: now + 7200,
        expiresIn: 7200,
        refreshTokenObservedAt: now,
    });

    assert.equal(fields.loginBuffer, 'buffer-value');
    assert.equal(fields.wxOpenId, 'openid-value');
    assert.equal(fields.wxAccessToken, 'access-token-value');
    assert.equal(fields.wxExpiresAt, now + 7200);
    assert.equal(fields.wxExpiresIn, 7200);
    assert.equal(fields.wxRefreshToken, 'refresh-token-value');
    assert.equal(fields.wxRefreshTokenObservedAt, now);
});

test('session fields omit refresh token when WeChat did not issue one', () => {
    const fields = accountFieldsFromSession({
        cookies: new Map(),
        loginBuffer: 'buffer-value',
        openid: 'openid-value',
        accessToken: 'access-token-value',
        loginType: 'WX',
        expiresAt: 1700000000,
        expiresIn: 7200,
    });

    assert.equal('wxRefreshToken' in fields, false);
    assert.equal('wxRefreshTokenObservedAt' in fields, false);
});

test('the scan session stash is exported and consumes codes one-shot', () => {
    const routes = require('../dist/controllers/admin/wx-login-routes');
    assert.equal(typeof routes.takeIssuedWxSessionByCode, 'function');
    // 未知 code 取不到东西，且重复取仍然为空
    assert.equal(routes.takeIssuedWxSessionByCode('unknown-code'), null);
    assert.equal(routes.takeIssuedWxSessionByCode('unknown-code'), null);
    assert.equal(routes.takeIssuedWxSessionByCode(''), null);
    assert.equal(routes.takeIssuedWxSessionByCode(undefined), null);
});
