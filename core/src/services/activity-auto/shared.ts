export {};
/**
 * 活动自动化公共工具：结果类型、错误去重日志、单步容错执行
 */

export interface AutoPushMessage {
    title: string;
    content: string;
}

export interface AutoResult {
    claimed: number;
    message: string;
    /** 需要推送给用户的提醒，由调度层通过主进程发送 */
    push?: AutoPushMessage;
}

// 同一活动的同一错误短时间内不重复写日志，避免活动结束/资源不足时每个 tick 刷屏
const ERROR_REPEAT_WINDOW_MS = 30 * 60 * 1000;
const lastErrorByActivity = new Map<string, { message: string; at: number }>();

const { log } = require('../../utils/utils');

export function logActivityError(key: string, label: string, e: any): string {
    const message = String(e?.message || e);
    const now = Date.now();
    const last = lastErrorByActivity.get(key);
    if (last && last.message === message && now - last.at < ERROR_REPEAT_WINDOW_MS) {
        return `${label}失败(已静默): ${message}`;
    }
    lastErrorByActivity.set(key, { message, at: now });
    log('活动任务', `${label}自动化失败: ${message}`, {
        module: 'activity_task', event: key, result: 'error',
    });
    return `${label}失败: ${message}`;
}

// 单步失败不阻断整轮：某一步（如货币不足）抛错时跳过该步，继续后续步骤
const stepFailures: string[] = [];

export async function safeStep(label: string, fn: () => Promise<void>): Promise<boolean> {
    try {
        await fn();
        return true;
    } catch (e: any) {
        const message = String(e?.message || e);
        stepFailures.push(`${label}: ${message}`);
        return false;
    }
}

export function takeStepFailures(): string[] {
    const list = [...stepFailures];
    stepFailures.length = 0;
    return list;
}
