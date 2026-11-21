# 网络并发模型

Gateway 是一条 WebSocket 长连接，所有业务共用。本文说明请求如何分级、排队、让路——面板卡顿、定时任务把心跳挤掉线，都从这里找原因。

## 一、三条实现线索

| 文件 | 职责 |
| --- | --- |
| `utils/request-priority.ts` | 纯策略：班次定义、容量上限、下一个派发谁。无运行时状态，可单测 |
| `utils/request-context.ts` | `AsyncLocalStorage`：给任务入口打班次标记，内部请求自动继承 |
| `utils/network.ts` | 排队与发送：`sendMsgAsync()` 解析班次、`takeDispatchableRequest()` 委托策略函数 |

## 二、五个班次

| 班次 | 用途 | 在途上限 | 排队上限 |
| --- | --- | --- | --- |
| `critical` | 心跳、ACE AntiData | 2（两条通道各留一个专属槽位） | 8 |
| `foreground` | 面板上的用户操作 | 3 | 60 |
| `farm` | 自己农场的定时任务 | 1 | 40 |
| `friend` | 好友农场的定时任务 | 1 | 30 |
| `background` | 宠物同步等补数据 | 1（仅连接彻底空闲时） | 10 |

对应常量：`MAX_IN_FLIGHT_BY_CLASS`、`MAX_QUEUED_BY_CLASS`、`MAX_BUSINESS_IN_FLIGHT = 3`、`MAX_NON_FOREGROUND_BUSINESS_IN_FLIGHT = 1`。

叠加约束：

- 业务班次（foreground + farm + friend）总在途不超过 3；其中非前台业务最多占 1 个槽位，**前台永远至少留两个槽位**
- 队列里还有前台请求时，新的 `farm` / `friend` 请求不派发；已在途的后台请求无法撤销，但它返回后的下一步会等前台队列清空
- `critical` 的两条通道各有一个专属槽位，ACE 挤不掉心跳，反之亦然
- `background` 只在「没有在途请求、队列里也没有别的班次」时发送
- 排队上限按班次独立计算，后台排满自己的 10 个名额不影响心跳和前台

所以任意时刻最多 5 个业务/保命请求在飞（2 critical + 3 business），闲置时可能再加 1 个 background。

## 三、防饿死

严格按优先级排序，低优先级会被不断到来的高优先级饿死。`selectDispatchIndex()` 的补偿：业务请求排队超过 `CLASS_STARVATION_MS = 4000` 就提升到队首（在满足容量约束的候选里挑等最久的）。

这个提升**不会越过前台**：队列里还有前台请求时，新的后台业务请求照样不派发。

## 四、班次怎么判定

`resolveRequestClass(options, ambientClass)` 的顺序：

1. `criticalLane`（`heartbeat` / `ace`）或 `priority: 'high'` → `critical`
2. 显式 `requestClass` → 用它
3. `priority: 'low'` → `background`（兼容旧调用）
4. `AsyncLocalStorage` 里的环境班次
5. 都没有 → `foreground`

> `priority: 'normal'` 视为"调用方没表态"，走第 4 步。这点很关键：大量 API 封装默认传 `'normal'`，若把它当成明确的前台声明，后台任务发的请求就全伪装成前台流量，分层等于没做。

### 环境班次的来源

`services/scheduler.ts` 的 `createScheduler(namespace)` 把任务体整体包在 `classForSchedulerNamespace(namespace)` 里：

| 命名空间 | 班次 |
| --- | --- |
| `network` / `ace` / `worker_manager` | 不注入（这些请求自带 `criticalLane`） |
| `friend-pet-sync` | `background` |
| 其它 `friend*` | `friend` |
| 其它（`worker`、`farm`、`task`） | `farm` |

`worker` 的 tick 同时驱动农场和好友任务，所以三个真实入口各自再显式包一层：`runFarmTick()` → `farm`、`runFriendTick()` → `friend`、`runFriendPetSync()` → `background`。

面板 HTTP 与 Socket.IO 不经过调度器，没有环境班次，天然落到 `foreground`——那边确实有人等着结果。

