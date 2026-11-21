const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 农场巡查轮次守卫。
 * 背景：runFriendTick / runPastureTick 都在开始时捕获 runtimeGeneration、
 * 并在 finally 里用 generation === st.runtimeGeneration 守卫收尾，
 * 而 runFarmTick 曾遗漏——重连/切号后旧轮次的 finally 会覆盖新一轮调度状态。
 * 本测试锁住三个 tick 的守卫结构一致，防止重构时再次漏掉。
 */
const src = fs.readFileSync(path.join(__dirname, '../src/core/worker/schedules.ts'), 'utf8');

function functionBody(name) {
    const start = src.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `未找到函数 ${name}`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(open, i + 1);
        }
    }
    assert.fail(`函数 ${name} 未闭合`);
}

for (const name of ['runFarmTick', 'runFriendTick', 'runPastureTick']) {
    test(`${name} 捕获 runtimeGeneration`, () => {
        const body = functionBody(name);
        assert.match(body, /const generation = st\.runtimeGeneration/, `${name} 必须在开头捕获 generation`);
    });

    test(`${name} finally 里有 generation 守卫`, () => {
        const body = functionBody(name);
        assert.match(body, /generation === st\.runtimeGeneration/, `${name} 的 finally 必须守卫 generation`);
    });
}
