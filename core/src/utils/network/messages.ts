export {};
const stateMod: typeof import('./state') = require('./state');
const typesMod: typeof import('./types') = require('./types');
const sessionMod: typeof import('./session') = require('./session');
const keepaliveMod: typeof import('./keepalive') = require('./keepalive');
const { Buffer } = require('node:buffer');
const { types } = require('../proto');
const statusMod = require('../../services/status');
const statsMod = require('../../services/stats');
const forecastMod = require('../../services/level-forecast');
const utilsMod = require('../utils');
const ignoreErrorMod = require('../ignore-error');
const { S } = stateMod;

import type { ConnectionContext } from './types';

function hasOwn(obj: any, key: string): boolean {
    return !!obj && Object.hasOwn(obj, key);
}

// ============ 消息处理 ============
function handleMessage(data: Buffer): void {
    try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = types.GateMessage.decode(buf);
        S.lastInboundMono = S.now();
        const meta = msg.meta;
        if (!meta) return;

        if (meta.server_seq) {
            const seq = utilsMod.toNum(meta.server_seq);
            if (seq > S.serverSeq) S.serverSeq = seq;
        }

        const msgType = meta.message_type;

        // Notify
        if (msgType === 3) {
            handleNotify(msg);
            return;
        }

        // Response
        if (msgType === 2) {
            const errorCode = utilsMod.toNum(meta.error_code);
            const clientSeqVal = utilsMod.toNum(meta.client_seq);

            const pending = S.pending.get(clientSeqVal);
            const expectedError = !!pending && pending.expectedErrorCodes.has(errorCode);
            if (errorCode !== 0 && !expectedError) {
                utilsMod.logWarn('错误', `${meta.service_name}.${meta.method_name} code=${errorCode} ${meta.error_message || ''}`);
            }

            if (pending) {
                S.pending.delete(clientSeqVal);
                if (errorCode !== 0) {
                    pending.callback(new typesMod.GatewayError(meta));
                } else {
                    if ((meta.service_name === 'gamepb.plantpb.PlantService' && meta.method_name !== 'AllLands')
                        || (meta.service_name === 'gamepb.itempb.ItemService' && meta.method_name === 'Use')) {
                        forecastMod.invalidateLandForecast();
                    }
                    pending.callback(null, msg.body, meta);
                }
                
            }
        }
    } catch (err: any) {
        utilsMod.logWarn('解码', err.message);
    }
}

