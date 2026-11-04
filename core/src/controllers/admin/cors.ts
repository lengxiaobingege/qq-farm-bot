export {};
/**
 * 管理面板的跨域策略（HTTP + Socket.IO 共用）。
 *
 * 旧实现把任意 Origin 回显并同时允许凭据，等于任何站点都能带凭据访问管理 API；
 * 无 Origin 时又返回 `Access-Control-Allow-Origin: *` 与 credentials:true 的非法组合。
 * 现在改为：仅允许显式白名单或与当前 Host 同源的来源，其余跨域请求直接 403。
 *
 * 白名单来源（合并去重）：
 *   - 内置本地开发地址（Vite 5173/5174、面板 3000/3007）
 *   - CONFIG.ALLOWED_ORIGINS（若配置）
 *   - 环境变量 CORS_ALLOWED_ORIGINS，逗号分隔，用于自定义域名
 */
const { URL } = require('node:url');
const { CONFIG } = require('../../config/config');

const DEFAULT_LOCAL_ORIGINS: string[] = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3007',
    'http://127.0.0.1:3007',
];

function getAllowedOrigins(): string[] {
    const fromConfig: string[] = Array.isArray(CONFIG.ALLOWED_ORIGINS) ? CONFIG.ALLOWED_ORIGINS : [];
    const fromEnv: string[] = String(process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((item: string) => item.trim().replace(/\/$/, ''))
        .filter(Boolean);
    return Array.from(new Set([
        ...DEFAULT_LOCAL_ORIGINS,
        ...fromConfig.map((item: string) => String(item).trim().replace(/\/$/, '')).filter(Boolean),
        ...fromEnv,
    ]));
}

function isSameOrigin(origin: string, hostHeader: string): boolean {
    try {
        const parsed = new URL(origin);
        const host = String(hostHeader || '').trim().toLowerCase();
        if (!host) return false;
        return String(parsed.host || '').toLowerCase() === host;
    } catch {
        return false;
    }
}

/** 判断来源是否被允许；无 Origin（同源/非浏览器请求）一律放行。 */
function isOriginAllowed(origin?: string, hostHeader?: string): boolean {
    if (!origin) return true;
    if (getAllowedOrigins().includes(origin)) return true;
    return isSameOrigin(origin, hostHeader || '');
}

/**
 * 写入 CORS 响应头。
 *
 * 注意：对未允许的来源不做服务端 403 —— 发布平台等反向代理会改写 Host，
 * 依赖 Origin/Host 匹配做硬拒绝会误伤正常访问。正确做法是不回显 ACAO，
 * 由浏览器拒绝跨域 JS 读取响应（对非浏览器客户端 CORS 本就不设防）。
 *
 * @returns true 表示请求可继续；false 表示已自行结束响应（预检）。
 */
function applyCors(req: any, res: any): boolean {
    const origin: string | undefined = req.headers && req.headers.origin;
    const host: string | undefined = req.headers && req.headers.host;
    const allowed = isOriginAllowed(origin, host);

    // 按 Origin 区分缓存，避免代理把某个来源的响应错发给其他来源
    res.header('Vary', 'Origin');

    if (origin && allowed) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token, x-proxy-api-key, x-proxy-api-url, x-proxy-app-id');
    res.header('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        // 预检：未允许的来源不回显 ACAO，浏览器预检会自然失败
        res.sendStatus(204);
        return false;
    }
    return true;
}

module.exports = { getAllowedOrigins, isOriginAllowed, applyCors };
