const assert = require('node:assert/strict');
const test = require('node:test');

const { scanMessage, annotate, decodeText } = require('../dist/services/activity-probe');

function varint(value) {
    const bytes = [];
    let rest = value >>> 0;
    while (rest > 0x7F) {
        bytes.push((rest & 0x7F) | 0x80);
        rest >>>= 7;
    }
    bytes.push(rest);
    return Buffer.from(bytes);
}

function tag(field, wire) {
    return varint((field << 3) | wire);
}

function lenDelim(field, payload) {
    return Buffer.concat([tag(field, 2), varint(payload.length), payload]);
}

function scan(buf, left = 200) {
    return scanMessage(buf, 0, { left });
}

test('reads text and varint fields from a flat message', () => {
    const buf = Buffer.concat([
        lenDelim(1, Buffer.from('故友重逢', 'utf8')),
        tag(2, 0),
        varint(300),
    ]);

    const result = scan(buf);
    assert.equal(result.complete, true);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.nodes[0].field, 1);
    assert.equal(result.nodes[0].text, '故友重逢');
    assert.equal(result.nodes[1].field, 2);
    assert.equal(result.nodes[1].varint, '300');
});

test('expands nested messages instead of dumping hex', () => {
    const inner = Buffer.concat([
        lenDelim(1, Buffer.from('召回老友', 'utf8')),
        tag(2, 0),
        varint(7),
    ]);

    const result = scan(lenDelim(9, inner));
    assert.equal(result.complete, true);
    assert.equal(result.nodes[0].field, 9);
    assert.ok(Array.isArray(result.nodes[0].children));
    assert.equal(result.nodes[0].children[0].text, '召回老友');
    assert.equal(result.nodes[0].children[1].varint, '7');
});

test('reports incomplete instead of throwing on a truncated buffer', () => {
    // 声明长度 16，实际只有 1 个字节
    const buf = Buffer.from([0x0A, 0x10, 0x61]);
    const result = scan(buf);
    assert.equal(result.complete, false);
    assert.equal(result.nodes.length, 0);
});

test('stops scanning when the node budget runs out', () => {
    const buf = Buffer.concat(Array.from({ length: 20 }, () => lenDelim(1, Buffer.from('a'))));
    const result = scan(buf, 3);
    assert.equal(result.nodes.length, 3);
});

test('only treats readable text as text', () => {
    assert.equal(decodeText(Buffer.from('故友重逢', 'utf8')), '故友重逢');
    assert.equal(decodeText(Buffer.from('recall friend', 'utf8')), 'recall friend');
    assert.equal(decodeText(Buffer.from([0x00, 0x01, 0x02, 0x03])), null);
    assert.equal(decodeText(Buffer.from('12345', 'utf8')), null);
});

test('marks unknown activity bodies and keeps known ones named', () => {
    const unknown = [{ field: 123, wire: 2, length: 8 }];
    annotate(unknown, 1);
    assert.equal(unknown[0].name, 'unknown-body');

    const known = [{ field: 121, wire: 2, length: 8 }];
    annotate(known, 1);
    assert.equal(known[0].name, 'milk_tea');

    // 顶层（depth 0）不标注，避免把 ActivityContent 内部字段误标成业务体
    const top = [{ field: 123, wire: 2, length: 8 }];
    annotate(top, 0);
    assert.equal(top[0].name, undefined);
});
