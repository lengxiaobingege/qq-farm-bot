import crypto from 'node:crypto';
import { getNativeWxLoginCode } from './native-protocol';

const QR_CONNECT_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const QR_IMAGE_BASE = 'https://open.weixin.qq.com/connect/qrcode/';
const QR_POLL_URL = 'https://long.open.weixin.qq.com/connect/l/qrconnect';
const CALLBACK_URL = 'https://yybadaccess.3g.qq.com/pc_yyb/pcyyb_oauth';
const LOGIN_BUFFER_URL = 'https://yybadaccess.3g.qq.com/pc_yyb_auth/pcyyb_get_wx_login_buffer_auth';
const REFRESH_TOKEN_URL = 'https://yybadaccess.3g.qq.com/pc_yyb_auth/pcyyb_refresh_token_auth';
const USER_INFO_URL = 'https://yybadaccess.3g.qq.com/pc_yyb/pcyyb_get_user_info';
export const WX_FARM_APP_ID = 'wx5306c5978fdb76e4';
const OAUTH_APP_ID = 'wxd44977328b36e647';
const USER_AGENT = 'Mozilla/5.0';
const LOGIN_BUFFER_ACCESS_KEY = 'wgrdg373hy26ww2';
const LOGIN_BUSINESS_ID = 'pc_yyb_auth';
const DEFAULT_EXPIRES_IN = 7200;
const REFRESH_AHEAD_MS = 5 * 60 * 1000;

export type ScanStatus = 'waiting' | 'scanned' | 'authorized' | 'cancelled' | 'expired';

export interface WxLoginCredentials {
    openid: string;
    accessToken: string;
    refreshToken?: string;
    loginType?: string;
    nickname?: string;
    expiresAt?: number;
    expiresIn?: number;
    refreshTokenObservedAt?: number;
}

export interface WxLoginBufferResult {
    loginBuffer: string;
    credentials: WxLoginCredentials;
    refreshed?: boolean;
}

export interface WxLoginSession {
    cookies: Map<string, string>;
    uuid: string;
    oauthCode?: string;
    openid?: string;
    nickname?: string;
    loginBuffer?: string;
    accessToken?: string;
    refreshToken?: string;
    loginType?: string;
    expiresAt?: number;
    expiresIn?: number;
    refreshTokenObservedAt?: number;
}

export class RefreshRejectedError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(`refresh failed: code=${code} msg=${message}`);
        this.name = 'RefreshRejectedError';
        this.code = code;
    }
}

interface HttpResult {
    status: number;
    body: Buffer;
    headers: Headers;
}

function cookieHeader(cookies: Map<string, string>): string {
    return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ');
}

function storeCookies(cookies: Map<string, string>, headers: Headers): void {
    const headerValue = headers.get('set-cookie');
    const values = typeof (headers as any).getSetCookie === 'function'
        ? (headers as any).getSetCookie()
        : headerValue ? [headerValue] : [];
    for (const value of values) {
        const pair = value.split(';', 1)[0].trim();
        const separator = pair.indexOf('=');
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
}

async function request(url: string, cookies: Map<string, string>, init: RequestInit = {}, timeout = 35_000): Promise<HttpResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        let currentUrl = url;
        let method = init.method || 'GET';
        let body = init.body;
        for (let redirects = 0; redirects <= 5; redirects++) {
            const headers = new Headers(init.headers);
            headers.set('User-Agent', USER_AGENT);
            if (cookies.size) headers.set('Cookie', cookieHeader(cookies));
            const response = await fetch(currentUrl, { ...init, method, body, headers, redirect: 'manual', signal: controller.signal });
            storeCookies(cookies, response.headers);
            const location = response.headers.get('location');
            if (response.status < 300 || response.status >= 400 || !location) {
                return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
            }
            currentUrl = new URL(location, currentUrl).toString();
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
                method = 'GET';
                body = undefined;
            }
        }
        throw new Error('Too many redirects while contacting WeChat');
    } finally {
        clearTimeout(timer);
    }
}

