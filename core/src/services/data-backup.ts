export {};
/**
 * 数据目录每日加密备份：
 * - 每日 03:00（北京时间）把 core/data 打包为 AES-256-GCM 加密压缩包
 * - 产物存放在 core/data/backups/，保留最近 7 份
 * - 内容为纯 JSON/文本文件的容器（可移植，不依赖 tar/zip 命令）
 * - 日志与备份目录自身不参与备份
 * - 加密密钥由 .secret.key 经 scrypt 派生（与业务加密密钥隔离）
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { ensureDataDir, getDataFile } = require('../config/runtime-paths');

const BACKUP_DIR_NAME = 'backups';
const MAGIC = Buffer.from('QFBK1');
const KEEP_COUNT = 7;
const BACKUP_HOUR = 3; // 北京时间每天 3 点
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 每 10 分钟检查一次是否到点
const SKIP_DIRS = new Set(['logs', BACKUP_DIR_NAME]);
const SKIP_FILES = new Set(['app_dev.log', 'app_dev.pid']);

function getBackupDir(): string {
    const dir = path.join(ensureDataDir(), BACKUP_DIR_NAME);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function getBeijingDateKey(now = new Date()): string {
    const b = new Date(now.getTime() + 8 * 3600 * 1000);
    return `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, '0')}-${String(b.getUTCDate()).padStart(2, '0')}`;
}

function getBeijingHour(now = new Date()): number {
    const b = new Date(now.getTime() + 8 * 3600 * 1000);
    return b.getUTCHours();
}

/** 递归收集数据目录下的普通文件（相对路径），跳过 logs 与备份目录 */
function collectFiles(rootDir: string, rel = ''): string[] {
    const out: string[] = [];
    const abs = rel ? path.join(rootDir, rel) : rootDir;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            out.push(...collectFiles(rootDir, rel ? `${rel}/${entry.name}` : entry.name));
        } else if (entry.isFile()) {
            if (SKIP_FILES.has(entry.name) || entry.name.endsWith('.tmp')) continue;
            out.push(rel ? `${rel}/${entry.name}` : entry.name);
        }
    }
    return out;
}

function deriveBackupKey(): Buffer | null {
    try {
        // 全新环境可能还没有密钥文件，先确保其存在（复用 secret-crypto 的生成逻辑）
        require('../utils/secret-crypto').readOrCreateKey();
        const keyHex = fs.readFileSync(getDataFile('.secret.key'), 'utf8').trim();
        if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) return null;
        // 与业务加密密钥隔离：scrypt 派生独立子密钥（盐随每次备份随机）
        return keyHex ? crypto.createHash('sha256').update(Buffer.from(keyHex, 'hex')).digest() : null;
    } catch {
        return null;
    }
}

function listBackups(dir: string): string[] {
    try {
        return fs.readdirSync(dir)
            .filter((n: string) => n.startsWith('data-backup-') && n.endsWith('.enc'))
            .sort((a: string, b: string) => {
                const sa = fs.statSync(path.join(dir, a));
                const sb = fs.statSync(path.join(dir, b));
                return sb.mtimeMs - sa.mtimeMs;
            });
    } catch {
        return [];
    }
}

function createBackup(reason = 'scheduled'): { ok: boolean; file?: string; error?: string; skipped?: boolean } {
    try {
        const dataDir = ensureDataDir();
        const backupKey = deriveBackupKey();
        if (!backupKey) return { ok: false, error: '.secret.key 缺失或格式异常，无法派生备份密钥' };

        const files: Record<string, string> = {};
        for (const rel of collectFiles(dataDir)) {
            files[rel] = fs.readFileSync(path.join(dataDir, rel)).toString('base64');
        }
        const container = Buffer.from(JSON.stringify({
            version: 1,
            createdAt: getBeijingDateKey(),
            reason,
            fileCount: Object.keys(files).length,
            files,
        }), 'utf8');

        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(12);
        const encKey = crypto.scryptSync(backupKey, salt, 32);
        const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
        const payload = Buffer.concat([cipher.update(zlib.gzipSync(container)), cipher.final()]);
        const tag = cipher.getAuthTag();

        const outPath = path.join(getBackupDir(), `data-backup-${getBeijingDateKey()}.enc`);
        // 同一天重复触发只保留最新（原子写 + 0600）
        const tmp = `${outPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, Buffer.concat([MAGIC, salt, iv, tag, payload]), { mode: 0o600 });
        fs.renameSync(tmp, outPath);

        // 清理旧备份，保留最近 KEEP_COUNT 份
        const all = listBackups(getBackupDir());
        for (const stale of all.slice(KEEP_COUNT)) {
            try { fs.unlinkSync(path.join(getBackupDir(), stale)); } catch { /* ignore */ }
        }
        return { ok: true, file: outPath };
    } catch (error: any) {
        return { ok: false, error: error?.message || String(error) };
    }
}

let lastRunDate: string | null = null;
let lastFailDate: string | null = null;
let timer: any = null;

function backupTick(): void {
    try {
        const today = getBeijingDateKey();
        if (lastRunDate === today) return;
        if (getBeijingHour() < BACKUP_HOUR) return;
        // 已存在当天备份则视为完成，避免异常重启后重复打包
        const existing = listBackups(getBackupDir()).find((n: string) => n.startsWith(`data-backup-${today}`));
        if (existing) {
            lastRunDate = today;
            return;
        }
        const result = createBackup('scheduled');
        if (result.ok) {
            lastRunDate = today;
            console.log(`[数据备份] 已完成: ${path.basename(result.file!)}`);
        } else {
            // 失败时每天只报一次，避免每 10 分钟刷屏
            if (lastFailDate !== today) {
                lastFailDate = today;
                console.error('[数据备份] 失败:', result.error);
            }
        }
    } catch (error: any) {
        console.error('[数据备份] 调度异常:', error?.message || error);
    }
}

/** master 启动时调用：注册每日备份定时器 */
function startDataBackupScheduler(): void {
    if (timer) return;
    backupTick(); // 启动时若已过 3 点且无当日备份，立即补一次
    timer = setInterval(backupTick, CHECK_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
}

function stopDataBackupScheduler(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

module.exports = { createBackup, startDataBackupScheduler, stopDataBackupScheduler, getBackupDir, getBeijingDateKey, listBackups };
