// 网络层门面：具体实现见 src/utils/network/（state/queue/codec/messages/login/keepalive/connection）。
// 保留单文件入口是为了 require 路径稳定（core 内多处 require('./utils/network')）。
module.exports = require('./network/index');
