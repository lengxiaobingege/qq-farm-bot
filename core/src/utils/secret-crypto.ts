export {};
/**
 * 本地敏感配置加密（推送 Token 等）。
 *
 * 使用 AES-256-GCM，密钥存放在数据目录下的 .secret.key（权限 600），
 * 与配置文件分离保存。密文格式：enc:v1:<iv hex>:<tag hex>:<ciphertext hex>。
 *
 * 边界说明：程序运行时必须能解密，因此密钥与密文同机存放。
 * 该方案防的是「配置文件副本外泄」（备份、误提交、截图、日志），
 * 无法防御已完全控制宿主机的攻击者。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');

const KEY_FILE: string = getDataFile('.secret.key');
const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

function parseKey(raw: string): Buffer | null {
    const text = String(raw || '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(text)) return null;
    return Buffer.from(text, 'hex');
}

function readOrCreateKey(): Buffer {
    if (cachedKey) return cachedKey;
    ensureDataDir();
    try {
        const existing = parseKey(fs.readFileSync(KEY_FILE, 'utf8'));
        if (existing) {
            cachedKey = existing;
            return existing;
        }
    } catch { /* 文件不存在或不可读时重新生成 */ }
    const created = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, created.toString('hex'), { mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* 部分文件系统不支持 */ }
    cachedKey = created;
    return created;
}

function isEncrypted(value: unknown): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptValue(plain: string): string {
    const text = String(plain ?? '');
    if (!text) return '';
    const key = readOrCreateKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${data.toString('hex')}`;
}

function decryptValue(stored: string): string {
    const text = String(stored ?? '');
    if (!text) return '';
    // 兼容历史明文：未带前缀的值按原文返回，下次保存时自动转为密文
    if (!isEncrypted(text)) return text;
    try {
        const parts = text.slice(PREFIX.length).split(':');
        if (parts.length !== 3) return '';
        const [ivHex, tagHex, dataHex] = parts;
        const key = readOrCreateKey();
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
        // 密钥丢失或密文被篡改：返回空值，调用方按「未配置」处理，避免抛出中断流程
        return '';
    }
}

/** 生成用于展示的掩码，例如 f7389b…b5b，不泄露完整值 */
function maskValue(plain: string): string {
    const text = String(plain ?? '').trim();
    if (!text) return '';
    if (text.length <= 8) return `${text.slice(0, 2)}${'*'.repeat(Math.max(2, text.length - 2))}`;
    return `${text.slice(0, 6)}…${text.slice(-3)}`;
}

module.exports = {
    KEY_FILE,
    isEncrypted,
    encryptValue,
    decryptValue,
    maskValue,
};
