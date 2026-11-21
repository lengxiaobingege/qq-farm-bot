import type { ActivityWindow, SellConditionContext } from '../config/sell-conditions';

export {};

const { sendMsgAsync, networkEvents } = require('../utils/network');
const { types } = require('../utils/proto');
const { getServerTimeSec, logWarn, toNum } = require('../utils/utils');

const CACHE_TTL_MS = 5 * 60 * 1000;
const RETRY_LOG_INTERVAL_MS = 60 * 1000;

let activityWindows: ReadonlyMap<string, ActivityWindow> = new Map();
let loadedAt = 0;
let pendingRefresh: Promise<ReadonlyMap<string, ActivityWindow>> | null = null;
let lastFailureLogAt = 0;

function decodeActivityWindows(reply: any): ReadonlyMap<string, ActivityWindow> {
    const rows: any[] = Array.isArray(reply?.activity_windows) ? reply.activity_windows : [];
    const metas = decodeActivityMeta(reply);
    const windows = new Map<string, ActivityWindow>();
    for (const row of rows) {
        const id = String(toNum(row?.id) || '').trim();
        if (!id) continue;
        const meta = metas.get(id);
        windows.set(id, {
            id,
            name: String(row?.name || ''),
            beginTime: toNum(row?.begin_time),
            endTime: toNum(row?.end_time),
            ...(meta ? { type: meta.type, groupId: meta.groupId, rules: meta.rules, uid: meta.uid } : {}),
        });
    }
    return windows;
}

/**
 * ActivityListReply.activities 携带每个活动的 ActivityContent（type / group_id / extra），
 * 而 activity_windows 只有时间窗口。活动目录要判断玩法归属、拿到说明文本，就得读前者。
 * 注意 activities 是树（children 嵌套），要递归展开。
 */
function decodeActivityMeta(reply: any): Map<string, { type: number; groupId: string; rules: string[]; uid: string }> {
    const metas = new Map<string, { type: number; groupId: string; rules: string[]; uid: string }>();
    const walk = (node: any): void => {
        const head = node?.activity;
        const id = String(toNum(head?.activity_id) || '').trim();
        if (id) {
            const extra = decodeActivityExtra(head?.extra);
            metas.set(id, {
                type: toNum(head?.type),
                groupId: String(toNum(head?.group_id) || ''),
                rules: extra.rules,
                uid: extra.uid,
            });
        }
        const children = Array.isArray(node?.children) ? node.children : [];
        for (const child of children) walk(child);
    };
    const roots = Array.isArray(reply?.activities) ? reply.activities : [];
    for (const root of roots) walk(root);
    return metas;
}

/**
 * ActivityContent.extra 是 UTF-8 JSON：tips.txt 存活动说明，uid 标识客户端活动界面。
 * uid 是区分「这个活动长在哪个场景」的唯一可用信号（协议里没有场景字段）。
 */
function decodeActivityExtra(extra: any): { rules: string[]; uid: string } {
    try {
        const raw = Buffer.from(extra || []).toString('utf8').trim();
        if (!raw) return { rules: [], uid: '' };
        const parsed = JSON.parse(raw);
        const txt = parsed?.tips?.txt;
        const rules = Array.isArray(txt)
            ? txt
                .filter((value: any) => typeof value === 'string')
                .map((value: string) => value.replace(/<[^>]+>/g, '').trim())
                .filter(Boolean)
            : [];
        return { rules, uid: typeof parsed?.uid === 'string' ? parsed.uid.trim() : '' };
    } catch {
        return { rules: [], uid: '' };
    }
}

async function refreshActivityWindows(): Promise<ReadonlyMap<string, ActivityWindow>> {
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = (async () => {
        const body: Uint8Array = types.ActivityListRequest.encode(
            types.ActivityListRequest.create({})
        ).finish();
        const { body: replyBody } = await sendMsgAsync(
            'gamepb.activitypb.ActivityService',
            'List',
            body
        );
        const reply = types.ActivityListReply.decode(replyBody);
        const nextWindows = decodeActivityWindows(reply);
        if (nextWindows.size === 0) {
            throw new Error('活动列表回包未包含时间配置');
        }
        activityWindows = nextWindows;
        loadedAt = Date.now();
        return activityWindows;
    })();
    try {
        return await pendingRefresh;
    } finally {
        pendingRefresh = null;
    }
}

async function getActivityWindows(): Promise<ReadonlyArray<ActivityWindow>> {
    const fresh = loadedAt > 0 && Date.now() - loadedAt < CACHE_TTL_MS;
    if (!fresh) {
        try {
            await refreshActivityWindows();
        } catch (error) {
            if (activityWindows.size === 0) throw error;
        }
    }
    return Array.from(activityWindows.values(), window => ({ ...window }));
}

function invalidateActivityWindows(): void {
    loadedAt = 0;
    groupExtraCache.clear();
}

/**
 * 活动说明与界面标识只在 GetGroup 的 ActivityContent.extra 里。
 * ActivityList 的 activities 树只覆盖有玩家进度的活动，牧场活动通常不在其中，
 * 所以按分组单独取一次内容，并缓存 10 分钟（活动说明不会中途变化）。
 */
const GROUP_EXTRA_TTL_MS = 10 * 60 * 1000;
const groupExtraCache = new Map<string, { at: number; value: { uid: string; rules: string[] } }>();

async function getActivityGroupExtra(groupId: string): Promise<{ uid: string; rules: string[] }> {
    const id = String(groupId || '').trim();
    if (!id) return { uid: '', rules: [] };
    const cached = groupExtraCache.get(id);
    if (cached && Date.now() - cached.at < GROUP_EXTRA_TTL_MS)
        return cached.value;
    const body: Uint8Array = types.GetGroupRequest.encode(types.GetGroupRequest.create({ group_id: id })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', body);
    const reply = types.GetGroupReply.decode(replyBody);
    const value = decodeActivityExtra(reply?.group?.activity?.extra);
    groupExtraCache.set(id, { at: Date.now(), value });
    return value;
}

async function getSellConditionContext(): Promise<SellConditionContext> {
    const fresh = loadedAt > 0 && Date.now() - loadedAt < CACHE_TTL_MS;
    if (!fresh) {
        try {
            await refreshActivityWindows();
        } catch (error: any) {
            const now = Date.now();
            if (now - lastFailureLogAt >= RETRY_LOG_INTERVAL_MS) {
                lastFailureLogAt = now;
                logWarn('仓库', `活动时间同步失败: ${error?.message || error}`);
            }
        }
    }
    return {
        nowSec: getServerTimeSec(),
        activityWindows,
        activityWindowsLoaded: loadedAt > 0,
    };
}

networkEvents.on('activitiesChanged', invalidateActivityWindows);
networkEvents.on('disconnected', invalidateActivityWindows);

module.exports = {
    refreshActivityWindows,
    getActivityWindows,
    getActivityGroupExtra,
    invalidateActivityWindows,
    getSellConditionContext,
    // 供测试直接验证解码，不依赖网络
    decodeActivityWindows,
    decodeActivityExtra,
};
