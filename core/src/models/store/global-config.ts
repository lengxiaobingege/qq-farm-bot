import type { GlobalConfig, LoginSettings, EventNotify, SystemConfig, UIConfig } from '../../types/config';
export {};

const { DEFAULT_CLIENT_VERSION, DEFAULT_WX_CLIENT_VERSION, DEFAULT_TIME_ZONE, normalizeTimeZone, resolveClientVersionUpdatedAt } = require('../../config/config');

const sharedState = require('./shared-state');
const { isEncrypted, encryptValue, decryptValue } = require('../../utils/secret-crypto');

const {
    PUSHOO_CHANNELS,
    DEFAULT_EVENT_NOTIFY,
    DEFAULT_LOGIN_SETTINGS,
    globalConfig,
    normalizeAccountConfig,
    cloneAccountConfig,
    DEFAULT_ACCOUNT_CONFIG,
} = sharedState;

function normalizeEventNotify(input: unknown): EventNotify {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    let offlineDeleteSec = Number.parseInt(src.offlineDeleteSec, 10);
    if (!Number.isFinite(offlineDeleteSec) || offlineDeleteSec < 0) {
        offlineDeleteSec = DEFAULT_EVENT_NOTIFY.offlineDeleteSec;
    }
    const rawChannel = (src.channel !== undefined && src.channel !== null)
        ? String(src.channel).trim().toLowerCase()
        : '';
    const endpoint = (src.endpoint !== undefined && src.endpoint !== null)
        ? String(src.endpoint).trim()
        : DEFAULT_EVENT_NOTIFY.endpoint;
    const migratedChannel = rawChannel
        || (PUSHOO_CHANNELS.has(String(endpoint || '').trim().toLowerCase())
            ? String(endpoint || '').trim().toLowerCase()
            : DEFAULT_EVENT_NOTIFY.channel);
    const channel = PUSHOO_CHANNELS.has(migratedChannel)
        ? migratedChannel
        : DEFAULT_EVENT_NOTIFY.channel;
    // token / secret 在磁盘上以密文保存，读取时统一解密；历史明文自动兼容
    const rawToken = (src.token !== undefined && src.token !== null)
        ? String(src.token).trim()
        : DEFAULT_EVENT_NOTIFY.token;
    const token = isEncrypted(rawToken) ? decryptValue(rawToken) : rawToken;
    const rawSecret = (src.secret !== undefined && src.secret !== null)
        ? String(src.secret).trim()
        : DEFAULT_EVENT_NOTIFY.secret;
    const secret = isEncrypted(rawSecret) ? decryptValue(rawSecret) : rawSecret;
    let title = (src.title !== undefined && src.title !== null)
        ? String(src.title).trim()
        : DEFAULT_EVENT_NOTIFY.title;
    let msg = (src.msg !== undefined && src.msg !== null)
        ? String(src.msg).trim()
        : DEFAULT_EVENT_NOTIFY.msg;
    if (title === '账号下线提醒') title = DEFAULT_EVENT_NOTIFY.title;
    if (msg === '账号下线') msg = DEFAULT_EVENT_NOTIFY.msg;
    return {
        channel,
        endpoint,
        token,
        secret,
        title,
        msg,
        offlineDeleteSec,
    };
}

