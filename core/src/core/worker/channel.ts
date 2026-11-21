export {};
/**
 * 与主进程的通信通道：消息发送/接收、优雅退出、日志与金币经验钩子。
 */
const { parentPort, workerData } = require('node:worker_threads');
const { formatSystemDateTime24 } = require('../../utils/utils');
const { setLogHook } = require('../../utils/utils');
const { setRecordGoldExpHook } = require('../../services/status');
const { ignoreError } = require('../../utils/ignore-error');

function sendToMaster(payload: Record<string, any>): void {
    if (process.send) {
        process.send(payload);
        return;
    }
    if (parentPort) {
        parentPort.postMessage(payload);
    }
}

function onMasterMessage(handler: (msg: any) => void): void {
    if (process.send) {
        process.on('message', handler);
    }
    if (parentPort) {
        parentPort.on('message', handler);
    }
}

function exitWorker(code: number = 0): void {
    if (parentPort) {
        try {
            parentPort.close();
        } catch (err) { ignoreError('core/src/core/worker.ts:81', err); }
        return;
    }
    process.exit(code);
}

// 捕获日志发送给主进程
setLogHook((tag: string, msg: string, isWarn: boolean, meta: any) => {
    sendToMaster({
        type: 'log',
        data: {
            time: formatSystemDateTime24(),
            tag,
            msg,
            isWarn,
            meta: meta || {},
        }
    });
});

// 捕获金币经验变化
setRecordGoldExpHook((gold: number, exp: number) => {
    // 更新内部统计
    const { recordGoldExp } = require('../../services/stats');
    recordGoldExp(gold, exp);

    // 发送给主进程
    sendToMaster({ type: 'stat_update', data: { gold, exp } });
});
module.exports = { sendToMaster, onMasterMessage, exitWorker };
