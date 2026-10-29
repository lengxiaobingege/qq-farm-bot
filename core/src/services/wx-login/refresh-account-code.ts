export {};

const {
    WX_FARM_APP_ID,
    WxLoginService,
    accountFieldsFromCredentials,
    credentialsFromAccount,
} = require('./service');

function findAccount(store: any, accountId: string): any {
    const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    return accounts.find((item: any) => String(item?.id || '') === String(accountId || '')) || null;
}

async function refreshAccountWxLoginCode(options: {
    store: any;
    accountId: string;
    issueWxLoginCode?: (loginBuffer: string, appId: string, credentials?: any) => Promise<any>;
}): Promise<{ ok: boolean; error?: string; needScan?: boolean; status?: number; accountName?: string }> {
    const id = String(options.accountId || '');
    const store = options.store;
    if (!id) return { ok: false, error: 'Account not found', status: 404 };

    const account = findAccount(store, id);
    if (!account) return { ok: false, error: 'Account not found', status: 404 };

    const accountName = String(account.name || id);

    const loginBuffer = String(account.loginBuffer || '').trim();
    const credentials = credentialsFromAccount(account);
    const wxLogin = new WxLoginService();
    const issueWxLoginCode = options.issueWxLoginCode
        || ((buffer: string, appId: string, nextCredentials?: any) => wxLogin.issueCodeFromLoginBuffer(buffer, appId, nextCredentials));

    try {
        const issued = await issueWxLoginCode(loginBuffer, WX_FARM_APP_ID, credentials);
        let code: string, nextBuffer: string, nextCredentials: any;
        if (typeof issued === 'string') {
            code = String(issued || '').trim();
            nextBuffer = loginBuffer;
            nextCredentials = credentials;
        } else {
            code = String(issued?.code || '').trim();
            nextBuffer = String(issued?.loginBuffer || loginBuffer || '').trim();
            nextCredentials = issued?.credentials || credentials;
        }
        if (!code) throw new Error('empty wx login code');
        store.addOrUpdateAccount({ id, code, ...accountFieldsFromCredentials(nextBuffer, nextCredentials) });
        return { ok: true, accountName };
    } catch (error: any) {
        return {
            ok: false,
            needScan: true,
            error: String(error?.message || error || '换码失败'),
            accountName,
        };
    }
}

module.exports = {
    refreshAccountWxLoginCode,
    WX_FARM_APP_ID,
};
