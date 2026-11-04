import type { NextFunction, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const crypto = require('node:crypto');
const store = require('../../models/store');
const { normalizeAccountRef, resolveAccountId } = require('../../services/account-resolver');

interface AuthenticatedRequest extends Request {
    adminToken?: string;
}

/**
 * 仅当 TCP 对端是可信代理时，才采信客户端提供的来源请求头。
 * 默认信任非回环的 RFC1918 私网地址（CLB / 反向代理的真实内网 IP）；
 * 回环直连与公网直连一律不采信客户端头，避免伪造 XFF 绕过登录限流。
 * 可通过 TRUSTED_PROXY_IPS（逗号分隔）覆盖为显式的代理 IP 白名单。
 */
const TRUSTED_PROXY_IPS: string[] = String(process.env.TRUSTED_PROXY_IPS || '')
    .split(',').map(item => item.trim()).filter(Boolean);

function normalizeIp(value: unknown): string {
    return String(value == null ? '' : value).trim().replace(/^::ffff:/, '').toLowerCase();
}

function isLoopback(ip: string): boolean {
    return ip === '::1' || ip === 'localhost' || ip.startsWith('127.');
}

function isProxyAddress(ip: string): boolean {
    if (!ip || isLoopback(ip)) return false; // 回环直连不算代理
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    const match = /^172\.(\d+)\./.exec(ip);
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // IPv6 ULA
    return false;
}

function isTrustedProxy(ip: string): boolean {
    if (!ip) return false;
    if (TRUSTED_PROXY_IPS.length) return TRUSTED_PROXY_IPS.includes(ip);
    return isProxyAddress(ip);
}

function getClientIp(req: Request): string {
    const socketIp = normalizeIp(req.socket?.remoteAddress);
    if (!isTrustedProxy(socketIp)) return socketIp || 'unknown';

    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const chain = String(forwarded).split(',').map(normalizeIp).filter(Boolean);
        // 从右往左取第一个非可信代理地址：最靠近代理的一跳才是真实客户端，
        // 客户端伪造的值位于链的左侧，不会被采信。
        for (let i = chain.length - 1; i >= 0; i -= 1) {
            if (!isTrustedProxy(chain[i])) return chain[i];
        }
        if (chain.length) return chain[chain.length - 1];
    }
    const realIp = normalizeIp(req.headers['x-real-ip']);
    if (realIp && !isTrustedProxy(realIp)) return realIp;
    const cfIp = normalizeIp(req.headers['cf-connecting-ip']);
    if (cfIp && !isTrustedProxy(cfIp)) return cfIp;
    return socketIp || 'unknown';
}

const issueToken = (): string => crypto.randomBytes(24).toString('hex');

function createAuthRequired(ctx: AdminContext) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const token = String(req.headers['x-admin-token'] || '');
        if (!token || !ctx.tokens.has(token)) {
            res.status(401).json({ ok: false, error: 'Unauthorized' });
            return;
        }
        req.adminToken = token;
        next();
    };
}

function getAccountList(ctx: AdminContext): any[] {
    try {
        if (ctx.provider && typeof ctx.provider.getAccounts === 'function') {
            const data = ctx.provider.getAccounts();
            if (Array.isArray(data?.accounts)) return data.accounts;
        }
    } catch {
        // Fall back to persistent storage.
    }
    const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
    return Array.isArray(data.accounts) ? data.accounts : [];
}

function getAccountIds(ctx: AdminContext): string[] {
    return getAccountList(ctx).map((account: any) => String(account.id || '')).filter(Boolean);
}

const isSoftRuntimeError = (err: any): boolean => {
    const message = String(typeof err === 'string' ? err : err?.message || '');
    return message === '账号未运行' || message === 'API Timeout';
};

function isGatewayProtocolError(err: any): boolean {
    const message = String(typeof err === 'string' ? err : err?.message || '').trim();
    return String(err?.name || '') === 'GatewayError'
        || typeof err?.errorMessage === 'string'
        || typeof err?.error_message === 'string'
        || /^(?:[\w-]+\.)+[\w-]+(?:\s+(?:\S.*?)??)?\bcode=\d+(?:\s|$)/.test(message);
}

function getProtocolErrorMessage(err: any): string {
    const direct = String(err?.errorMessage || err?.error_message || '').trim();
    if (direct) return direct;

    const message = String(typeof err === 'string' ? err : err?.message || '').trim();
    if (!isGatewayProtocolError(err)) return '';
    return message.match(/\bcode=\d+\b\s*(.*)$/)?.[1]?.trim() || '';
}

function handleApiError(res: Response, err: any): void {
    const protocolMessage = getProtocolErrorMessage(err);
    const payload: any = {
        ok: false,
        error: protocolMessage || (typeof err === 'string' ? err : err?.message) || 'Unknown error',
    };
    if (protocolMessage) payload.errorMessage = protocolMessage;
    const errorCode = Number(err?.code);
    if (Number.isFinite(errorCode) && errorCode !== 0) payload.errorCode = errorCode;
    if (isSoftRuntimeError(err) || isGatewayProtocolError(err)) {
        res.json(payload);
        return;
    }
    res.status(500).json(payload);
}

function resolveAccId(ctx: AdminContext, rawRef: any): string {
    const input = normalizeAccountRef(rawRef);
    if (!input) return '';
    if (ctx.provider && typeof ctx.provider.resolveAccountId === 'function') {
        const resolvedByProvider = normalizeAccountRef(ctx.provider.resolveAccountId(input));
        if (resolvedByProvider) return resolvedByProvider;
    }
    return resolveAccountId(getAccountList(ctx), input) || input;
}

function getAccId(ctx: AdminContext, req: Request): string {
    return resolveAccId(ctx, req.headers['x-account-id']);
}

function buildKnownFriendGidSettings(accountId: string): {
    knownFriendGids: any[];
    knownFriendGidSyncCooldownSec: number;
    friendsListCacheTtlSec: number;
} {
    return {
        knownFriendGids: store.getKnownFriendGids ? store.getKnownFriendGids(accountId) : [],
        knownFriendGidSyncCooldownSec: store.getKnownFriendGidSyncCooldownSec
            ? store.getKnownFriendGidSyncCooldownSec(accountId)
            : 600,
        friendsListCacheTtlSec: store.getFriendsListCacheTtlSec
            ? store.getFriendsListCacheTtlSec(accountId)
            : 60,
    };
}

module.exports = {
    getClientIp,
    issueToken,
    createAuthRequired,
    getAccountList,
    getAccountIds,
    isSoftRuntimeError,
    isGatewayProtocolError,
    getProtocolErrorMessage,
    handleApiError,
    resolveAccId,
    getAccId,
    buildKnownFriendGidSettings,
};
