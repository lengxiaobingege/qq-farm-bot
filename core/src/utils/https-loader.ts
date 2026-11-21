export {};
/**
 * 面板 HTTPS 凭据加载（可选特性）。
 *
 * 设计原则：
 *  - 未设置 HTTPS_KEY / HTTPS_CERT 时完全返回未启用，行为与改造前一致，不影响现有部署；
 *  - 一旦设置，就按「安全意图明确」处理：任何一项校验失败都**拒绝启动**，
 *    而不是静默降级成 HTTP —— 静默降级会让人误以为面板在加密传输，比明文更危险。
 *    确实需要容忍时显式设置 HTTPS_OPTIONAL=1；
 *  - 私钥支持带口令（HTTPS_PASSPHRASE），口令只走环境变量，不落盘、不打日志。
 *
 * 环境变量：
 *   HTTPS_KEY          私钥 PEM 路径（必填，与 HTTPS_CERT 成对）
 *   HTTPS_CERT         证书 PEM 路径
 *   HTTPS_CA           可选，中间/根 CA 链 PEM，用于客户端证书校验或补全链
 *   HTTPS_PASSPHRASE   可选，私钥口令
 *   HTTPS_OPTIONAL     设为 1 时，校验失败降级 HTTP 而不是拒启
 *   HTTPS_HSTS         设为 1 时下发 Strict-Transport-Security
 *   HTTPS_HSTS_MAX_AGE HSTS 有效期秒数，默认 86400（一天，便于回退）
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

export interface HttpsCredentials {
    key: string;
    cert: string;
    ca?: string;
    passphrase?: string;
}

export interface HttpsLoadResult {
    enabled: boolean;
    credentials: HttpsCredentials | null;
    error: string | null;
    warnings: string[];
}

const PEM_MARKER = '-----BEGIN';

function readPem(filePath: string, label: string, warnings: string[], sensitive: boolean = false): string {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        throw new Error(`${label} 文件不存在或不可访问: ${filePath}`);
    }
    if (!stat.isFile()) throw new Error(`${label} 路径不是普通文件: ${filePath}`);
    // 只有私钥需要保密；证书与 CA 链本就是公开材料，644 是正常权限
    if (sensitive && (stat.mode & 0o077) !== 0) {
        // 不阻断（否则权限设错会让整个面板起不来），但同机其他用户可读必须提示
        warnings.push(`${label} 权限过宽（建议 chmod 600）: ${filePath}`);
    }
    let content = '';
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        throw new Error(`${label} 读取失败: ${filePath}`);
    }
    if (!content.includes(PEM_MARKER)) {
        throw new Error(`${label} 不是 PEM 格式（缺少 -----BEGIN 头）: ${filePath}`);
    }
    return content;
}

/**
 * 加载并校验 HTTPS 凭据。
 *
 * @returns enabled=false 表示未配置；error 非空表示配置了但不可用
 */
function loadHttpsCredentials(env: Record<string, string | undefined> = process.env): HttpsLoadResult {
    const warnings: string[] = [];
    const keyPath = String(env.HTTPS_KEY || '').trim();
    const certPath = String(env.HTTPS_CERT || '').trim();
    const caPath = String(env.HTTPS_CA || '').trim();
    const passphrase = env.HTTPS_PASSPHRASE ? String(env.HTTPS_PASSPHRASE) : undefined;

    if (!keyPath && !certPath) {
        return { enabled: false, credentials: null, error: null, warnings };
    }
    if (!keyPath || !certPath) {
        return {
            enabled: false,
            credentials: null,
            error: 'HTTPS_KEY 与 HTTPS_CERT 必须成对设置',
            warnings,
        };
    }

    let key: string;
    let cert: string;
    let ca: string | undefined;
    try {
        key = readPem(keyPath, 'HTTPS_KEY', warnings, true);
        cert = readPem(certPath, 'HTTPS_CERT', warnings);
        if (caPath) ca = readPem(caPath, 'HTTPS_CA', warnings);
    } catch (error: any) {
        return { enabled: false, credentials: null, error: error?.message || String(error), warnings };
    }

    // 私钥可解析性 + 口令正确性
    let privateKey;
    try {
        privateKey = crypto.createPrivateKey({ key, passphrase });
    } catch {
        return {
            enabled: false,
            credentials: null,
            error: passphrase
                ? 'HTTPS_KEY 解析失败：私钥口令错误或文件损坏'
                : 'HTTPS_KEY 解析失败：私钥文件损坏，或该私钥带口令但未设置 HTTPS_PASSPHRASE',
            warnings,
        };
    }

    // 证书可解析性
    let x509;
    try {
        x509 = new crypto.X509Certificate(cert);
    } catch {
        return { enabled: false, credentials: null, error: 'HTTPS_CERT 解析失败：证书文件损坏或不是 X.509 证书', warnings };
    }

    // 私钥与证书必须配对，否则握手必然失败（提前报错比运行时报 TLS alert 好定位）
    try {
        if (typeof x509.checkPrivateKey === 'function' && !x509.checkPrivateKey(privateKey)) {
            return { enabled: false, credentials: null, error: 'HTTPS_KEY 与 HTTPS_CERT 不匹配（私钥与证书不是一对）', warnings };
        }
    } catch {
        warnings.push('私钥与证书配对性校验不可用（Node 版本过低），已跳过');
    }

    // 有效期
    const now = Date.now();
    const validFrom = Date.parse(x509.validFrom);
    const validTo = Date.parse(x509.validTo);
    if (!Number.isNaN(validTo) && validTo < now) {
        return {
            enabled: false,
            credentials: null,
            error: `HTTPS_CERT 已过期（有效期至 ${x509.validTo}），请重新签发`,
            warnings,
        };
    }
    if (!Number.isNaN(validFrom) && validFrom > now) {
        return {
            enabled: false,
            credentials: null,
            error: `HTTPS_CERT 尚未生效（生效时间 ${x509.validFrom}），请检查系统时间或证书`,
            warnings,
        };
    }
    const daysLeft = Number.isNaN(validTo) ? null : Math.floor((validTo - now) / 86400000);
    if (daysLeft !== null && daysLeft <= 14) {
        warnings.push(`HTTPS_CERT 将在 ${daysLeft} 天后过期（${x509.validTo}）`);
    }

    // 自签证书提示：不是错误，但用户需要知道浏览器会怎么表现
    const selfSigned = String(x509.issuer || '') === String(x509.subject || '');
    if (selfSigned) {
        warnings.push('检测到自签证书：浏览器首次访问会提示不受信任，需导入根证书或手动信任');
    }

    if (ca) {
        try {
            // 校验 CA 至少能被解析（可能是多段链，这里只取首段）
            const parsedCa = new crypto.X509Certificate(ca);
            if (!parsedCa.raw) throw new Error('empty');
        } catch {
            warnings.push('HTTPS_CA 解析失败，已忽略该链文件');
            ca = undefined;
        }
    }

    return {
        enabled: true,
        credentials: { key, cert, ca, passphrase },
        error: null,
        warnings,
    };
}

/** HSTS 响应头取值；未开启返回空串，便于中间件直接判断 */
function resolveHstsHeader(env: Record<string, string | undefined> = process.env): string {
    if (String(env.HTTPS_HSTS || '') !== '1') return '';
    const raw = Number(env.HTTPS_HSTS_MAX_AGE);
    const maxAge = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 86400;
    return `max-age=${maxAge}`;
}

module.exports = { loadHttpsCredentials, resolveHstsHeader };
