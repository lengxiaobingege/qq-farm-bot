/**
 * 活动协议探测（只读诊断）
 *
 * 背景：本地 activitypb.proto 是从旧版客户端提取的，新上线的活动（如「故友重逢」）
 * 在 ActivityData 里对应一个尚未定义的 body 字段，protobufjs 解码时会把它当未知字段丢弃，
 * 于是面板只能看到名字和起止时间，看不到任何进度或可领取状态。
 *
 * 这里不猜结构，直接对 GetGroup 的原始字节做 wire-format 扫描：把每一层的
 * 字段号 / 长度 / 可读文本 / 嵌套结构原样列出来。有了字段号，才谈得上补 proto。
 *
 * 纯只读：只调用 GetGroup，不发 Operate，不产生任何写操作。
 */

export {};

const protobufModule = require('protobufjs');
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');

const MAX_DEPTH = 6;
const MAX_NODES = 4000;
const MAX_TEXT_LENGTH = 16384;
const MAX_HEX_PREVIEW = 256;
// 字段号上限。真实业务字段远小于这个值，超出的基本是把文本误当成 message 读的结果
const MAX_FIELD_NUMBER = 4096;

interface ScanBudget {
    left: number;
    truncated: boolean;
}

interface ScanNode {
    field: number;
    wire: number;
    length?: number;
    varint?: string;
    fixed64?: string;
    fixed32?: string;
    text?: string;
    hex?: string;
    name?: string;
    children?: ScanNode[];
}

interface ScanResult {
    nodes: ScanNode[];
    complete: boolean;
}

/** ActivityData 里已知的业务体字段，用于把扫描结果标成可读名字 */
const ACTIVITY_DATA_FIELDS: Record<number, string> = {
    1: 'activity(ActivityContent)',
    2: 'children',
    102: 'catalog',
    103: 'qingmei_daily_seed',
    105: 'weather_bottle',
    108: 'qingmei_brew',
    110: 'constellation',
    112: 'qixi_bridge',
    113: 'qixi_gift',
    114: 'qingmei_quote',
    115: 'pet_treasure_hunt',
    116: 'charity_red_flower',
    117: 'weather_tasks',
    118: 'weather_research',
    119: 'wish_sign',
    120: 'share_reward',
    121: 'milk_tea',
    122: 'growth_fund',
};

/** 一段字节看起来像不像可读文本（中文/字母/数字/常用标点） */
function decodeText(buf: Buffer): string | null {
    if (!buf || buf.length === 0 || buf.length > MAX_TEXT_LENGTH) return null;
    const text = buf.toString('utf8');
    // 出现替换字符说明不是合法 UTF-8
    if (text.includes('\uFFFD')) return null;
    const chars = [...text];
    for (const ch of chars) {
        const code = ch.codePointAt(0) || 0;
        const printable = code >= 0x20 && code !== 0x7F;
        const whitespace = code === 0x09 || code === 0x0A || code === 0x0D;
        if (!printable && !whitespace) return null;
    }
    // 纯符号/数字不算文本，避免把短二进制误判
    if (!/\p{L}/u.test(text)) return null;
    return text;
}

