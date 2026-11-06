export {};
/**
 * 自动登录：从已保存微信凭证循环换取 Code 并建立连接，失败达上限提示前端扫码。
 */
const { st, AUTO_LOGIN_MAX_FAILS, AUTO_LOGIN_RETRY_DELAY_MS } = require('./state');
const { WX_FARM_APP_ID, WxLoginService, credentialsFromAccount } = require('../../services/wx-login/service');
const { connect } = require('../../utils/network');
const { log } = require('../../utils/utils');
const { sendToMaster, exitWorker } = require('./channel');

async function attemptAutoLogin(wxOpenId: string, wxAccessToken: string, wxRefreshToken: string, loginBuffer: string, canContinueLogin: () => boolean, onLoginSuccess: () => Promise<void>): Promise<void> {
    const wxLogin = new WxLoginService();
    const credentials = credentialsFromAccount({ wxOpenId, wxAccessToken, wxRefreshToken, loginBuffer });
    const buffer = String(loginBuffer || '').trim();

    async function tryOnce(): Promise<void> {
        if (!canContinueLogin() || st.shutdownStarted) return;
        st.autoLoginFailCount += 1;
        log('系统', `自动登录尝试第 ${st.autoLoginFailCount} 次：从已保存微信凭证换取 Code`, { attempt: st.autoLoginFailCount });
        try {
            const wxLogin = new WxLoginService();
            const credentials = credentialsFromAccount({ wxOpenId, wxAccessToken, wxRefreshToken, loginBuffer });
            const issued = await wxLogin.issueCodeFromLoginBuffer(buffer, WX_FARM_APP_ID, credentials);
            let issuedCode: string, source: string;
            if (typeof issued === 'string') {
                issuedCode = String(issued || '').trim();
                source = 'local';
            } else {
                issuedCode = String(issued?.code || '').trim();
                source = issued?.source || 'local';
            }
            if (!issuedCode) throw new Error('empty wx login code');
            if (!canContinueLogin() || st.shutdownStarted) return;
            log('系统', `自动登录已获取 Code，正在建立连接`, { attempt: st.autoLoginFailCount, source });
            connect(issuedCode, onLoginSuccess);
        } catch (error: any) {
            const message = String(error?.message || error || '未知错误');
            log('错误', `自动登录换取 Code 失败: ${message}`, { attempt: st.autoLoginFailCount, error: message });
            if (!canContinueLogin() || st.shutdownStarted) return;
            if (st.autoLoginFailCount >= AUTO_LOGIN_MAX_FAILS) {
                log('系统', `自动登录已连续失败 ${AUTO_LOGIN_MAX_FAILS} 次，停止重试并提示前端扫码`);
                sendToMaster({
                    type: 'need_wx_scan',
                    accountId: process.env.FARM_ACCOUNT_ID || '',
                    accountName: '',
                });
                require("./lifecycle").quiesceBot(`自动登录失败达上限，需扫码`);
                setTimeout(exitWorker, 300, 0);
                return;
            }
            st.autoLoginRetryTimer = setTimeout(() => {
                tryOnce();
            }, AUTO_LOGIN_RETRY_DELAY_MS);
        }
    }

    tryOnce();
}
module.exports = { attemptAutoLogin };
