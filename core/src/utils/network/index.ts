const connectionMod: typeof import('./connection') = require('./connection');
const loginMod: typeof import('./login') = require('./login');
const keepaliveMod: typeof import('./keepalive') = require('./keepalive');
const codecMod: typeof import('./codec') = require('./codec');
const queueMod: typeof import('./queue') = require('./queue');
const typesMod: typeof import('./types') = require('./types');
const sessionMod: typeof import('./session') = require('./session');
const stateMod: typeof import('./state') = require('./state');
// 对外导出与拆分前 src/utils/network.ts 完全一致；require 路径仍是 utils/network。
const { connect, cleanup, getWs } = connectionMod;
const { buildLoginBody } = loginMod;
const { buildHeartbeatBody } = keepaliveMod;
const { sendMsgAsync, sendMsgNoReply } = codecMod;
const { getGatewayLoad, isGatewayIdleForBackground, waitForGatewayIdle } = queueMod;
const { GatewayError, GatewayBusyError } = typesMod;
const { getUserState, getWsErrorState } = sessionMod;
const { S } = stateMod;

const networkEvents = S.events;

export {
    connect, cleanup, getWs,
    buildLoginBody, buildHeartbeatBody,
    sendMsgAsync, sendMsgNoReply,
    getGatewayLoad, isGatewayIdleForBackground, waitForGatewayIdle,
    GatewayError, GatewayBusyError,
    getUserState,
    getWsErrorState,
    networkEvents,
};