function saveGlobalConfig(changes: Partial<GlobalConfig> = {}): void {
    const next = { ...globalConfig, ...changes };
    const fallback = normalizeAccountConfig(next.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    next.defaultAccountConfig = cloneAccountConfig(fallback);
    // Publish memory only after persistence succeeds. Account documents have their
    // own write path, so a global setting never scans or serializes all accounts.
    sharedState.configStorage.saveGlobal(next);
    Object.assign(globalConfig, next);
    sharedState.accountFallbackConfig = fallback;
}

function getUI(): UIConfig {
    return { ...globalConfig.ui };
}

function setUITheme(theme: unknown): UIConfig {
    const t = String(theme || '').toLowerCase();
    const next: UIConfig['theme'] = (t === 'light') ? 'light' : 'dark';
    saveGlobalConfig({ ui: { ...globalConfig.ui, theme: next } });
    return getUI();
}

function getEventNotify(): EventNotify {
    return normalizeEventNotify(globalConfig.eventNotify);
}

function normalizeLoginSettings(input: unknown): LoginSettings {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    return {
        wechatQrLogin: typeof src.wechatQrLogin === 'boolean' ? src.wechatQrLogin : DEFAULT_LOGIN_SETTINGS.wechatQrLogin,
    };
}

function getLoginSettings(): LoginSettings {
    return normalizeLoginSettings(globalConfig.loginSettings);
}

function setLoginSettings(cfg: Partial<LoginSettings> | undefined): LoginSettings {
    const next = normalizeLoginSettings({ ...getLoginSettings(), ...(cfg || {}) });
    saveGlobalConfig({ loginSettings: next });
    return getLoginSettings();
}

function setEventNotify(cfg: Partial<EventNotify> | undefined): EventNotify {
    const current = normalizeEventNotify(globalConfig.eventNotify);
    const next = normalizeEventNotify({ ...current, ...(cfg || {}) });
    // 内存与返回值保持明文供运行时使用，落盘时替换为密文
    const persisted = {
        ...next,
        token: next.token ? encryptValue(next.token) : '',
        secret: next.secret ? encryptValue(next.secret) : '',
    };
    saveGlobalConfig({ eventNotify: persisted as EventNotify });
    return getEventNotify();
}

function getSystemConfig(): SystemConfig | null {
    return globalConfig.systemConfig ? { ...globalConfig.systemConfig } : null;
}

function setSystemConfig(config: Partial<SystemConfig> | undefined): SystemConfig | null {
    if (!config || typeof config !== 'object') return null;
    const DEFAULT_DEVICE_INFO = {
        os: 'Windows',
        clientVersion: DEFAULT_CLIENT_VERSION,
        sysSoftware: 'Windows',
        network: 'wifi',
        memory: '16384',
        deviceId: 'DESKTOP-PC<WPC>',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
    };
    const current = globalConfig.systemConfig;
    const srcDevice = {
        ...(current?.deviceInfo || {}),
        ...((config.deviceInfo && typeof config.deviceInfo === 'object') ? config.deviceInfo : {}),
    };
    const topVersion = String(config.clientVersion || '').trim();
    const deviceVersion = String(config.deviceInfo?.clientVersion || '').trim();
    const requestedVersion = deviceVersion || topVersion || current?.clientVersion;
    const clientVersion = requestedVersion || DEFAULT_DEVICE_INFO.clientVersion;
    const currentVersion = String(globalConfig.systemConfig?.clientVersion || DEFAULT_DEVICE_INFO.clientVersion).trim();
    const currentUpdatedAt = Number(globalConfig.systemConfig?.clientVersionUpdatedAt);
    const clientVersionUpdatedAt = resolveClientVersionUpdatedAt(
        clientVersion,
        currentVersion,
        currentUpdatedAt,
        config.clientVersionUpdatedAt,
    );
    // Older API clients may omit the new field; never copy the QQ version into it.
    const currentWxVersion = globalConfig.systemConfig?.wxClientVersion || DEFAULT_WX_CLIENT_VERSION;
    const wxClientVersion = config.wxClientVersion === undefined
        ? currentWxVersion : (String(config.wxClientVersion || '').trim() || DEFAULT_WX_CLIENT_VERSION);
    const wxClientVersionUpdatedAt = resolveClientVersionUpdatedAt(
        wxClientVersion, currentWxVersion, globalConfig.systemConfig?.wxClientVersionUpdatedAt,
        config.wxClientVersionUpdatedAt, Date.now(), 'wx',
    );
    const deviceInfo = {
        os: String((srcDevice as any).os || DEFAULT_DEVICE_INFO.os).trim(),
        clientVersion,
        sysSoftware: String((srcDevice as any).sysSoftware || DEFAULT_DEVICE_INFO.sysSoftware).trim(),
        network: String((srcDevice as any).network || DEFAULT_DEVICE_INFO.network).trim(),
        memory: String((srcDevice as any).memory || DEFAULT_DEVICE_INFO.memory).trim(),
        deviceId: String((srcDevice as any).deviceId || DEFAULT_DEVICE_INFO.deviceId).trim(),
        userAgent: String((srcDevice as any).userAgent || DEFAULT_DEVICE_INFO.userAgent).trim(),
    };
    const next: SystemConfig = {
        serverUrl: String(config.serverUrl ?? current?.serverUrl ?? '').trim(),
        clientVersion: deviceInfo.clientVersion,
        clientVersionUpdatedAt,
        wxClientVersion,
        wxClientVersionUpdatedAt,
        platform: String(config.platform || current?.platform || 'qq').trim(),
        os: deviceInfo.os,
        timeZone: normalizeTimeZone(config.timeZone || current?.timeZone || DEFAULT_TIME_ZONE),
        deviceInfo,
    };
    saveGlobalConfig({ systemConfig: next });
    return { ...globalConfig.systemConfig };
}

// Initialize on load
const { loadGlobalConfig } = sharedState;
loadGlobalConfig();
// Apply eventNotify normalization after load
globalConfig.eventNotify = normalizeEventNotify(globalConfig.eventNotify);
globalConfig.loginSettings = normalizeLoginSettings(globalConfig.loginSettings);
if (sharedState.systemConfigMigrated && !process.env.FARM_ACCOUNT_ID) {
    saveGlobalConfig();
    sharedState.systemConfigMigrated = false;
}

module.exports = {
    saveGlobalConfig,
    getUI,
    setUITheme,
    getLoginSettings,
    setLoginSettings,
    getEventNotify,
    setEventNotify,
    getSystemConfig,
    setSystemConfig,
};
