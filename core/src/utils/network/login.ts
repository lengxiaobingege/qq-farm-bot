export {};
const stateMod: typeof import('./state') = require('./state');
const sessionMod: typeof import('./session') = require('./session');
const codecMod: typeof import('./codec') = require('./codec');
const keepaliveMod: typeof import('./keepalive') = require('./keepalive');
const { Buffer } = require('node:buffer');
const { types } = require('../proto');
const profileMod = require('../client-profile');
const aceMod = require('../../services/ace');
const utilsMod = require('../utils');
const ignoreErrorMod = require('../ignore-error');
const statusMod = require('../../services/status');
const cryptoWasm = require('../crypto-wasm');
const { S } = stateMod;

import type { ConnectionContext } from './types';

// ============ 登录 ============
// QQ and WeChat 1.15 both authenticate the player before entering a farm scene.
// Historical versions retain their single-stage Login wire layout.
function usesPlayerSceneLogin(clientVersion = profileMod.getClientVersion()): boolean {
    const version = /^(\d+)\.(\d+)/.exec(clientVersion);
    return !!version && (Number(version[1]) > 1 || (Number(version[1]) === 1 && Number(version[2]) >= 15));
}

function buildLoginBody(clientVersion = profileMod.getClientVersion()): Buffer {
    const modern = usesPlayerSceneLogin(clientVersion);
    const requestType = modern ? types.PlayerLoginRequest : types.LoginRequest;
    return Buffer.from(requestType.encode(requestType.create({
        sharer_id: utilsMod.toLong(0),
        sharer_open_id: '',
        device_info: profileMod.getLoginDeviceInfo(clientVersion),
        share_cfg_id: utilsMod.toLong(0),
        // A standalone WeChat Code does not supply its entry-dependent launch scene.
        scene_id: profileMod.isWechatPlatform() ? undefined : '1234567',
        report_data: {
            ...(modern ? {} : { callback: '', cd_extend_info: '', click_id: '', clue_token: '', req_id: '', trackid: '' }),
            minigame_channel: profileMod.isWechatPlatform() ? 'other' : 'other-qq',
            minigame_platid: 2,
        },
        ...(modern ? { share_key: '', game_scene_id: 1 } : { extra: Buffer.alloc(0) }),
    })).finish());
}

async function sendLogin(context: ConnectionContext, onLoginSuccess?: () => void): Promise<void> {
    const modern = usesPlayerSceneLogin(context.clientVersion);
    const body = buildLoginBody(context.clientVersion);
    await codecMod.sendMsg(context, 'gamepb.userpb.UserService', modern ? 'PlayerLogin' : 'Login', body, {
        expectedErrorCodes: new Set(),
        // 登录不走排队器（此时还没 online），按保命流量记账。
        requestClass: 'critical',
        callback: async (err, bodyBytes, _meta) => {
        if (!stateMod.isCurrentConnection(context)) return;
        if (err) {
            utilsMod.log('登录', `失败: ${err.message}`);
            if (err.message.includes('code=')) {
                utilsMod.log('系统', '账号验证失败，即将停止运行...');
                S.scheduler.setTimeoutTask('login_error_exit', 1000, () => process.exit(0));
            }
            return;
        }

        let reply: any;
        try {
            reply = (modern ? types.PlayerLoginReply : types.LoginReply).decode(bodyBytes!);
        } catch (e: any) {
            utilsMod.log('登录', `解码失败: ${e.message}`);
            return;
        }
        if (!reply.basic) {
            utilsMod.log('登录', '失败: 登录响应缺少账号信息');
            return;
        }

        sessionMod.clearWsErrorState();
        S.user.gid = utilsMod.toNum(reply.basic.gid);
        S.user.name = reply.basic.name || '未知';
        S.user.level = utilsMod.toNum(reply.basic.level);
        S.user.gold = utilsMod.toNum(reply.basic.gold);
        S.user.exp = utilsMod.toNum(reply.basic.exp);
        S.user.openId = String(reply.basic.open_id || '').trim();
        S.user.avatarUrl = String(reply.basic.avatar_url || '').trim();

        statusMod.updateStatusFromLogin({
            name: S.user.name,
            level: S.user.level,
            gold: S.user.gold,
            exp: S.user.exp,
            avatarUrl: S.user.avatarUrl,
        });

        utilsMod.log('系统', `登录成功: ${S.user.name} (Lv${S.user.level})`);

        if (context.loginInitialized) return;
        context.loginInitialized = true;

        console.warn('');
        console.warn('========== 登录成功 ==========');
        console.warn(`  GID:    ${S.user.gid}`);
        console.warn(`  昵称:   ${S.user.name}`);
        console.warn(`  等级:   ${S.user.level}`);
        console.warn(`  金币:   ${S.user.gold}`);
        if (reply.time_now_millis) {
            utilsMod.syncServerTime(utilsMod.toNum(reply.time_now_millis));
            console.warn(`  时间:   ${new Date(utilsMod.toNum(reply.time_now_millis)).toLocaleString()}`);
        }
        console.warn('===============================');
        console.warn('');

        try {
            if (S.user.openId) {
                await cryptoWasm.bindUser(S.user.openId);
                const initTokenLength = S.gatewayTokens.stageInitToken(cryptoWasm.getEncryptedInitInfo());
                if (initTokenLength > 0) {
                    utilsMod.log('ACE', `TSDK 初始化凭据已就绪: ${initTokenLength} 字符，将随下一条请求发送`);
                }
            }
            if (!stateMod.isCurrentConnection(context)) return;
            S.scheduler.clear('login_timeout');
            context.phase = 'online';
            context.onlineMono = S.now();
            aceMod.startAceRuntime((service: string, method: string, body: Buffer, timeoutMs?: number) => (
                codecMod.sendMsgAsync(service, method, body, { timeoutMs, priority: 'high', criticalLane: 'ace' })
            ));
            keepaliveMod.startHeartbeat(context);
            // 登录引导阶段串行完成普通请求，避免和后续活动、背包初始化同时挤入 Gateway。
            await sessionMod.fetchUserSettings();
            if (!stateMod.isCurrentConnection(context)) return;
            if (modern) {
                const sceneBody = types.PlayerSceneLoginRequest.encode({ global_scene_id: 1 }).finish();
                const sceneResponse = await codecMod.sendMsgAsync('gamepb.globalscenepb.GlobalSceneService', 'PlayerSceneLogin', sceneBody);
                if (!stateMod.isCurrentConnection(context)) return;
                const scene = types.PlayerSceneLoginReply.decode(sceneResponse.body);
                if (scene.global_scene_id !== 1 || !scene.farm_scene_ext_data?.length) {
                    throw new Error('农场场景登录回包不完整');
                }
            }
            if (onLoginSuccess) await onLoginSuccess();
        } catch (e: any) {
            utilsMod.logWarn('登录', `登录初始化失败: ${e.message}`);
            keepaliveMod.finalizeConnection(context, {
                source: 'login_init_failed',
                reason: e.message,
            });
            try { (context.socket as any).terminate(); } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:970', err); }
        }
        },
    });
}

export { usesPlayerSceneLogin, buildLoginBody, sendLogin };
