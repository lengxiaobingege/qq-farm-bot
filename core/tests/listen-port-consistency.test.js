const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 防重复实例的「探测端口」必须与 admin 管理端的「监听端口」用同一套逻辑。
// 两者一旦漂移（例如探测 3000、监听 3007），socat 转发入口上的残留进程就会
// 让新实例误判"已有实例"退出，造成容器重建后的自愈空窗。

const clientSrc = fs.readFileSync(path.resolve(__dirname, '../client.ts'), 'utf8');
const configSrc = fs.readFileSync(path.resolve(__dirname, '../src/config/config.ts'), 'utf8');

// 从源码抽取两处表达式，注入环境变量后求值，比较运行时结果（而非脆弱的字面比对）
const clientExpr = (clientSrc.match(/const listenPort = ([^;]+);/) || [])[1];
// config 里既有类型声明 `adminPort: number;` 又有赋值行；只取含 Number( 的那一行
const configExpr = configSrc.split('\n')
    .map(line => line.match(/adminPort: (.+),$/))
    .find(m => m && m[1].includes('Number('))?.[1];

function evalExpr(expr, env) {
    // 表达式仅由源码常量与 process.env.* 构成（非用户输入），注入受控 process 求值；
    // 用于比对两处端口解析逻辑的运行时结果，避免脆弱的字面比对。
    // eslint-disable-next-line no-new-func, unicorn/new-for-builtins
    return new Function('process', `return (${expr});`)({ env });
}

const scenarios = [
    { name: '无 PORT（默认）', env: {}, expected: 3007 },
    { name: 'PORT=3000 单端口特例', env: { PORT: '3000' }, expected: 3000 },
    { name: 'PORT=3007', env: { PORT: '3007' }, expected: 3007 },
    { name: 'ADMIN_PORT 优先于 PORT', env: { PORT: '3000', ADMIN_PORT: '4000' }, expected: 4000 },
    { name: '非法 PORT 回退默认', env: { PORT: 'abc' }, expected: 3007 },
];

test('client 探测端口与 config 监听端口表达式均可解析', () => {
    assert.ok(clientExpr, 'client.ts 中应找到 const listenPort = ...');
    assert.ok(configExpr, 'config.ts 中应找到 adminPort: Number(...)');
});

for (const s of scenarios) {
    test(`端口解析一致且正确：${s.name}`, () => {
        assert.equal(evalExpr(clientExpr, s.env), s.expected);
        assert.equal(evalExpr(configExpr, s.env), s.expected);
        assert.equal(evalExpr(clientExpr, s.env), evalExpr(configExpr, s.env));
    });
}

test('探测端口默认不再是裸 3000（socat 公网入口）', () => {
    const expr = clientExpr.replace(/\s+/g, '');
    assert.ok(!/Number\(process\.env\.PORT\)\|\|3000/.test(expr),
        '探测端口回退值不应为 3000，否则 socat 残留会造成误判');
});
