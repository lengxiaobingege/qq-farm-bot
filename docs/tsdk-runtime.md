# TSDK 运行约定

TSDK 是官方加密/鉴权的 WASM。本文说明当前用的构建、Node 宿主怎么喂它、关键 ABI、网关 Token 规则和 ACE 生命周期。

改动这里之前先读完整篇：**版本号与 SHA-256 写死在代码里，换 WASM 必须同步改常量，否则启动直接失败。**

## 一、当前构建

| 平台 | 文件 | 版本 | 大小 | SHA-256 |
| --- | --- | --- | --- | --- |
| 微信 | `core/src/utils/tsdk-wx.wasm` | `v3.9.0.1794837963` | 160,956 B | `d14a4f5d59c8a27128019dbad25fe3cd3d5243dfc389eb9bcbb345efb1cebc9a` |
| QQ | `core/src/utils/tsdk.wasm` | `v3.9.0.1794737607` | 161,118 B | `ab6eb0f0ee86ce8984b0c37a481ff51e7722961ff0b50a9f91e2fa9ff351ce74` |

常量位置：`utils/tsdk-runtime.ts` 的 `TSDK_BUILDS`，回归测试里的审计常量在 `core/tests/tsdk-runtime.test.js`，两边必须一致。

固定参数：

| 项 | 值 |
| --- | --- |
| 微信 App ID | `wx5306c5978fdb76e4` |
| QQ App ID | `1112386029` |
| TSDK gameId | `3167` |
| appKey | `0` |

本仓库**只保留微信端**，QQ 那套常量留着是为了兼容上游代码与测试，运行时不走。

## 二、宿主映射

WASM 导入 `a.a` ~ `a.v`，由 `utils/tsdk-runtime.ts` 按官方 `tsdk.js` 提供：

- 断言、abort、内存错误
- 账号隔离的文件读写与 stat
- JavaScript 调用栈
- 版本、App ID、设备信息、运行时固定表（`RUNTIME_TABLE`）
- wall clock、monotonic clock、服务端时间校准
- TQOS HTTPS 上报

Node 给不了的：真实触摸、陀螺仪、函数完整性上下文。ACEVM 入口不会真执行任务，返回 `0` 表示失败，并记录调用次数、时间与有界任务哈希——**不能当成"执行成功但结果为空"**。能力缺口只提示一次。

微信宿主 App ID、debug=`2`、固定表已核对；设备平台文本按官方格式转小写。QQ 用 `windows;windows;windows 10.0;0;` 和 `qqfile://usr/`，宿主没有 `getAppBaseInfo` 时返回 debug `0`。

## 三、关键 ABI

| 能力 | 导出 |
| --- | --- |
| memory | `w` |
| create / destroy buffer | `A` / `B` |
| init runtime | `G` |
| encrypted init info | `H` |
| heartbeat tick | `M` |
| data to server | `N` |
| data from server | `O` |
| process received data | `P` |
| encrypt in place | `ba` |
| decrypt in place | `ca` |
| speed detection | `fa` |

初始化顺序：先 `__mergewasm_shared____wasm_decrypt_strings` + 固定密钥准备高内存的 mergewasm 元数据段 → `decrypt_all_data()` → 官方启动导出 `x()` → `G(3167, appKeyPtr)`。

> 元数据没准备好就调 `decrypt_all_data()`，间接函数表还没恢复，会报 `table index is out of bounds`。

## 四、网关 Token

`gatepb.Message` 的 field 3 是 token。普通业务与登录用随机 Token：64~127 个字母数字字符 + `=`，总长 65~128。

另有一种一次性初始化凭据：抓包里 152 字符、Base64 解码 112 字节，**不符合**上面的长度与字符规则。规则是：

```
Base64 解码后字节数 = 80 + openId 字符数
```

所以 112 字节对应 32 字符 openId（微信标准长度）；测试里 136 字符 / 102 字节的冻结向量对应 22 字符测试 openId，两者一致，不是版本差异。凭据正文是高熵内容，不含 openId 明文。

