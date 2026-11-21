# 微信连接与掉线诊断

本仓库只支持微信端。本文说明微信连接怎么建立、版本怎么锁、掉线时看哪些诊断字段，以及已知的能力边界。

## 一、连接流程

```text
WebSocket 握手（20 秒超时）
  → PlayerLogin（携带 TSDK 加密体 + 网关 Token）
  → PlayerSceneLogin(global_scene_id = 1)
  → 确认农场场景回包完整
  → 启动自动化（登录启动序列，见 network-concurrency.md）
```

- 握手、登录、心跳**统一使用微信版本**；自定义覆盖只作用于微信账号
- 登录渠道固定 `other`，`network` / `memory` / `device_id` 来自设备配置
- 没有小游戏启动上下文时**省略 `scene_id`**，不套用抓包样本里的入口值（它随入口变化）
- 连接创建时固定本次版本，握手/登录/心跳复用该值；保存或重置连接设置不会重启在线账号，新参数在下次取 Code 登录时生效
- 版本迁移时保留已保存的微信值，系统默认平台不覆盖已登记账号的平台

每个账号独立 Worker，独立选 App ID、设备字段与 WASM；微信加载 `core/src/utils/tsdk-wx.wasm`（版本与哈希见 [TSDK 运行约定](tsdk-runtime.md)），加载后校验 SHA-256。

## 二、掉线时看什么

断开与 Kickout 在清空队列、销毁 WASM **之前**保存 diagnostics；主动停止也记一条 `connection_summary`，用 `source` 与 `intentionalClose` 区分结束原因。

| 字段 | 含义 | 容易误读的点 |
| --- | --- | --- |
| `platform` / `clientVersion` | 本次连接用的平台与版本 | 版本不符通常意味着配置没生效 |
| `connectionAgeMs` / `onlineAgeMs` | 连接存活 / 登录初始化完成后在线时长 | 前者含握手与登录耗时 |
| `heartbeat.attempts/replies/failures` | 本次会话累计 | `attempts` 含排队与发送失败，**不等于线上帧数**；未开始心跳时为 `null` |
| `lastInboundAgeMs` / `lastHeartbeatAgeMs` / `heartbeatMissCount` | 最近收包 / 最近心跳 / 漏拍数 | 漏拍 > 0 会触发定时任务退避 |
| `pendingRequests` / `queuedRequests` | 在途与排队 | 两者同时高说明服务端在静默 |
| `ace.request/reply/nonEmptyReply/failure`、`lastFailureStage` | ACE 往返与失败阶段 | 阶段区分 `collect` / `encode` / `request` / `decode` / `feed` |
| `ace.taskFailures`、`lastFailedTask` | 本地 TSDK 调用失败 | 与"处理回包失败"是两件事 |
| `tsdk.unsupportedAceVmCalls`、`lastUnsupportedAceVmAt/TaskHash/TaskBytes` | ACEVM 未实现调用 | 返回 `0` 是失败，不是"空结果" |

日志脱敏规则：踢出用 `reasonCode`、关闭码用 `disconnectCode`；只有明确列出的整数诊断码会保留，登录 Code、Token、字符串敏感字段一律隐藏。

## 三、已知能力边界

- **ACEVM 未实现**：官方包里的 ACEVM 动态任务，Node 宿主执行不了，返回 `0`。日志只记触发次数、时间和最后一次任务原始字节的 SHA-256（读取上限 64 KiB，超限/无终止符/无效指针标记失败并清空旧哈希）。**升级 WASM 不等于补齐 ACEVM，也不能据此说掉线已修复。**
- **宿主信息不等价**：微信官方从 API 取 `model;platform;system;brand;`、`wx.env.USER_DATA_PATH`、`enableDebug`；Node 侧是替代实现，不冒充已获得真实值
- **完整性自检**：`imports.a.o` 同时做环境探测与写回，Node 未实现；与真实微信样本的差异来自 SDK 自检位图，没有通过改位图来消除
- `UserCryptoManager` 在官方版本中未启用；`debug=2` 对应 `enableDebug=false`，没有证据支持改动

## 四、复现排查

1. 关闭同账号的官方农场**和其他 bot 实例**，用新 Code 登录（避免互踢干扰结论）
2. 先关掉业务自动化，只保留心跳与 TSDK，观察至少 4 小时；稳定后再逐项打开业务
3. 保留退出前 10~15 分钟到之后 1 分钟的 `combined.log`、构建版本、登录方式、设备配置、进程重启记录
4. 采样要确认真的抓到了 `platform=wx` 的握手与**双向**消息，不能只看 Helper 在监听
5. 官方微信在本机绕过系统代理，采样结束记得恢复代理并记录人为停止时间
6. 原始抓包、日志、分析产物留在本地，不提交公开仓库

## 五、历史记录

| 日期 | 客户端 / TSDK | 结论 | 边界 |
| --- | --- | --- | --- |
| 2026-11-02 | `1.16.1.6_20261028` | 微信第 78 版包，配置 `version=1.16.1.6` / `proto=20261028`；TSDK 独立维护 | 当时只捕到 QQ 会话，微信在线凭据未做逐字节对照 |
| 2026-11-01 | `1.16.0.5_20261028` | 双端独立 WASM；同组合成输入的初始化凭据与官方 JS 一致 | 实际设备输入仍有 1 字节差异 |
| 2026-10-22 | `1.15.1.4_20261001` | 握手/登录/心跳核对通过；独立维护默认值与连接快照 | — |
| 2026-10-20 | `1.15.0.2_20261001` | 微信改用 `PlayerLogin → PlayerSceneLogin(1)`；约 4 分钟样本心跳 9/9、AntiData 19/19 | 样本仅用于协议核对 |
| 2026-09-25 | `1.14.2.13_20260922` | 12 分钟 28 组心跳、43 组 AntiData，无 Kickout | 不能代表长时稳定 |
| 2026-09-25 长测 | 同上 | 独立入口连续 4 小时，心跳/AntiData 各 575 次无掉线 | 只跑登录/心跳/TSDK，未跑业务；ACEVM 执行次数为 0 |

历史记录的共性：**窗口短、无业务、无官方凭据逐字节对照**。引用时请带上这些限定词。
