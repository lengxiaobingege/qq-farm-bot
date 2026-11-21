export {};

/**
 * 前台终端野实例守卫。
 *
 * 沙箱/终端会话恢复时会重放历史命令（典型是 `PORT=3000 node core/client.js`），
 * 在前台 pts 上起出一个脱离 start.sh 管理的实例：它直接占用监听端口、不写 pid 文件、
 * 不带看门狗、也没有 3000→3007 转发，导致架构"带病运行"——面板能开、自动化也在跑，
 * 但 CORS/转发/守护全部绕过了标准流程，且下次休眠醒来又会重复出现。
 *
 * 判据取交集，尽量不误伤正当场景：
 * - 从源码跑（tsx client.ts，开发热更新）→ 放行；
 * - worker 子进程（由主进程拉起）→ 放行；
 * - 显式放行标记 QQ_FARM_ALLOW_TTY=1（前台调试的逃生舱）→ 放行；
 * - 其余情况下 stdin 连着交互终端（isTTY）→ 判定为野实例，拒绝启动。
 *
 * 标准启动路径（start.sh 的 nohup setsid + stdin 重定向）天然非 TTY，
 * 且 start.sh 会显式带上放行标记，两条都保证它不受影响。
 */

export interface TerminalGuardInput {
    /** 是否从 .ts 源码运行（tsx/打包前的开发模式） */
    runningFromSource: boolean;
    /** 是否为 worker 子进程 */
    isWorker: boolean;
    /** stdin 是否连接到交互终端 */
    stdinIsTTY: boolean;
    /** 是否显式声明允许前台终端运行 */
    allowInteractiveTerminal: boolean;
}

/** 命中野实例特征时返回 true，调用方应拒绝本次启动。 */
function shouldRejectInteractiveTerminal(input: TerminalGuardInput): boolean {
    if (input.runningFromSource) return false;
    if (input.isWorker) return false;
    if (input.allowInteractiveTerminal) return false;
    return input.stdinIsTTY === true;
}

module.exports = {
    shouldRejectInteractiveTerminal,
};
