const assert = require('node:assert/strict');
const test = require('node:test');
const Long = require('long');

const { int64CountString } = require('../dist/services/warehouse');

/**
 * int64 数量转字符串不得经过 Number，否则 > 2^53 会丢精度。
 * 背景：batchUseItems 回包的 used/gained.count 是 uint64，
 * 旧写法 String(toNum(count)) → Long→Number→String，大数会被四舍五入。
 */
test('普通安全整数正常转换', () => {
    assert.equal(int64CountString(0), '0');
    assert.equal(int64CountString(7), '7');
    assert.equal(int64CountString('123'), '123');
    assert.equal(int64CountString(null), '0');
    assert.equal(int64CountString(undefined), '0');
});

test('Long 大数按十进制字符串精确输出，不丢精度', () => {
    const huge = Long.fromString('9007199254740993'); // 2^53 + 1，Number 无法精确表示
    assert.equal(int64CountString(huge), '9007199254740993');

    // protobufjs 解码 uint64 时生成 unsigned Long（与真实回包一致）
    const beyond = Long.fromString('18446744073709551615', true); // uint64 最大值
    assert.equal(int64CountString(beyond), '18446744073709551615');
});

test('大数十进制字符串原样保留', () => {
    assert.equal(int64CountString('9007199254740993'), '9007199254740993');
});

test('非数字字符串回退为 0', () => {
    assert.equal(int64CountString('abc'), '0');
    assert.equal(int64CountString('12.5'), '0');
});
