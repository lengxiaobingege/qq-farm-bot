export {};

const { WX_FARM_APP_ID } = require('./service');

function unwrapIssuedCode(issued: any, fallbackBuffer: string, fallbackCredentials: any): { code: string; loginBuffer: string; credentials: any } {
    if (typeof issued === 'string') {
        return { code: String(issued || '').trim(), loginBuffer: fallbackBuffer, credentials: fallbackCredentials };
    }
    const code = String(issued?.code || '').trim();
    const loginBuffer = String(issued?.loginBuffer || fallbackBuffer || '').trim();
    const credentials = issued?.credentials || fallbackCredentials;
    return { code, loginBuffer, credentials };
}

async function issueCodeWithExternalFallback(options: {
    loginBuffer: string;
    credentials?: any;
    openid?: string;
    issueWxLoginCode: (loginBuffer: string, appId: string, credentials?: any) => Promise<any>;
    appId?: string;
}): Promise<{ code: string; loginBuffer: string; credentials: any; source: 'local' }> {
    const loginBuffer = String(options.loginBuffer || '').trim();
    const credentials = options.credentials;
    const appId = options.appId || WX_FARM_APP_ID;

    const issued = await options.issueWxLoginCode(loginBuffer, appId, credentials);
    const unwrapped = unwrapIssuedCode(issued, loginBuffer, credentials);
    if (!unwrapped.code) throw new Error('empty wx login code');
    return { ...unwrapped, source: 'local' };
}

module.exports = {
    unwrapIssuedCode,
    issueCodeWithExternalFallback,
    WX_FARM_APP_ID,
};
