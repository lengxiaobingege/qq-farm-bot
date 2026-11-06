export {};
const stateMod: typeof import('./state') = require('./state');
const { types } = require('../proto');
const utilsMod = require('../utils');

const { S } = stateMod;

import type { ConnectionContext } from './types';

function getUserState() { return S.user; }
function getWsErrorState() { return { ...S.wsError }; }
function setWsErrorState(code: number, message: string): void {
    S.wsError = { code: Number(code) || 0, at: Date.now(), message: message || '' };
}
function clearWsErrorState(): void {
    S.wsError = { code: 0, at: 0, message: '' };
}

// 登录后获取用户设置

async function fetchUserSettings(): Promise<void> {
    try {
        const body = types.GetUserSettingsRequest.encode(types.GetUserSettingsRequest.create({})).finish();
        const codec = require('./codec');
        const { body: replyBody } = await codec.sendMsgAsync('gamepb.userpb.UserService', 'GetUserSettings', body);
        const reply = types.GetUserSettingsReply.decode(replyBody);
        if (reply.settings) {
            utilsMod.log('系统', `用户设置已同步`);
        }
    } catch {
        // 忽略获取失败
    }
}

export { getUserState, getWsErrorState, setWsErrorState, clearWsErrorState, fetchUserSettings };
