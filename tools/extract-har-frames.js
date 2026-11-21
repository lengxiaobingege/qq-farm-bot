/*
 * Split websocket frames out of a HAR capture into GateMessage .bin files.
 * Usage: node tools/extract-har-frames.js <capture.har> [outDir]
 *
 * 支持 Chrome / Reqable / Charles 导出的 HAR（_webSocketMessages）。
 * 输出可直接喂给 tools/decode-latest-protocols.js：
 *   node tools/extract-har-frames.js farm.har /tmp/frames
 *   pnpm -C core exec tsx ../tools/decode-latest-protocols.js /tmp/frames --all --shape
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const coreRequire = createRequire(path.resolve(__dirname, '../core/package.json'));
const protobuf = coreRequire('protobufjs');

const harPath = path.resolve(process.argv[2] || '');
const outDir = path.resolve(process.argv[3] || path.join(path.dirname(harPath), 'frames'));
const protoDir = path.resolve(__dirname, '../core/src/proto');

if (!harPath || !fs.existsSync(harPath)) {
    console.error('用法: node tools/extract-har-frames.js <capture.har> [outDir]');
    process.exit(1);
}

const BASE64 = /^[A-Za-z0-9+/=\s]+$/;

async function main() {
    const root = new protobuf.Root();
    const protoFiles = fs.readdirSync(protoDir).filter(name => name.endsWith('.proto')).map(name => path.join(protoDir, name));
    await root.load(protoFiles, { keepCase: true });
    const gate = root.lookupType('gatepb.Message');
    const eventType = root.lookupType('gatepb.EventMessage');

    /* 通知帧的外层 meta 不带 service，事件名在 body 里，单独取一次 */
    function notifyName(meta, buffer) {
        try {
            const message = gate.decode(buffer);
            const event = eventType.decode(Buffer.from(message.body || []));
            return String(event.message_type || '') || `type=${meta.message_type}`;
        } catch {
            return `type=${meta.message_type}`;
        }
    }

    function decodeMeta(buffer) {
        try {
            const message = gate.decode(buffer);
            const meta = message.meta;
            if (!meta) return null;
            if (!meta.service_name && !meta.method_name && !meta.message_type) return null;
            return meta;
        } catch {
            return null;
        }
    }

    /* 一帧可能是 utf8 文本、也可能是 base64；用能否解出 meta 来判定，不猜。 */
    function toBytes(message) {
        const raw = typeof message.data === 'string' ? message.data : '';
        if (!raw) return null;
        const opcode = Number(message.opcode || (message.binary ? 2 : 1));
        const candidates = [];
        const cleaned = raw.replace(/\s/g, '');
        const looksBase64 = BASE64.test(raw) && cleaned.length % 4 === 0;
        if (opcode === 2 || message.binary === true) {
            candidates.push({ how: 'base64', buffer: Buffer.from(cleaned, 'base64') });
            candidates.push({ how: 'utf8', buffer: Buffer.from(raw, 'utf8') });
        } else {
            candidates.push({ how: 'utf8', buffer: Buffer.from(raw, 'utf8') });
            if (looksBase64) candidates.push({ how: 'base64', buffer: Buffer.from(cleaned, 'base64') });
        }
        let first = null;
        for (const candidate of candidates) {
            if (!candidate.buffer || candidate.buffer.length === 0) continue;
            if (!first) first = candidate;
            const meta = decodeMeta(candidate.buffer);
            if (meta) return { buffer: candidate.buffer, how: candidate.how, meta };
        }
        return first;
    }

    function collect(har) {
        const entries = (har && har.log && har.log.entries) || [];
        const frames = [];
        for (const entry of entries) {
            const url = (entry.request && entry.request.url) || '';
            for (const message of entry._webSocketMessages || []) {
                /* Reqable：{flow, timestamp, payload:{type, buffer(base64)}}，flow 0=客户端发出 */
                if (message && message.payload && typeof message.payload.buffer === 'string') {
                    frames.push({ url, message: { type: message.flow === 0 ? 'send' : 'receive', data: message.payload.buffer, binary: true, opcode: 2 } });
                    continue;
                }
                /* Chrome：{type, time, opcode, data} */
                if (message && typeof message.data === 'string') {
                    frames.push({ url, message });
                }
            }
        }
        return { entries: entries.length, frames };
    }

    const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const { entries, frames } = collect(har);

    if (frames.length === 0) {
        console.error(`HAR 里没有 _webSocketMessages（${entries} 个 entry）。导出时请勾选「保留 WebSocket 消息/帧」。`);
        process.exit(2);
    }

    fs.mkdirSync(outDir, { recursive: true });
    for (const name of fs.readdirSync(outDir)) {
        if (name.endsWith('.bin')) fs.unlinkSync(path.join(outDir, name));
    }

    const hostStats = new Map();
    const services = new Map();
    let written = 0;
    let skipped = 0;
    let metaMissing = 0;

    frames.forEach((frame, index) => {
        const parsed = toBytes(frame.message);
        if (!parsed) { skipped += 1; return; }
        const direction = frame.message.type === 'send' ? 'send' : 'recv';
        const name = `${String(index).padStart(5, '0')}-${direction}-${parsed.how}.bin`;
        fs.writeFileSync(path.join(outDir, name), parsed.buffer);
        written += 1;

        let host = frame.url || '(unknown)';
        try { host = new URL(frame.url).host; } catch { /* 保留原值 */ }
        hostStats.set(host, (hostStats.get(host) || 0) + 1);

        if (parsed.meta) {
            const key = parsed.meta.service_name
                ? `${parsed.meta.service_name}.${parsed.meta.method_name}`
                : `(notify) ${notifyName(parsed.meta, parsed.buffer)}`;
            services.set(key, (services.get(key) || 0) + 1);
        } else {
            metaMissing += 1;
        }
    });

    console.log(`[HAR] entries=${entries} wsFrames=${frames.length} written=${written} skipped=${skipped} noMeta=${metaMissing}`);
    console.log(`[输出] ${outDir}`);
    console.log('[连接]');
    for (const [host, count] of [...hostStats].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        console.log(`   ${String(count).padStart(4)} 帧  ${host}`);
    }
    console.log('[协议]');
    if (services.size === 0) console.log('   (没有解出 meta，检查导出的帧是否被截断)');
    for (const [key, count] of [...services].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
        console.log(`   ${String(count).padStart(4)}  ${key}`);
    }
}

main().catch((error) => {
    console.error('失败:', error.message);
    process.exit(1);
});