function handleNotify(msg: any): void {
    if (!msg.body || msg.body.length === 0) return;
    try {
        const event = types.EventMessage.decode(msg.body);
        const type = event.message_type || '';
        const eventBody = event.body;

        // 被踢下线
        if (type.includes('Kickout')) {
            utilsMod.log('推送', `被踢下线! ${type}`);
            try {
                const notify = types.KickoutNotify.decode(eventBody);
                const reasonCode = utilsMod.toNum(notify.reason);
                const diagnostics = keepaliveMod.getConnectionDiagnostics(S.connection);
                utilsMod.log('推送', `原因: ${notify.reason_message || '未知'} (${reasonCode})`, { reasonCode, diagnostics });
                S.events.emit('kickout', {
                    type,
                    reason: notify.reason_message || '未知',
                    reasonCode,
                    diagnostics,
                });
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:585', err); }
            return;
        }

        // 土地状态变化
        if (type.includes('LandsNotify')) {
            try {
                const notify = types.LandsNotify.decode(eventBody);
                const hostGid = utilsMod.toNum(notify.host_gid);
                const lands = notify.lands || [];
                if (lands.length > 0) {
                    if (hostGid === S.user.gid || hostGid === 0) {
                        forecastMod.invalidateLandForecast();
                        S.events.emit('landsChanged', lands);
                    }
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:601', err); }
            return;
        }

        // 青蛙等农场级社交事件变化。与乌云不同，它不附着在 LandInfo 上。
        if (type.includes('FarmSocialEventsNotify')) {
            try {
                const notify = types.FarmSocialEventsNotify.decode(eventBody);
                const hostGid = utilsMod.toNum(notify.host_gid);
                if (hostGid === S.user.gid || hostGid === 0) {
                    S.events.emit('farmSocialEventsChanged', notify.social_events || []);
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:613', err); }
            return;
        }

        // 特殊天气变化。通知携带天气所属农场 GID；空 weather 表示天气结束。
        if (type.includes('WeatherChangeNotify')) {
            try {
                const notify = types.WeatherChangeNotify.decode(eventBody);
                S.events.emit('weatherChanged', {
                    hostGid: utilsMod.toNum(notify.host_gid),
                    weather: notify.weather || null,
                });
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:625', err); }
            return;
        }

        // 护主犬“同气连枝”主人侧待拾取礼包数量。
        if (type.includes('PendingGiftCountNotify')) {
            try {
                const notify = types.PendingGiftCountNotify.decode(eventBody);
                S.events.emit('dogSkillGiftPending', Math.max(0, utilsMod.toNum(notify.count)));
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:634', err); }
            return;
        }

        // 守护日志新增通知的真实事件体为空，仅作为失效信号使用。
        if (type.includes('NewProtectLogNotify')) {
            S.events.emit('dogProtectLogChanged');
            return;
        }

        // 物品变化通知
        if (type.includes('ItemNotify')) {
            try {
                const notify = types.ItemNotify.decode(eventBody);
                const items = notify.items || [];
                for (const itemChg of items) {
                    const item = itemChg.item;
                    if (!item) continue;
                    const id = utilsMod.toNum(item.id);
                    const count = utilsMod.toNum(item.count);
                    const delta = utilsMod.toNum(itemChg.delta);

                    if (id === 1101) {
                        if (count > 0) S.user.exp = count;
                        else if (delta !== 0) S.user.exp = Math.max(0, Number(S.user.exp || 0) + delta);
                        statusMod.updateStatusLevel(S.user.level, S.user.exp);
                    } else if (id === 1 || id === 1001) {
                        if (count > 0) {
                            S.user.gold = count;
                        } else if (delta !== 0) {
                            S.user.gold = Math.max(0, Number(S.user.gold || 0) + delta);
                        }
                        statusMod.updateStatusGold(S.user.gold);
                    } else if (id === 1002) {
                        if (count > 0) {
                            S.user.coupon = count;
                        } else if (delta !== 0) {
                            S.user.coupon = Math.max(0, Number(S.user.coupon || 0) + delta);
                        }
                    } else if (id === 1005) {
                        if (count > 0) {
                            S.user.goldBean = count;
                        } else if (delta !== 0) {
                            S.user.goldBean = Math.max(0, Number(S.user.goldBean || 0) + delta);
                        }
                    }
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:681', err); }
            return;
        }

        // 基本信息变化
        if (type.includes('BasicNotify')) {
            try {
                const notify = types.BasicNotify.decode(eventBody);
                if (notify.basic) {
                    const oldLevel = S.user.level;
                    if (hasOwn(notify.basic, 'level')) {
                        const nextLevel = utilsMod.toNum(notify.basic.level);
                        if (Number.isFinite(nextLevel) && nextLevel > 0) S.user.level = nextLevel;
                    }
                    let shouldUpdateGoldView = false;
                    if (hasOwn(notify.basic, 'gold')) {
                        const nextGold = utilsMod.toNum(notify.basic.gold);
                        if (Number.isFinite(nextGold) && nextGold >= 0) {
                            S.user.gold = nextGold;
                            shouldUpdateGoldView = true;
                        }
                    }
                    if (hasOwn(notify.basic, 'exp')) {
                        const exp = utilsMod.toNum(notify.basic.exp);
                        if (Number.isFinite(exp) && exp >= 0) {
                            S.user.exp = exp;
                            statusMod.updateStatusLevel(S.user.level, exp);
                        }
                    }
                    if (shouldUpdateGoldView) {
                        statusMod.updateStatusGold(S.user.gold);
                    }
                    if (S.user.level !== oldLevel) {
                        statsMod.recordOperation('levelUp', 1);
                    }
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:717', err); }
            return;
        }

        // 好友申请通知
        if (type.includes('FriendApplicationReceivedNotify')) {
            try {
                const notify = types.FriendApplicationReceivedNotify.decode(eventBody);
                const applications = notify.applications || [];
                if (applications.length > 0) {
                    S.events.emit('friendApplicationReceived', applications);
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:729', err); }
            return;
        }

        // 好友添加成功通知
        if (type.includes('FriendAddedNotify')) {
            try {
                const notify = types.FriendAddedNotify.decode(eventBody);
                const friends = notify.friends || [];
                if (friends.length > 0) {
                    const names = friends.map((f: any) => f.name || f.remark || `GID:${utilsMod.toNum(f.gid)}`).join(', ');
                    utilsMod.log('好友', `新好友: ${names}`);
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:742', err); }
            return;
        }

        // 商品解锁通知
        if (type.includes('GoodsUnlockNotify')) {
            try {
                const notify = types.GoodsUnlockNotify.decode(eventBody);
                const goods = notify.goods_list || [];
                if (goods.length > 0) {
                    S.events.emit('goodsUnlockNotify', goods);
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:754', err); }
            return;
        }

        // 任务状态变化通知
        if (type.includes('TaskInfoNotify')) {
            try {
                const notify = types.TaskInfoNotify.decode(eventBody);
                if (notify.task_info) {
                    S.events.emit('taskInfoNotify', notify.task_info);
                }
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:765', err); }
            return;
        }

        // 商城需求通知
        if (type.includes('NeedNotify')) {
            try {
                const notify = types.NeedNotify.decode(eventBody);
                S.events.emit('mallNeedNotify', notify);
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:774', err); }
            return;
        }

        // 商品变更通知
        if (type.includes('ProductsHasChangedNotify')) {
            try {
                const notify = types.ProductsHasChangedNotify.decode(eventBody);
                S.events.emit('productsChanged', notify);
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:783', err); }
            return;
        }

        // 活动变更通知
        if (type.includes('ActiviesChangeNotify')) {
            try {
                const notify = types.ActiviesChangeNotify.decode(eventBody);
                S.events.emit('activitiesChanged', notify);
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:792', err); }
            return;
        }

        // 头像框红点通知
        if (type.includes('AvatarFrameRedDotNotify')) {
            try {
                S.events.emit('avatarFrameRedDot');
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:800', err); }
            return;
        }

        // 图鉴奖励红点通知
        if (type.includes('IllustratedRewardRedDotNotifyV2')) {
            try {
                S.events.emit('illustratedRewardRedDot');
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:808', err); }
            return;
        }

        // 充值信息变更通知
        if (type.includes('RechargeInfoNotify')) {
            try {
                const notify = types.RechargeInfoNotify.decode(eventBody);
                S.events.emit('rechargeInfoChanged', notify);
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:817', err); }
            return;
        }

        // 公告板变更通知
        if (type.includes('BulletinListChangedNTF')) {
            try {
                const notify = types.BulletinListChangedNTF.decode(eventBody);
                S.events.emit('bulletinListChanged', notify);
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:826', err); }
            return;
        }

        // 皮肤变更通知
        if (type.includes('SkinChangeNotify')) {
            try {
                const notify = types.SkinChangeNotify.decode(eventBody);
                S.events.emit('skinChanged', notify);
            } catch (err) { ignoreErrorMod.ignoreError('core/src/utils/network.ts:835', err); }
            
        }
    } catch (e: any) {
        utilsMod.logWarn('推送', `解码失败: ${e.message}`);
    }
}

export { handleMessage, handleNotify };