function scanMessage(buf: Buffer, depth: number, budget: ScanBudget): ScanResult {
    const nodes: ScanNode[] = [];
    const reader = protobufModule.Reader.create(buf);
    while (reader.pos < reader.len) {
        if (budget.left <= 0) { budget.truncated = true; return { nodes, complete: false }; }
        budget.left -= 1;

        let tagValue: number;
        try {
            tagValue = reader.uint32();
        } catch {
            return { nodes, complete: false };
        }
        const field = tagValue >>> 3;
        const wire = tagValue & 7;
        if (field === 0 || field > MAX_FIELD_NUMBER) return { nodes, complete: false };

        if (wire === 0) {
            try {
                const value = reader.uint64();
                nodes.push({ field, wire, varint: String(value) });
            } catch {
                return { nodes, complete: false };
            }
        } else if (wire === 1 || wire === 5) {
            const size = wire === 1 ? 8 : 4;
            if (reader.pos + size > reader.len) return { nodes, complete: false };
            const raw = buf.subarray(reader.pos, reader.pos + size).toString('hex');
            nodes.push(wire === 1 ? { field, wire, fixed64: raw } : { field, wire, fixed32: raw });
            reader.pos += size;
        } else if (wire === 2) {
            let len: number;
            try {
                len = reader.uint32();
            } catch {
                return { nodes, complete: false };
            }
            const start = reader.pos;
            if (start + len > reader.len) return { nodes, complete: false };
            const payload = buf.subarray(start, start + len);
            reader.pos = start + len;

            const node: ScanNode = { field, wire, length: len };
            // 先当文本：文本的字符集很干净，能可靠排除二进制
            const text = decodeText(payload);
            if (text !== null) {
                node.text = text;
            } else if (depth < MAX_DEPTH && len >= 2) {
                const nested = scanMessage(payload, depth + 1, budget);
                // 只有把整段字节恰好读完，才认为是嵌套 message
                if (nested.complete && nested.nodes.length > 0) {
                    node.children = nested.nodes;
                } else {
                    node.hex = payload.subarray(0, MAX_HEX_PREVIEW).toString('hex');
                }
            } else {
                node.hex = payload.subarray(0, MAX_HEX_PREVIEW).toString('hex');
            }
            nodes.push(node);
        } else {
            // 3/4 是已废弃的 group 语义，协议里不会出现
            return { nodes, complete: false };
        }
    }
    return { nodes, complete: reader.pos === reader.len };
}

/** 给 ActivityData 层级的字段补上可读名字，未知的就是待补的 body */
function annotate(nodes: ScanNode[], depth: number): ScanNode[] {
    for (const node of nodes) {
        if (depth === 1 && ACTIVITY_DATA_FIELDS[node.field]) {
            node.name = ACTIVITY_DATA_FIELDS[node.field];
        } else if (depth === 1 && node.wire === 2 && (node.length || 0) > 0) {
            node.name = 'unknown-body';
        }
        if (node.children) annotate(node.children, depth + 1);
    }
    return nodes;
}

/** 收集扫描结果里出现的字段号，便于快速判断哪些是新 body */
function collectFields(nodes: ScanNode[], depth: number, acc: Record<number, { field: number; length?: number; known: boolean }>) {
    for (const node of nodes) {
        if (depth === 1 && node.wire === 2) {
            if (!acc[node.field]) {
                acc[node.field] = {
                    field: node.field,
                    length: node.length,
                    known: !!node.name && node.name !== 'unknown-body',
                };
            }
        }
        if (node.children) collectFields(node.children, depth + 1, acc);
    }
    return acc;
}

async function probeActivityGroup(groupId: unknown) {
    const id = String(groupId || '').trim();
    if (!id) throw new Error('groupId 不能为空');

    const body = types.GetGroupRequest.encode({ group_id: id }).finish();
    const reply = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', body);
    const raw = Buffer.from(reply.body || []);
    if (raw.length === 0) return { groupId: id, bytes: 0, fields: [], bodyFields: [] };

    const budget: ScanBudget = { left: MAX_NODES, truncated: false };
    const scanned = scanMessage(raw, 0, budget);
    const fields = annotate(scanned.nodes, 0);

    return {
        groupId: id,
        bytes: raw.length,
        complete: scanned.complete,
        truncated: budget.truncated,
        fields,
        bodyFields: Object.values(collectFields(fields, 0, {})).sort((a, b) => a.field - b.field),
        // 原始字节（base64）：诊断新活动时可在本地反复离线解析，避免为看完整 body 反复重启。
        rawBase64: raw.toString('base64'),
    };
}

module.exports = {
    probeActivityGroup,
    // 供测试直接验证扫描器，不依赖网络
    scanMessage,
    annotate,
    decodeText,
};