function requiredCookie(cookies: Map<string, string>, name: string): string {
    const value = cookies.get(name);
    if (!value) throw new Error(`WeChat OAuth callback did not provide ${name}`);
    return value;
}

function optionalCookie(cookies: Map<string, string>, name: string): string {
    return String(cookies.get(name) || '').trim();
}

function unixSeconds(now = Date.now()): number {
    return Math.floor(now / 1000);
}

function normalizeExpiresIn(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPIRES_IN;
}

function signLoginPayload(payload: string, timestamp: string, nonce: string): string {
    return crypto.createHash('md5').update(`${payload}${timestamp}${LOGIN_BUFFER_ACCESS_KEY}${nonce}`).digest('hex');
}

function credentialsFromCookies(cookies: Map<string, string>): WxLoginCredentials {
    const openid = requiredCookie(cookies, 'openid');
    const accessToken = requiredCookie(cookies, 'accesstoken');
    const refreshToken = optionalCookie(cookies, 'refreshtoken');
    const loginType = optionalCookie(cookies, 'logintype') || 'WX';
    const nickname = optionalCookie(cookies, 'nickname');
    const expiresIn = normalizeExpiresIn(optionalCookie(cookies, 'expires_in'));
    const now = Date.now();
    return {
        openid,
        accessToken,
        refreshToken: refreshToken || undefined,
        loginType,
        nickname: nickname || undefined,
        expiresIn,
        expiresAt: unixSeconds(now) + expiresIn,
        refreshTokenObservedAt: refreshToken ? unixSeconds(now) : undefined,
    };
}

function applyCredentialsToSession(session: WxLoginSession, credentials: WxLoginCredentials, loginBuffer?: string): void {
    session.openid = credentials.openid;
    session.accessToken = credentials.accessToken;
    session.refreshToken = credentials.refreshToken;
    session.loginType = credentials.loginType;
    if (credentials.nickname) session.nickname = credentials.nickname;
    session.expiresAt = credentials.expiresAt;
    session.expiresIn = credentials.expiresIn;
    session.refreshTokenObservedAt = credentials.refreshTokenObservedAt;
    if (loginBuffer) session.loginBuffer = loginBuffer;
}

export function credentialsFromAccount(account: any): WxLoginCredentials | null {
    const openid = String(account?.wxOpenId || '').trim();
    const accessToken = String(account?.wxAccessToken || '').trim();
    if (!openid || !accessToken) return null;
    const refreshToken = String(account?.wxRefreshToken || '').trim();
    const expiresIn = normalizeExpiresIn(account?.wxExpiresIn);
    const expiresAt = Number(account?.wxExpiresAt);
    const observedAt = Number(account?.wxRefreshTokenObservedAt);
    return {
        openid,
        accessToken,
        refreshToken: refreshToken || undefined,
        loginType: String(account?.wxLoginType || '').trim() || 'WX',
        expiresIn,
        expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : undefined,
        refreshTokenObservedAt: Number.isFinite(observedAt) && observedAt > 0 ? observedAt : undefined,
    };
}

export function accountFieldsFromCredentials(loginBuffer: string, credentials?: WxLoginCredentials | null): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const buffer = String(loginBuffer || '').trim();
    if (buffer) fields.loginBuffer = buffer;
    if (!credentials) return fields;
    const openid = String(credentials.openid || '').trim();
    const accessToken = String(credentials.accessToken || '').trim();
    const refreshToken = String(credentials.refreshToken || '').trim();
    const loginType = String(credentials.loginType || '').trim();
    if (openid) fields.wxOpenId = openid;
    if (accessToken) fields.wxAccessToken = accessToken;
    if (refreshToken) fields.wxRefreshToken = refreshToken;
    if (loginType) fields.wxLoginType = loginType;
    if (Number(credentials.expiresAt) > 0) fields.wxExpiresAt = Number(credentials.expiresAt);
    if (Number(credentials.expiresIn) > 0) fields.wxExpiresIn = Number(credentials.expiresIn);
    if (Number(credentials.refreshTokenObservedAt) > 0) fields.wxRefreshTokenObservedAt = Number(credentials.refreshTokenObservedAt);
    return fields;
}

