const connectionMod: typeof import('./connection') = require('./connection');
const loginMod: typeof import('./login') = require('./login');
const keepaliveMod: typeof import('./keepalive') = require('./keepalive');
const codecMod: typeof import('./codec') = require('./codec');
const queueMod: typeof import('./queue') = require('./queue');
const typesMod: typeof import('./types') = require('./types');
const sessionMod: typeof import('./session') = require('./session');
const stateMod: typeof import('./state') = require('./state');
const sceneMod: typeof import('./scene') = require('./scene');
// 对外导出与拆分前 src/utils/network.ts 完全一致；require 路径仍是 utils/network。
const { connect, cleanup, getWs } = connectionMod;
const { buildLoginBody } = loginMod;
const { buildHeartbeatBody } = keepaliveMod;
const { sendMsgAsync, sendMsgNoReply } = codecMod;
const { getGatewayLoad, isGatewayIdleForBackground, waitForGatewayIdle } = queueMod;
const { GatewayError, GatewayBusyError } = typesMod;
const { getUserState, getWsErrorState } = sessionMod;
const { loginGameScene, invalidateGameScene, applyShareInfos, getDailyShareInfo } = sceneMod;
const { S } = stateMod;

const networkEvents = S.events;

export {
    applyShareInfos, buildHeartbeatBody, buildLoginBody,
    cleanup, connect,
    GatewayBusyError, GatewayError,
    getDailyShareInfo, getGatewayLoad, getUserState,
    getWs, getWsErrorState,
    invalidateGameScene,
    isGatewayIdleForBackground, loginGameScene, networkEvents, sendMsgAsync,
    sendMsgNoReply,
    waitForGatewayIdle,
};
