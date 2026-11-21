export {};
/**
 * 数据目录敏感文件权限巡检：
 * 历史版本可能以 0644 写出含登录态/凭证的 JSON，这里在 master 启动时统一收紧到 0600，
 * 并对以后每次写入做防线（写入侧见 json-db.writeTextFileAtomic 的 mode 参数）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { getDataFile } = require('../config/runtime-paths');

// 相对 core/data 的敏感文件名清单
const SENSITIVE_FILES = [
    'accounts.json',       // loginBuffer / refresh token 等登录态
    'admin.json',          // 管理员密码哈希
    'admin-sessions.json', // 会话令牌
    'login-attempts.json', // 登录来源记录
    'store.json',          // 全局配置（含加密后的推送 token）
    '.secret.key',         // AES 加密密钥
];

function tightenDataFilePerms(): void {
    for (const name of SENSITIVE_FILES) {
        const filePath = getDataFile(name);
        try {
            if (!fs.existsSync(filePath)) continue;
            fs.chmodSync(filePath, 0o600);
        } catch (error: any) {
            console.error(`[安全巡检] 收紧 ${path.basename(filePath)} 权限失败:`, error?.message || error);
        }
    }
}

module.exports = { tightenDataFilePerms, SENSITIVE_FILES };
