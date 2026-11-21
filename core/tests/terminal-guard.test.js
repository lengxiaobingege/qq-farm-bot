const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { shouldRejectInteractiveTerminal } = require(path.resolve(
    __dirname,
    '../dist/utils/terminal-guard.js',
));

// 编译产物的正当默认场景：非 TTY（start.sh 的 nohup setsid）、非 worker、非源码
const compiled = {
    runningFromSource: false,
    isWorker: false,
    stdinIsTTY: false,
    allowInteractiveTerminal: false,
};

test('编译产物 + 前台 TTY = 野实例，拒绝启动', () => {
    assert.equal(shouldRejectInteractiveTerminal({ ...compiled, stdinIsTTY: true }), true);
});

test('标准启动（nohup setsid，stdin 非 TTY）放行', () => {
    assert.equal(shouldRejectInteractiveTerminal(compiled), false);
});

test('tsx 从源码运行（开发热更新）放行，即使挂在前台终端', () => {
    assert.equal(shouldRejectInteractiveTerminal({
        ...compiled,
        stdinIsTTY: true,
        runningFromSource: true,
    }), false);
});

test('worker 子进程放行，即使 stdin 表现为 TTY', () => {
    assert.equal(shouldRejectInteractiveTerminal({
        ...compiled,
        stdinIsTTY: true,
        isWorker: true,
    }), false);
});

test('显式放行标记可让编译产物在前台终端运行（调试逃生舱）', () => {
    assert.equal(shouldRejectInteractiveTerminal({
        ...compiled,
        stdinIsTTY: true,
        allowInteractiveTerminal: true,
    }), false);
});

test('放行标记只影响 TTY 判定，非 TTY 场景无副作用', () => {
    assert.equal(shouldRejectInteractiveTerminal({ ...compiled, allowInteractiveTerminal: true }), false);
});
