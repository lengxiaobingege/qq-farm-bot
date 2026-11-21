#!/usr/bin/env node
'use strict';

/**
 * 管理员登录救援工具（运维用，需要文件系统访问权限）。
 *
 * 使用场景：
 *  - 导入旧数据后，受信任设备列表来自旧机器的浏览器，当前浏览器拿不到验证码，也收不到推送；
 *  - 推送渠道未配置 / 失效，验证码发不出去，人卡在登录页。
 *
 * 用法：
 *   node tools/admin-rescue.js                # 查看当前状态
 *   node tools/admin-rescue.js --reset-trust  # 备份后清空受信任设备与会话（重置后首次登录自动引导）
 *
 * 说明：清空后必须重启服务（会话缓存也在内存里），随后用密码登录即会走「首台设备引导」自动信任。
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.ADMIN_DATA_DIR || path.join(__dirname, '..', 'core', 'data');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'admin-sessions.json');

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function status() {
    const admin = readJson(ADMIN_FILE, {});
    const devices = admin?.admin?.trustedDevices || [];
    const sessions = readJson(SESSIONS_FILE, {}).sessions || [];
    const now = Date.now();
    const alive = sessions.filter(s => !s.expiresAt || s.expiresAt > now);
    console.log('数据目录:', DATA_DIR);
    console.log('受信任设备:', devices.length, devices.length ? `（最近更新 ${devices.map(d => d.lastSeenAt || d.createdAt || '-').slice(-1)[0]}）` : '');
    console.log('会话总数:', sessions.length, '| 未过期:', alive.length);
    console.log('');
    if (devices.length || alive.length) {
        console.log('结论：存在受信任设备或活跃会话，新浏览器登录需要验证码。');
        console.log('若收不到验证码，执行：node tools/admin-rescue.js --reset-trust && systemctl restart qq-farm-bot');
    }
    else {
        console.log('结论：没有受信任设备，下次密码登录会自动完成首台设备引导。');
    }
}

function resetTrust() {
    const ts = stamp();
    const admin = readJson(ADMIN_FILE, null);
    if (!admin) {
        console.error('读取 admin.json 失败:', ADMIN_FILE);
        process.exit(1);
    }
    const devices = admin?.admin?.trustedDevices || [];
    if (devices.length) {
        fs.copyFileSync(ADMIN_FILE, `${ADMIN_FILE}.bak-${ts}`);
        admin.admin.trustedDevices = [];
        fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2), { mode: 0o600 });
        console.log(`已清空 ${devices.length} 台受信任设备（备份 admin.json.bak-${ts}）`);
    }
    else {
        console.log('没有受信任设备，跳过');
    }

    if (fs.existsSync(SESSIONS_FILE)) {
        const sessions = readJson(SESSIONS_FILE, { sessions: [] }).sessions || [];
        if (sessions.length) {
            fs.copyFileSync(SESSIONS_FILE, `${SESSIONS_FILE}.bak-${ts}`);
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ version: 2, sessions: [], savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
            console.log(`已清空 ${sessions.length} 条会话（备份 admin-sessions.json.bak-${ts}）`);
        }
    }

    console.log('');
    console.log('下一步：systemctl restart qq-farm-bot，然后用密码登录，会自动完成首台设备引导。');
    console.log('提示：密码本身不会被重置；如需改密码，登录后在设置页修改。');
}

const args = process.argv.slice(2);
if (args.includes('--reset-trust')) resetTrust();
else if (args.includes('--help') || args.includes('-h')) {
    console.log('用法: node tools/admin-rescue.js [--reset-trust]');
}
else status();
