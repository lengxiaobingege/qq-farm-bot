const assert = require('node:assert/strict');
const test = require('node:test');

const { refreshAccountWxLoginCode, WX_FARM_APP_ID } = require('../dist/services/wx-login/refresh-account-code');

function createStore(accounts) {
    return {
        getAccounts: () => ({ accounts }),
        addOrUpdateAccount(acc) {
            const current = accounts.find(item => item.id === acc.id);
            if (current) Object.assign(current, acc);
            return { accounts };
        },
    };
}

test('refreshAccountWxLoginCode issues a fresh code from the saved session', async () => {
    const accounts = [{
        id: '1',
        name: 'wx-user',
        platform: 'wx',
        code: 'old-code',
        loginBuffer: 'saved-buffer',
        wxOpenId: 'openid-value',
        wxAccessToken: 'old-access',
        wxRefreshToken: 'old-refresh',
    }];
    const issued = [];
    const result = await refreshAccountWxLoginCode({
        store: createStore(accounts),
        accountId: '1',
        issueWxLoginCode(loginBuffer, appId, credentials) {
            issued.push({ loginBuffer, appId, credentials });
            return {
                code: 'new-code',
                loginBuffer: 'fresh-buffer',
                credentials: {
                    openid: 'openid-value',
                    accessToken: 'new-access',
                    refreshToken: 'new-refresh',
                    loginType: 'WX',
                },
            };
        },
    });

    assert.equal(result.ok, true);
    assert.equal(issued[0].loginBuffer, 'saved-buffer');
    assert.equal(issued[0].appId, WX_FARM_APP_ID);
    assert.equal(accounts[0].code, 'new-code');
    assert.equal(accounts[0].loginBuffer, 'fresh-buffer');
    assert.equal(accounts[0].wxAccessToken, 'new-access');
});

test('refreshAccountWxLoginCode asks for scan when the session is missing', async () => {
    const accounts = [{ id: '1', name: 'wx-user', platform: 'wx', code: 'old-code' }];
    const result = await refreshAccountWxLoginCode({
        store: createStore(accounts),
        accountId: '1',
        issueWxLoginCode() {
            throw new Error('should not issue');
        },
    });
    assert.equal(result.ok, false);
    assert.equal(result.needScan, true);
});

test('refreshAccountWxLoginCode returns a retryable failure when issueCode throws', async () => {
    const accounts = [{
        id: '1',
        name: 'wx-user',
        platform: 'wx',
        loginBuffer: 'saved-buffer',
    }];
    const result = await refreshAccountWxLoginCode({
        store: createStore(accounts),
        accountId: '1',
        issueWxLoginCode() {
            throw new Error('refresh failed');
        },
    });
    assert.equal(result.ok, false);
    assert.equal(result.needScan, true);
    assert.match(String(result.error), /refresh failed/);
    assert.equal(accounts[0].loginBuffer, 'saved-buffer');
});

test('refreshAccountWxLoginCode returns 404 for unknown accounts', async () => {
    const result = await refreshAccountWxLoginCode({
        store: createStore([]),
        accountId: 'missing',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
});