export function accountFieldsFromSession(session: WxLoginSession): Record<string, unknown> {
    return accountFieldsFromCredentials(session.loginBuffer || '', {
        openid: session.openid || '',
        accessToken: session.accessToken || '',
        refreshToken: session.refreshToken,
        loginType: session.loginType,
        expiresAt: session.expiresAt,
        expiresIn: session.expiresIn,
        refreshTokenObservedAt: session.refreshTokenObservedAt,
    });
}

export function credentialsDueForRefresh(credentials: WxLoginCredentials, now = Date.now(), aheadMs = REFRESH_AHEAD_MS): boolean {
    const expiresAt = Number(credentials.expiresAt) || 0;
    if (expiresAt <= 0) return true;
    return unixSeconds(now + aheadMs) >= expiresAt;
}

function parseLoginBufferBody(data: any): string {
    const loginBuffer = data?.code === 0 ? data?.ext_info?.list_s?.login_buffer?.value?.[0] : '';
    if (typeof loginBuffer !== 'string' || !loginBuffer) throw new Error('WeChat login buffer response is invalid');
    return loginBuffer;
}

/**
 * Keep the OAuth callback parser as a fallback. The authoritative profile is
 * fetched from pcyyb_get_user_info after the login buffer is issued.
 */
function extractNickname(body: Buffer): string | undefined {
    let callbackData: unknown;
    try {
        callbackData = JSON.parse(body.toString('utf8'));
    } catch {
        return undefined;
    }

    if (!callbackData || typeof callbackData !== 'object') return undefined;
    let userInfo = (callbackData as Record<string, unknown>).user_info;
    if (typeof userInfo === 'string') {
        try {
            userInfo = JSON.parse(userInfo);
        } catch {
            return undefined;
        }
    }
    if (!userInfo || typeof userInfo !== 'object') return undefined;

    const info = userInfo as Record<string, unknown>;
    for (const key of ['nickname', 'nick_name', 'nickName']) {
        const value = info[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function extractUserInfoNickname(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const info = data as Record<string, unknown>;
    for (const key of ['nick_name', 'nickname', 'nickName']) {
        const value = info[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    // Some responses wrap the profile in user_info; the Go endpoint normally
    // returns nick_name at the top level, but accepting both keeps parsing
    // compatible with deployed response variants.
    let nested = info.user_info;
    if (typeof nested === 'string') {
        try {
            nested = JSON.parse(nested);
        } catch {
            nested = undefined;
        }
    }
    return extractUserInfoNickname(nested);
}

async function fetchUserInfo(
    cookies: Map<string, string>,
    openid: string,
    accessToken: string,
): Promise<unknown> {
    const timestamp = String(Date.now());
    const nonce = String(crypto.randomInt(0, 10000));
    const requestId = String(crypto.randomInt(1000, 10000));
    const signature = crypto.createHash('md5').update(`${timestamp}${nonce}`).digest('hex');
    const response = await request(USER_INFO_URL, cookies, {
        headers: {
            'Ual-Access-Access-Token': accessToken,
            'Ual-Access-Login-Type': '2',
            'Ual-Access-Openid': openid,
            'Ual-Access-Businessid': 'pc_yyb',
            'Ual-Access-Guid': 'web',
            'Ual-Access-Nonce': nonce,
            'Ual-Access-Requestid': requestId,
            'Ual-Access-Signature': signature,
            'Ual-Access-Timestamp': timestamp,
        },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Unable to obtain WeChat user info (HTTP ${response.status})`);
    }
    return JSON.parse(response.body.toString('utf8'));
}

export class WxLoginService {
    async createQrSession(): Promise<{ session: WxLoginSession; qr: Buffer }> {
        const cookies = new Map<string, string>();
        const params = new URLSearchParams({
            appid: OAUTH_APP_ID,
            redirect_uri: `${CALLBACK_URL}?login_type=WX`,
            response_type: 'code',
            scope: 'snsapi_login,snsapi_runtime_pcsdk',
            state: 'web',
            fast_login: '1',
            self_redirect: 'true',
        });
        const page = await request(`${QR_CONNECT_URL}?${params}`, cookies);
        if (page.status < 200 || page.status >= 300) throw new Error(`Unable to create WeChat QR session (HTTP ${page.status})`);
        const uuid = /\/connect\/qrcode\/([^"'>\s]+)/.exec(page.body.toString('utf8'))?.[1];
        if (!uuid) throw new Error('Unable to parse the WeChat QR session');
        const qr = await request(`${QR_IMAGE_BASE}${encodeURIComponent(uuid)}`, cookies);
        if (qr.status < 200 || qr.status >= 300) throw new Error(`Unable to download WeChat QR image (HTTP ${qr.status})`);
        return { session: { cookies, uuid }, qr: qr.body };
    }

    async poll(session: WxLoginSession): Promise<ScanStatus> {
        if (session.oauthCode) return 'authorized';
        const params = new URLSearchParams({ uuid: session.uuid, _: String(Date.now()) });
        const response = await request(`${QR_POLL_URL}?${params}`, session.cookies, {}, 35_000);
        if (response.status < 200 || response.status >= 300) throw new Error(`WeChat QR polling failed (HTTP ${response.status})`);
        const body = response.body.toString('utf8');
        const errcode = /wx_errcode\s*=\s*(\d+)/.exec(body)?.[1];
        if (errcode === '408') return 'waiting';
        if (errcode === '404') return 'scanned';
        if (errcode === '403') return 'cancelled';
        if (errcode === '402') return 'expired';
        if (errcode === '405') {
            const code = /wx_code\s*=\s*'([^']+)'/.exec(body)?.[1];
            if (!code) throw new Error('WeChat authorization response did not include a code');
            session.oauthCode = code;
            return 'authorized';
        }
        throw new Error('Unrecognized WeChat QR polling response');
    }

    async confirm(session: WxLoginSession): Promise<{ openid: string; loginBuffer: string; credentials: WxLoginCredentials }> {
        if (!session.oauthCode) throw new Error('Waiting for scan authorization');
        const params = new URLSearchParams({ login_type: 'WX', code: session.oauthCode, state: 'web' });
        const callback = await request(`${CALLBACK_URL}?${params}`, session.cookies);
        if (callback.status < 200 || callback.status >= 400) throw new Error(`WeChat authorization callback failed (HTTP ${callback.status})`);
        const nickname = extractNickname(callback.body);
        const credentials = credentialsFromCookies(session.cookies);
        const loginBuffer = await this.fetchLoginBuffer(credentials, session.cookies);
        let userInfoNickname: string | undefined;
        try {
            const userInfo = await fetchUserInfo(session.cookies, credentials.openid, credentials.accessToken);
            userInfoNickname = extractUserInfoNickname(userInfo);
        } catch {
            // The Go implementation treats profile lookup as best effort.
        }
        session.cookies.clear();
        credentials.nickname = userInfoNickname || nickname || credentials.nickname;
        applyCredentialsToSession(session, credentials, loginBuffer);
        session.nickname = credentials.nickname;
        return { openid: credentials.openid, loginBuffer, credentials };
    }

    async fetchLoginBuffer(credentials: WxLoginCredentials, cookies = new Map<string, string>()): Promise<string> {
        const openid = String(credentials.openid || '').trim();
        const accessToken = String(credentials.accessToken || '').trim();
        if (!openid || !accessToken) throw new Error('WeChat login credentials are incomplete');
        const payload = JSON.stringify({ extInfo: { listS: { unionid: { value: [openid] }, user_id: { value: [openid] }, access_token: { value: [accessToken] } }, listI: { user_type: { value: [0] } } } });
        const timestamp = String(Date.now());
        const nonce = String(crypto.randomInt(0, 10000));
        const requestCookies = new Map(cookies);
        if (!requestCookies.has('openid')) requestCookies.set('openid', openid);
        if (!requestCookies.has('accesstoken')) requestCookies.set('accesstoken', accessToken);
        if (credentials.refreshToken && !requestCookies.has('refreshtoken')) requestCookies.set('refreshtoken', credentials.refreshToken);
        const response = await request(LOGIN_BUFFER_URL, requestCookies, {
            method: 'POST', body: payload,
            headers: {
                'Content-Type': 'application/json',
                'Ual-Access-Businessid': LOGIN_BUSINESS_ID,
                'Ual-Access-Timestamp': timestamp,
                'Ual-Access-Nonce': nonce,
                'Ual-Access-Signature': signLoginPayload(payload, timestamp, nonce),
            },
        });
        if (response.status < 200 || response.status >= 300) throw new Error(`Unable to obtain WeChat login buffer (HTTP ${response.status})`);
        return parseLoginBufferBody(JSON.parse(response.body.toString('utf8')));
    }

    async refreshCredentials(credentials: WxLoginCredentials): Promise<WxLoginCredentials> {
        const refreshToken = String(credentials.refreshToken || '').trim();
        if (!refreshToken) throw new Error('missing refresh token');
        const payload = JSON.stringify({
            userInfo: {
                openId: credentials.openid,
                refreshToken,
                accessToken: credentials.accessToken,
                loginType: credentials.loginType || 'WX',
            },
        });
        const timestamp = String(Date.now());
        const nonce = String(crypto.randomInt(0, 10000));
        const cookies = new Map<string, string>();
        const response = await request(REFRESH_TOKEN_URL, cookies, {
            method: 'POST', body: payload,
            headers: {
                'Content-Type': 'application/json',
                'Ual-Access-Businessid': LOGIN_BUSINESS_ID,
                'Ual-Access-Timestamp': timestamp,
                'Ual-Access-Nonce': nonce,
                'Ual-Access-Signature': signLoginPayload(payload, timestamp, nonce),
            },
        });
        if (response.status < 200 || response.status >= 300) throw new Error(`Unable to refresh WeChat credentials (HTTP ${response.status})`);
        const data = JSON.parse(response.body.toString('utf8'));
        if (Number(data?.code) !== 0) {
            throw new RefreshRejectedError(Number(data?.code) || 0, String(data?.msg || ''));
        }
        const info = data?.user_info && typeof data.user_info === 'object' ? data.user_info : {};
        const accessToken = String(info.access_token || '').trim();
        if (!accessToken) throw new Error('refresh response missing access_token');
        const nextRefreshToken = String(info.refresh_token || '').trim() || refreshToken;
        const expiresIn = normalizeExpiresIn(info.expires_in);
        const now = Date.now();
        return {
            ...credentials,
            accessToken,
            refreshToken: nextRefreshToken,
            expiresIn,
            expiresAt: unixSeconds(now) + expiresIn,
            refreshTokenObservedAt: nextRefreshToken !== refreshToken ? unixSeconds(now) : credentials.refreshTokenObservedAt,
        };
    }

    async refreshLoginBuffer(credentials: WxLoginCredentials): Promise<WxLoginBufferResult> {
        const refreshed = await this.refreshCredentials(credentials);
        const loginBuffer = await this.fetchLoginBuffer(refreshed);
        return { loginBuffer, credentials: refreshed, refreshed: true };
    }

    async ensureLoginBuffer(loginBuffer: string, credentials?: WxLoginCredentials | null): Promise<WxLoginBufferResult> {
        const buffer = String(loginBuffer || '').trim();
        if (credentials && String(credentials.refreshToken || '').trim() && credentialsDueForRefresh(credentials)) {
            return this.refreshLoginBuffer(credentials);
        }
        if (buffer) {
            return { loginBuffer: buffer, credentials: credentials || { openid: '', accessToken: '' }, refreshed: false };
        }
        if (credentials && String(credentials.refreshToken || '').trim()) {
            return this.refreshLoginBuffer(credentials);
        }
        if (credentials && String(credentials.openid || '').trim() && String(credentials.accessToken || '').trim()) {
            const nextBuffer = await this.fetchLoginBuffer(credentials);
            return { loginBuffer: nextBuffer, credentials, refreshed: false };
        }
        throw new Error('WeChat login session has not been confirmed');
    }

    async issueCodeFromLoginBuffer(loginBuffer: string, appId: string, credentials?: WxLoginCredentials | null): Promise<WxLoginBufferResult & { code: string }> {
        const ensured = await this.ensureLoginBuffer(loginBuffer, credentials);
        let code = '';
        try {
            code = String(await getNativeWxLoginCode(ensured.loginBuffer, appId) || '').trim();
        } catch (error) {
            if (credentials && String(credentials.refreshToken || '').trim() && !ensured.refreshed) {
                const retried = await this.refreshLoginBuffer(credentials);
                code = String(await getNativeWxLoginCode(retried.loginBuffer, appId) || '').trim();
                if (!code) throw new Error('empty wx login code');
                return { ...retried, code };
            }
            if (credentials && String(credentials.openid || '').trim() && String(credentials.accessToken || '').trim()) {
                try {
                    const nextBuffer = await this.fetchLoginBuffer(credentials);
                    code = String(await getNativeWxLoginCode(nextBuffer, appId) || '').trim();
                    if (!code) throw new Error('empty wx login code');
                    return { loginBuffer: nextBuffer, credentials, refreshed: false, code };
                } catch {}
            }
            throw error;
        }
        if (!code && credentials && String(credentials.refreshToken || '').trim() && !ensured.refreshed) {
            const retried = await this.refreshLoginBuffer(credentials);
            code = String(await getNativeWxLoginCode(retried.loginBuffer, appId) || '').trim();
            if (!code) throw new Error('empty wx login code');
            return { ...retried, code };
        }
        if (!code && credentials && String(credentials.openid || '').trim() && String(credentials.accessToken || '').trim()) {
            try {
                const nextBuffer = await this.fetchLoginBuffer(credentials);
                code = String(await getNativeWxLoginCode(nextBuffer, appId) || '').trim();
                if (!code) throw new Error('empty wx login code');
                return { loginBuffer: nextBuffer, credentials, refreshed: false, code };
            } catch {}
        }
        if (!code) throw new Error('empty wx login code');
        return { ...ensured, code };
    }

    async issueCode(session: WxLoginSession, appId: string): Promise<string> {
        const result = await this.issueCodeFromLoginBuffer(session.loginBuffer || '', appId, {
            openid: session.openid || '',
            accessToken: session.accessToken || '',
            refreshToken: session.refreshToken,
            loginType: session.loginType,
            expiresAt: session.expiresAt,
            expiresIn: session.expiresIn,
            refreshTokenObservedAt: session.refreshTokenObservedAt,
        });
        applyCredentialsToSession(session, result.credentials, result.loginBuffer);
        return result.code;
    }

    destroy(session: WxLoginSession): void {
        session.cookies.clear();
        session.oauthCode = undefined;
        session.openid = undefined;
        session.nickname = undefined;
        session.loginBuffer = undefined;
        session.accessToken = undefined;
        session.refreshToken = undefined;
        session.loginType = undefined;
        session.expiresAt = undefined;
        session.expiresIn = undefined;
        session.refreshTokenObservedAt = undefined;
    }
}
