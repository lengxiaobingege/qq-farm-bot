export {};
/**
 * 奶茶结算期提醒
 *
 * - 进入结算期后每天最多提醒一次，内容按剩余时间分级：
 *   剩余 >6 小时 → 「结算期进行中，剩余约 N 天」
 *   剩余 ≤6 小时 → 「即将结束，剩余约 N 小时」（加急，提示立即兑换）
 * - 已提醒日期持久化到 data/activity-remind-state.json，进程重启不会重复推送
 * - 推送本身由调度层交给主进程执行（worker 内不能直连推送配置），
 *   未配置推送渠道时主进程侧自动跳过
 */

import type { AutoPushMessage } from './shared';

const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('../json-db');
const { toNum } = require('../../utils/utils');

/** 剩余时间不足该值时切换到「即将结束」加急提醒 */
const END_SOON_SEC = 6 * 3600;

function dataDir(): string {
    return process.env.FARM_DATA_DIR || path.join(__dirname, '../../../data');
}

function stateFilePath(): string {
    return path.join(dataDir(), 'activity-remind-state.json');
}

function loadState(): Record<string, any> {
    try {
        const value = readJsonFile(stateFilePath(), () => ({}));
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function saveState(state: Record<string, any>): void {
    try {
        writeJsonFileAtomic(stateFilePath(), state);
    } catch {
        // 状态写盘失败最多导致重启后重复提醒一次，不影响活动主流程
    }
}

/** 北京时间日期键，用于「每天最多提醒一次」 */
export function beijingDayKey(tsSec: number): string {
    return new Date((tsSec + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

/**
 * 计算本次应发送的结算提醒；不需要发送时返回 null。
 * 纯函数，便于单测覆盖结算期边界。
 */
export function buildSettleReminder(input: {
    settleStart: number;
    end: number;
    now: number;
    sentDay?: string;
}): (AutoPushMessage & { day: string }) | null {
    const settleStart = toNum(input.settleStart);
    const end = toNum(input.end);
    const now = toNum(input.now);
    // 只在「结算期开始 ~ 活动结束」之间提醒，活动结束后不再推送
    if (!(settleStart > 0 && end > 0 && now >= settleStart && now < end)) return null;
    const day = beijingDayKey(now);
    if (String(input.sentDay || '') === day) return null;

    const remainSec = end - now;
    if (remainSec <= END_SOON_SEC) {
        const hours = Math.max(1, Math.ceil(remainSec / 3600));
        return {
            day,
            title: '奶茶活动即将结束',
            content: `奶茶热销中剩余约 ${hours} 小时结束，请立即兑换奖励并清空库存，活动结束后未兑换奖励将失效。`,
        };
    }
    const days = Math.max(1, Math.ceil(remainSec / 86400));
    return {
        day,
        title: '奶茶进入结算期',
        content: `奶茶热销中已进入结算期，剩余约 ${days} 天结束。结算期不可制作、雇佣、加速，请及时兑换奖励并清仓库存。`,
    };
}

/** 按活动读取上次提醒日期 */
export function getSentDay(activityKey: string): string {
    const record = loadState()[activityKey];
    return record && typeof record === 'object' ? String(record.day || '') : '';
}

/** 记录本次提醒日期（写盘失败不抛错） */
export function markSent(activityKey: string, day: string, now: number): void {
    const state = loadState();
    const record = state[activityKey] && typeof state[activityKey] === 'object' ? state[activityKey] : {};
    state[activityKey] = { ...record, day, notifiedAt: toNum(now) };
    saveState(state);
}