实现方式：账号绑定后读一次 `H()`，原子地优先用于**下一条完成编码的请求**，随后恢复随机 Token。它不一定落在哪个 RPC 上（实测三种连接里分别落在初始化业务请求或重连 Login），所以不能按方法名注入。

## 五、ACE 生命周期

登录成功后由 `services/ace.ts` 启动：

| 动作 | 周期 |
| --- | --- |
| 读 `N()`，非空则发 `gamepb.acepb.AceService.AntiData` | 5 秒（首次在调度启动后约 5 秒） |
| 服务端 `AntiDataReply.result` 非空时回灌 `O()` | 随回复 |
| 调 `P()` | 5 秒 |
| 调 `M()`（心跳 tick） | 25 秒 |
| 速度检测 | 30 秒 |
| 上报 TSDK 状态 | 150 秒 |

负载只在 `M()` 时按当时秒数封装，**读一次要等下一次 `M()` 才有新负载**，所以轮询比 25 秒更密只会拿到空数据——不能硬编码成 10 秒，也不能连续读取补发。

日志语义要分清：首次收到有效回复（含空 result）记 `antidata_roundtrip`；首次成功回灌非空 result 记 `antidata_received`。两者只证明往返与回灌，**不代表 ACEVM 执行成功**。

同一账号只允许一个 AntiData 在途。网络清理、重连、账号停止都会停掉 ACE 调度并销毁 WASM 实例，下次连接重新初始化。

## 六、多账号与资源路径

每个账号独立 Worker，CommonJS 模块、WASM 内存、调度器天然隔离。TSDK 可写数据在：

```
core/data/tsdk/<accountId>/
```

WASM 通过 `getResourcePath('utils', 'tsdk-wx.wasm')` 加载，兼容源码运行、`tsc` 输出目录和 pkg 打包。实际加载的路径与哈希记录在 diagnostics 的 `wasmPath` / `wasmSha256`，出问题先看这两个值。

## 七、已知限制

- Node 无法等价于小游戏的传感器与完整性环境
- `imports.a.o` 既做环境探测又写回结果，Node 侧未实现，不能当纯函数读
- 一次性初始化凭据按"绑定后下一条完成编码的请求消费一次"实现，并发初始化不依赖方法名
- `AntiData` 负载第 21~24 字节的时钟段由取整秒的宿主时钟决定、本地可复现，但编码未解码；校验和、长度、计数等其余字段已逐字节验证
- `GateMessage.meta.server_seq` 有时取已知最大值有时取 0，置零规则未恢复，代码保持现状
- 换 WASM 时官方登录/心跳版本必须与常量一致，否则凭据对不上

## 附录：历史验证记录

> 仅作追溯，不代表当前构建的验证状态。当前构建见第一节。

| 日期 | 客户端 / TSDK | 结论 |
| --- | --- | --- |
| 2026-11-24（当前） | 微信 `v3.9.0.1794837963` | 常量与测试同步；生产链路以线上运行为准，未做逐字节官方对照 |
| 2026-10-02 | 微信 `1.15.1.4_20261001` / `v3.9.0.1792565883` | 握手、LoginRequest、HeartbeatRequest 核对通过；非空请求体加解密往返字节一致 |
| 2026-09-14 | `v3.9.0.1789137379` | 约 23 分钟生产冒烟：心跳 55 次、速度检测 46 次、状态上报 9 次无失败；窗口内无服务端非空 result，回灌路径未覆盖 |
| 2026-08-26 | `1.13.3.11_20260826` / `v3.9.0.1787640848` | 登录、心跳、背包、好友、活动、天气写操作全部成功；持续产生 AntiData 往返 |
| 2026-08-21 | `1.13.2.10_20260723` | 三次握手除 Code 外一致，432 条双向消息，12 条心跳间隔约 25 秒 |
| 2026-08-20 | `v3.9.0.1787056896` | 38 秒最小冒烟：登录、背包、心跳、一次 51 B AntiData 通过；无回灌 |
| 2026-07-28 | `v3.8.6.1784551013`（旧构建） | 生产链路可用，不适用后续 v3.9.0 |

历史结论的通病：**窗口短、样本少、且大多没有同构建的官方凭据逐字节对照**。引用时注意区分"离线核对"与"生产在线验证"。
