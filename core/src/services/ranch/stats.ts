export {};

/**
 * 牧场今日产出统计（只计数与物品汇总，不做收益估值）。
 *
 * 产物价格随图鉴与集市波动，估出来的收益会误导用户，所以这里只记录
 * 「今天做了几次、拿到了哪些东西」，前端按条数展示。
 *
 * 统计失败不能影响写操作主流程：所有读写都吞异常。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getDataDir } = require('../../config/runtime-paths');
const { writeJsonFileAtomic } = require('../json-db');
const { getSystemDateKey } = require('../../utils/utils');

const KINDS = ['harvest', 'produce', 'sell', 'feed', 'clean', 'buy', 'exchange'];

function accountFile(): string | null {
    const accountId = process.env.FARM_ACCOUNT_ID;
    if (!accountId) return null;
    return path.join(getDataDir(), 'ranch-stats', `${createHash('sha256').update(accountId).digest('hex')}.json`);
}

function emptyState(): any {
    return { dateKey: getSystemDateKey(), counts: {}, items: {} };
}

function read(): any {
    const file = accountFile();
    if (!file || !fs.existsSync(file)) return emptyState();
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        // 跨天直接归零，不保留历史（历史统计交给日志）。
        if (!parsed || parsed.dateKey !== getSystemDateKey() || typeof parsed.counts !== 'object') return emptyState();
        return { dateKey: parsed.dateKey, counts: parsed.counts || {}, items: parsed.items || {} };
    } catch {
        return emptyState();
    }
}

/** 记录一次成功的写操作；items 为本次实际获得的物品（含名称，便于前端直接展示）。 */
function record(action: string, items: any[] = []): void {
    const file = accountFile();
    if (!file || !KINDS.includes(action)) return;
    try {
        const state = read();
        state.counts[action] = Number(state.counts[action] || 0) + 1;
        for (const item of items || []) {
            const id = String(item?.id ?? '');
            if (!id || id === '0') continue;
            const key = `${id}`;
            const current = state.items[key] || { id: Number(id), name: item.name || `物品${id}`, image: item.image || '', count: '0' };
            current.count = (BigInt(current.count) + BigInt(String(item.count ?? '0'))).toString();
            current.name = item.name || current.name;
            current.image = item.image || current.image;
            state.items[key] = current;
        }
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        writeJsonFileAtomic(file, state);
    } catch {
        // 统计是附加信息，失败不影响本次操作结果。
    }
}

function today(): any {
    const state = read();
    const counts = KINDS.reduce((acc: any, kind: string) => {
        acc[kind] = Number(state.counts[kind] || 0);
        return acc;
    }, {});
    const items = Object.values(state.items || {})
        .filter((item: any) => item && BigInt(String(item.count || '0')) > 0n)
        .sort((a: any, b: any) => (BigInt(b.count) > BigInt(a.count) ? 1 : -1));
    return { dateKey: state.dateKey, counts, items };
}

module.exports = { record, today, KINDS };
