#!/usr/bin/env node
/**
 * 恢复数据备份：把 core/data/backups/data-backup-*.enc 解密还原到 core/data。
 *
 * 用法：
 *   node tools/restore-data-backup.js                # 恢复最近一份备份
 *   node tools/restore-data-backup.js 2026-11-06     # 恢复指定日期的备份
 *   node tools/restore-data-backup.js --list         # 仅列出可用备份
 *
 * 说明：
 * - 恢复前会自动把当前 core/data 复制为 core/data.pre-restore-<时间戳>/，防止误操作丢数据
 * - 需要使用 core/data/.secret.key 派生的密钥解密，请勿删除该文件
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(repoRoot, 'core', 'data');
const backupDir = path.join(dataDir, 'backups');
const MAGIC = Buffer.from('QFBK1');

function deriveBackupKey() {
    const keyHex = fs.readFileSync(path.join(dataDir, '.secret.key'), 'utf8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('.secret.key 缺失或格式异常');
    return crypto.createHash('sha256').update(Buffer.from(keyHex, 'hex')).digest();
}

function listBackups() {
    return fs.readdirSync(backupDir)
        .filter(n => n.startsWith('data-backup-') && n.endsWith('.enc'))
        .map(n => ({
            name: n,
            date: n.slice('data-backup-'.length, -'.enc'.length),
            mtime: fs.statSync(path.join(backupDir, n)).mtime,
        }))
        .sort((a, b) => b.mtime - a.mtime);
}

function decryptBackup(file) {
    const raw = fs.readFileSync(file);
    if (!raw.subarray(0, 5).equals(MAGIC)) throw new Error('文件头不匹配，不是有效的备份文件');
    const salt = raw.subarray(5, 21);
    const iv = raw.subarray(21, 33);
    const tag = raw.subarray(33, 49);
    const payload = raw.subarray(49);
    const encKey = crypto.scryptSync(deriveBackupKey(), salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(tag);
    const container = JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(payload), decipher.final()])).toString('utf8'));
    if (!container || container.version !== 1 || !container.files) throw new Error('容器格式不受支持');
    return container;
}

function restore(file) {
    const container = decryptBackup(file);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const preRestoreDir = `${dataDir}.pre-restore-${stamp}`;
    console.log(`恢复前快照: ${preRestoreDir}`);
    fs.cpSync(dataDir, preRestoreDir, { recursive: true });

    let restored = 0;
    for (const [rel, b64] of Object.entries(container.files)) {
        const target = path.join(dataDir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(String(b64), 'base64'));
        restored++;
    }
    console.log(`恢复完成: ${restored} 个文件（备份时间 ${container.createdAt}，原因 ${container.reason || '未知'}）`);
    console.log('如需回滚，把', preRestoreDir, '内容覆盖回', dataDir, '即可');
}

function main() {
    const arg = process.argv[2];
    const backups = listBackups();
    if (arg === '--list' || backups.length === 0) {
        console.log('可用备份:');
        for (const b of backups) console.log(`  ${b.date}  ${b.name}`);
        if (backups.length === 0) console.log('  （无）');
        if (arg === '--list') return;
    }
    const target = arg
        ? backups.find(b => b.date === arg) || (() => { throw new Error(`未找到日期为 ${arg} 的备份`); })()
        : backups[0];
    console.log(`将恢复: ${target.name}`);
    restore(path.join(backupDir, target.name));
}

main();
