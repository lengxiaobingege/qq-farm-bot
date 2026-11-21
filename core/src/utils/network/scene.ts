export {};
/**
 * 游戏场景（global scene）切换与分享状态。
 *
 * 牧场是大农场场景（global_scene_id=2），所有牧场写操作（收获、喂养、催产、清理、放生……）
 * 都必须在「已切到场景 2」的前提下发出，否则服务端不认这些请求——
 * 典型表现是 HarvestRanch 回 1045211、FeedAnimal 回 1000020，请求字节却完全正确。
 * 这一层就是补齐「切场 / 回场」能力，供 services/ranch/transport.ts 的 inScene() 使用。
 */
const stateMod: typeof import('./state') = require('./state');
const codecMod: typeof import('./codec') = require('./codec');
const keepaliveMod: typeof import('./keepalive') = require('./keepalive');
const { types } = require('../proto');
const utilsMod = require('../utils');
const { util: protobufUtil } = require('protobufjs');

const { S } = stateMod;

/** 分享信息（按账号内存态，跨场景共用）：key 为分享 id 的十进制字符串 */
const shareInfoState = new Map<string, { shareCount: string; claimed: boolean; dateKey: string }>();

/**
 * 切换游戏场景并返回场景快照。
 * 回包里的 big_farm_scene_ext_data（场景 2）就是牧场家园格子数据。
 */
async function loginGameScene(globalSceneId: number): Promise<any> {
    const sceneId = Number(globalSceneId) || 1;
    const body = types.PlayerSceneLoginRequest.encode(
        types.PlayerSceneLoginRequest.create({ global_scene_id: sceneId }),
    ).finish();
    const response = await codecMod.sendMsgAsync(
        'gamepb.globalscenepb.GlobalSceneService', 'PlayerSceneLogin', Buffer.from(body));
    const scene = types.PlayerSceneLoginReply.decode(response.body);
    const data = sceneId === 2 ? scene.big_farm_scene_ext_data : scene.farm_scene_ext_data;
    if (Number(scene.global_scene_id) !== sceneId || !data || !data.length) {
        throw new Error(`游戏场景 ${sceneId} 登录回包不完整`);
    }
    S.user.globalSceneId = sceneId;
    const serverTime = utilsMod.toNum(scene.server_time);
    if (serverTime > 0) utilsMod.syncServerTime(serverTime);
    return scene;
}

/**
 * 场景状态已经不可信（切场/回场途中掉线等）：主动终结连接，让上层重新登录。
 * 宁可直接重登，也不要在错误场景里继续发写请求——那只会写坏状态。
 */
function invalidateGameScene(reason = '游戏场景状态未知，需要重新登录'): void {
    const context = S.connection;
    if (!context) return;
    keepaliveMod.finalizeConnection(context, { source: 'game_scene_unknown', reason });
    try { (context.socket as any).terminate(); } catch { /* 已经断开就忽略 */ }
}

function applyShareInfos(infos: Record<string, any>): void {
    const dateKey = utilsMod.formatDateKeyInTimeZone(utilsMod.getServerTimeSec() * 1000, 'Asia/Shanghai');
    for (const [key, info] of Object.entries(infos || {})) {
        if (!info) continue;
        const id = /^\d+$/.test(key) ? key : protobufUtil.longFromHash(key, false).toString();
        // ShareInfo 存在两种字段命名（{status, count} 与 {share_count, is_claimed}），
        // 两种解码结果都接受，避免因字段名差异把「已领取」判反。
        const shareCount = info.share_count !== undefined ? info.share_count : info.status;
        const claimed = info.is_claimed !== undefined ? info.is_claimed : info.count;
        shareInfoState.set(id, {
            shareCount: utilsMod.toNum(shareCount).toString(),
            claimed: !!claimed,
            dateKey,
        });
    }
}

function getDailyShareInfo(id: number | string): any {
    const dateKey = utilsMod.formatDateKeyInTimeZone(utilsMod.getServerTimeSec() * 1000, 'Asia/Shanghai');
    const state = shareInfoState.get(String(id));
    return state && state.dateKey === dateKey
        ? { ...state }
        : { shareCount: '0', claimed: false, dateKey };
}

/** 新连接建立时清空场景/分享的内存态，避免沿用上一个账号的数据。 */
function resetSceneState(): void {
    S.user.globalSceneId = 1;
    S.user.unlockedSceneIds = [];
    shareInfoState.clear();
}

export { applyShareInfos, getDailyShareInfo, invalidateGameScene, loginGameScene, resetSceneState };
