import type { ActivityWindow } from './sell-conditions';
import scopeConfig from './ranch-activity-scope.json';

export {};

/**
 * 活动归属场景。
 *
 * ActivityList 是全局的：协议里没有场景字段（ActivityListRequest 是空消息），
 * 服务端也不按当前场景过滤，所以农场活动中心与牧场活动页此前拿到的是同一份数据，
 * 牧场页因此把「奶茶热销中」「故友重逢」这类农场/全局活动当成了牧场活动。
 *
 * 唯一可用的信号是 ActivityContent.extra 里的 UI 标识 uid，以及活动 id。
 * 归属规则放在同目录的 ranch-activity-scope.json，新增牧场活动改配置即可，
 * 无需改代码；reloadRanchActivityScope() 可在运行时热更新。
 */

interface RanchScopeRules {
    uidPrefixes: string[];
    idPrefixes: string[];
    exactIds: string[];
    /** 明确排除 id：即使命中前缀也判为全局，用于纠正前缀误判，优先级最高。 */
    excludeIds: string[];
}

function sanitizeList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(Boolean);
}

function sanitizeRules(value: any): RanchScopeRules {
    return {
        uidPrefixes: sanitizeList(value?.uidPrefixes),
        idPrefixes: sanitizeList(value?.idPrefixes),
        exactIds: sanitizeList(value?.exactIds),
        excludeIds: sanitizeList(value?.excludeIds),
    };
}

let rules: RanchScopeRules = sanitizeRules(scopeConfig);

/** 保留旧导出名，供外部引用（值取当前配置的 id 前缀快照）。 */
export const RANCH_ACTIVITY_ID_PREFIXES: string[] = [...rules.idPrefixes];

/**
 * 从磁盘重新加载归属表。管理端改完 ranch-activity-scope.json 后可调用；
 * 读取失败时保留现有规则，不把分类能力清掉。
 */
export function reloadRanchActivityScope(): RanchScopeRules {
    try {
        const { getResourcePath } = require('./runtime-paths');
        const fs = require('node:fs');
        const file = getResourcePath('config', 'ranch-activity-scope.json');
        if (fs.existsSync(file)) {
            rules = sanitizeRules(JSON.parse(fs.readFileSync(file, 'utf8')));
            RANCH_ACTIVITY_ID_PREFIXES.length = 0;
            RANCH_ACTIVITY_ID_PREFIXES.push(...rules.idPrefixes);
        }
    } catch { /* 配置损坏时沿用内存中的现有规则 */ }
    return { ...rules, uidPrefixes: [...rules.uidPrefixes], idPrefixes: [...rules.idPrefixes], exactIds: [...rules.exactIds], excludeIds: [...rules.excludeIds] };
}

/** 供测试/诊断读取当前生效规则。 */
export function getRanchActivityScopeRules(): RanchScopeRules {
    return { ...rules, uidPrefixes: [...rules.uidPrefixes], idPrefixes: [...rules.idPrefixes], exactIds: [...rules.exactIds], excludeIds: [...rules.excludeIds] };
}

/** 程序化覆盖规则（测试或管理端注入），传入的对象按 sanitize 规则清理。 */
export function setRanchActivityScopeRules(next: any): RanchScopeRules {
    rules = sanitizeRules(next);
    RANCH_ACTIVITY_ID_PREFIXES.length = 0;
    RANCH_ACTIVITY_ID_PREFIXES.push(...rules.idPrefixes);
    return getRanchActivityScopeRules();
}

function startsWithAny(value: string, prefixes: string[]): boolean {
    return prefixes.some(prefix => value.startsWith(prefix));
}

export type ActivityScope = 'ranch' | 'global';

/**
 * 判断一条活动是否属于牧场场景。
 * 判定顺序：排除表优先（纠正前缀误判）→ uid 前缀 → id 前缀 → 精确 id → 默认全局。
 * 未识别的活动一律按全局处理，不混进牧场页、也不误删农场活动。
 */
export function activityScope(window: ActivityWindow): ActivityScope {
    if (!window) return 'global';
    const id = String(window.id || '').trim();
    if (id && rules.excludeIds.includes(id)) return 'global';
    if (startsWithAny(String(window.uid || '').trim(), rules.uidPrefixes)) return 'ranch';
    if (id && startsWithAny(id, rules.idPrefixes)) return 'ranch';
    if (id && rules.exactIds.includes(id)) return 'ranch';
    return 'global';
}

export function isRanchActivity(window: ActivityWindow): boolean {
    return activityScope(window) === 'ranch';
}

/**
 * 农场活动中心只展示全局/农场活动：牧场专属活动（Muge* / 已确认牧场 id）只在牧场页出现。
 * 未识别的活动一律视为全局，避免误删农场活动。
 */
export function isGlobalActivity(window: ActivityWindow): boolean {
    return activityScope(window) !== 'ranch';
}

module.exports = {
    activityScope, isRanchActivity, isGlobalActivity,
    RANCH_ACTIVITY_ID_PREFIXES,
    reloadRanchActivityScope, getRanchActivityScopeRules, setRanchActivityScopeRules,
};