## 五、后台任务的两道闸门

协议层的 `background` 槽位只保证"不抢先"，不保证"不叠加"，所以后台任务自己还要让路：

1. **发前观察**：`waitForGatewayIdle(maxWaitMs)`（`utils/network.ts`）只观察不排队。判定在 `utils/low-priority-gate.ts` 的 `isGatewayIdleForLowPriority()`：队列里有非 background 请求、有业务请求在飞、已有 background 在飞、心跳漏过一次、或有在途请求卡了 5 秒以上，都算不空闲。
2. **排队上限**：`background` 在队列里最多等 `LOW_PRIORITY_QUEUE_WAIT_MS = 8000`，超时抛 `GatewayBusyError`（`isGatewayYieldError()` 可识别），让调用方把剩下的活留给下一轮。

## 六、定时任务的健康度退避

服务端静默时的典型形态：请求全部 `stage=pending` 挂十几秒、心跳开始漏拍，最后 3/3 失败掉线。此时再按固定间隔发定时任务，只会把 pending 拉满、把心跳一起挤死。

`runFarmTick()` / `runFriendTick()` 在入口检查 `isGatewayHealthyForBusiness()`：

- 判据只有两条：`heartbeatMisses > 0`，或有在途请求超过 `GATEWAY_STALL_PENDING_MS = 5000` 没回包。比后台闸门宽松得多——队列里有活、有业务请求在飞都不算不健康
- 不健康就跳过本轮，并把 `nextFarmRunAt` / `nextFriendRunAt` 指数退避：首次 30 秒，翻倍封顶 60 秒（`nextBusinessBackoffMs()`）；farm 与 friend 各自记账
- 恢复后立即清零，日志只在进入退避与恢复时各打一次

退避期间连接上只剩心跳和 ACE 上报——它们有独立保留槽位，能安静地把连接救回来。

## 七、压力日志

`Gateway 请求压力: ...` 只在队列里有**非 background** 请求时打印（`utils/request-pressure.ts`）。只剩后台补数据是正常状态，不算拥塞。

`queuedMethods` 前缀：`!H:` 心跳、`!A:` ACE、无前缀前台、`#` 自家农场、`&` 好友农场、`~` 后台补数据。

## 八、登录后的启动序列

`runStartupSequence()`（`core/worker.ts`）不再用四个错峰定时器，而是**串行**：登录动作结束后先 `await runDailyRoutines(true)`（邮件 / 每日分享 / 月卡 / 免费礼包 / VIP）→ `await checkAndClaimTasks()`，然后才挂农场 / 好友主循环和周期定时器。

好处是登录启动期同一时刻只有一个业务请求在飞，礼包领得及时，也不会和心跳抢连接。神秘商人不再参与登录首查：只有开了"自动购买"或"到货提醒"，才在登录 30 秒后补检一次、之后每 10 分钟巡检；同一笔到货（`npcId:activeTime`）只下单一次，重启补检不会重复购买。

## 九、自动任务全局互斥

`services/automation-lock.ts` 提供进程内互斥队列：

- 所有后台自动任务入口都走 `runExclusiveAutomationTask()` 串行执行
- 同一任务链内部的嵌套调用可重入，不会自锁
- 心跳、ACE、面板前台操作不进这个队列
- 只约束自动任务，不约束手动操作

已接入的入口：登录启动序列、每日例行、农场巡检、好友巡查、推送触发巡田、好友申请处理、宠物同步、任务领取、神秘商人、化肥购买与立即施肥、收获后出售、宠物礼包拾取。

## 相关文件与测试

- `utils/request-priority.ts`、`utils/request-context.ts`、`utils/network.ts`、`utils/low-priority-gate.ts`、`utils/request-pressure.ts`
- `services/automation-lock.ts`、`services/scheduler.ts`
- `core/worker.ts`（`runStartupSequence` / `runFarmTick` / `runFriendTick`）
- 契约测试：`core/tests/request-priority.test.js`、`core/tests/low-priority-gate.test.js`
