export {};
/**
 * 统一处理「有意忽略」的异常。
 *
 * 项目里存在大量空的异常捕获 —— 多数是协议推送解析失败、socket/临时文件清理失败等
 * 不应中断主流程的场景。完全静默会让协议变更、资源泄漏等问题无法排查。
 * 这里保持默认静默（不改变运行时行为），但设置 DEBUG_IGNORED_ERRORS=1 时
 * 会输出带调用点的调试信息，把「静默吞错」变成「可观测的显式忽略」。
 */
const DEBUG_IGNORED_ERRORS = process.env.DEBUG_IGNORED_ERRORS === '1';

function ignoreError(context: string, err?: unknown): void {
    if (!DEBUG_IGNORED_ERRORS) return;
    let detail = '';
    if (err instanceof Error) {
        detail = err.message;
    } else if (err !== undefined && err !== null) {
        detail = String(err);
    }
    console.warn(`[ignored-error] ${context}${detail ? `: ${detail}` : ''}`);
}

module.exports = { ignoreError, DEBUG_IGNORED_ERRORS };
