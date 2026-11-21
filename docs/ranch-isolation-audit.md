# 农场 / 牧场数据隔离审计报告

> 审计日期：2026-11-16　｜　范围：`core` + `web` 全量源码　｜　性质：只读审计，未修改任何代码
>
> 结论一句话：**业务数据已经 100% 物理隔离；活动数据是全局流、靠客户端双向过滤，无法也不需要在数据源层隔离；审计另发现 3 个与"隔离"无关但会影响牧场自动化的真实缺陷。**

---

## 0. 方法：先把"隔离"拆成三层

笼统问"是否 100% 隔离"没有意义，因为农场和牧场的数据在协议层就分属两类。本报告按三层分别结论：

| 层级 | 含义 | 结论 |
|---|---|---|
| **A. 业务数据层** | 动物、栏舍、背包、产量、金币、设施 | ✅ 100% 物理隔离 |
| **B. 活动数据层** | ActivityList 全局活动流 | ⚠️ 数据源无法隔离，靠双向过滤（有残余风险） |
| **C. 共享基础设施层** | 场景单例、请求班次、锁、日志、调度 | ⚠️ 共享单例 + 锁协调，非隔离（有真实缺陷） |

---

## 1. A 层：业务数据 —— ✅ 100% 物理隔离

这一层隔离得最彻底：协议、RPC 路由、持久化、配置、前端状态五套全分开。

| 维度 | 农场 | 牧场 | 证据 |
|---|---|---|---|
| 协议包 | `gamepb.plantpb` 等 | `gamepb.ranchv2`（独立包、自包含、无 import） | `proto/ranchv2.proto:2`；`proto/plantpb.proto:3` |
| 类型注册 | `AllLandsRequest` 等 | 全部 `Ranch*` 前缀 | `utils/proto.ts:126-131` |
| RPC 路由 | `gamepb.plantpb.PlantService` | 独立 `ROUTES` | `services/farm/api.ts:31,43,60`；`ranch/transport.ts:11-53` |
| 持久化 | `stats/`、`gameConfig/` | `ranch-stats/`、`ranch-operations/`、`gameConfig/ranch/` | `services/stats.ts:8`；`ranch/stats.ts:24`；`ranch/operation-state.ts:24` |
| 前端 store | `useFarmStore` | `useRanchStore` | `stores/farm.ts:51`；`stores/ranch.ts:19` |
| API 路径 | `/api/lands`、`/api/seeds`、`/api/farm/*` | `/api/ranch`、`/api/ranch/{action}` | `farm.ts`；`ranch.ts:54,87,112` |
| 路由 | 独立农场路由 | `ranch` + 5 个隐藏分区子路由 | `router/menu.ts:53-102` |

**结论**：农场服务从未 import 牧场 state，牧场组件全部在 `components/ranch/`，无任何组件同时引用两个 store。这一层不存在串台路径。

---

## 2. B 层：活动数据 —— ⚠️ 靠双向过滤，有残余风险

### 2.1 为什么无法物理隔离

`ActivityListRequest` 是**空消息**（`proto/activitypb.proto:196`），协议里没有场景字段，服务端也不按场景过滤，返回的是全站混合活动流。农场和牧场拿到的是**同一份模块级单例缓存**（`services/activity-windows.ts:12`，农/牧共用）。

> 所以在"拉取活动数据"这个动作上做隔离，协议层不支持。硬做只会在客户端再维护一份规则表，本质没变。

### 2.2 已实现的双向过滤

| 消费点 | 过滤方式 | 是否安全 |
|---|---|---|
| `activity-center.ts:287`（农场活动中心） | 反向 `isGlobalActivity` 剔牧场 | ✅ 依赖前缀表完整 |
| `ranch/state.ts:234`（牧场活动页） | 正向 `isRanchActivity` 留牧场 | ✅ 依赖前缀表完整 |
| `data-provider.ts:188` → `api-handlers.ts:211` | 透传上述已过滤快照 | ✅ |
| `admin/activity-center/*`、`stellar.ts` | 透传已过滤快照 | ✅ |
| `happy-auto`、`milk-tea-auto`、`solar-auto` | 按固定 id/分组定向，不遍历全量流 | ✅ 不会误执行 |
| `warehouse.ts:73`、`friend-interaction-items.ts:226` | 按 id 精确查出售条件，不过滤 | ✅ 低概率（条件不会配牧场 id） |

实测：农场活动中心 29 项、牧场活动残留 0 条；牧场页保留 7 条。

### 2.3 残余风险（R1，中）

分类规则只有**两条启发式**（`config/activity-scene.ts`）：

- UID 前缀 `Muge`（:18）
- 活动 id 前缀 `20261117`（:26）

关键问题：`activity-windows.ts:129-132` 明确写着"牧场活动通常不在 activities 树中"，而活动树只给有玩家进度的主活动挂 uid。也就是说，**牧场活动在农场目录侧的 uid 多为空，实际只靠 id 前缀 `20261117` 兜底**。

风险表现：

1. **漏判即串台**：牧场换新活动、换了 id 且无 uid 时，`isGlobalActivity` 判为 global → 串入农场活动中心。当前"未识别一律 global"的策略是**宁可漏判也不误删**，代价就是新活动有串台窗口。
2. **误判面**：`startsWith` 前缀匹配会把任意 `Muge*` / `20261117*` 活动划为牧场，可能误剔农场页或误显牧场页。
3. **信息不足**：`getActivityGroupExtra`（`activity-windows.ts:137`）能补 uid，但只有 `ranch/state.ts:249` 调用了它；农场侧 `buildActivityDirectory` 不补，导致农场侧分类信息更弱。

**这是"分类准确性"问题，不是"数据隔离"问题**——两者解法不同：前者靠维护归属表，后者才需要动数据源。

---

## 3. C 层：共享基础设施 —— ⚠️ 非隔离，发现 3 个真实缺陷

这一层本就不该"隔离"（场景单例、全局锁本来就是全局唯一的），但要靠锁和班次正确协调。审计发现 **3 个会影响牧场自动化的真实 bug**，均经源码逐行核验。

### R2（高，真实 bug）：牧场班次 `pasture` 是非法值，导致自动化自我让路

完整逻辑链（已逐行核验）：

1. `core/worker/schedules.ts:257` 用 `runWithRequestClass('pasture', ...)`
2. 但合法班次白名单是 `['critical','foreground','farm','friend','background']`（`request-priority.ts:27`），**没有 `pasture`**
3. `request-context.ts:26-28`：`normalizeRequestClass('pasture')` 返回 `null` → `runWithRequestClass` 直接 `fn()`，**不注入环境班次**
4. `transport.ts:113-114`：`isManualRequest()` = 环境班次为 null → **恒为 true**
5. `actions.ts:233,248`：每步操作都 `markManualTurn()` 把自己标成"手动请求"
6. `automation.ts:68-72`：checkpoint 看到 `isManualWaiting()` 为真 → 抛 `RANCH_PATROL_YIELD` 自我让路

对照：农场用 `farm`、好友用 `friend`、宠物同步用 `background`（`worker.ts:74`、`schedules.ts:172,216`、`pet-sync.ts:222`），**都是合法班次，唯独牧场漏配**。

> 影响：牧场自动巡查会在自己的第一步后就判定"有手动操作"，反复自我让路。这与农场/牧场数据隔离无关，是自动化功能缺陷，但会影响牧场自动化的实际运行。

### R3（中）：旧 `pasture` 模块与新 `ranch` 模块双实现并存

- 旧实现 `services/pasture/`（`index.ts:177,390-393`）仍通过 `/api/pasture` 手动触发（`api-handlers.ts:40-44`、`farm-routes.ts:351-366`）
- 新实现 `services/ranch/` 走独立协议
- 两者配置 key 也不同：前端设置里同时存在 `pasture_*`（`web/src/stores/setting.ts:35-42`）和 `ranch_*`
- 旧 `pasture/scheduler.ts:29` 的班次被 `classForSchedulerNamespace` 兜底判为 `farm`（`request-context.ts:51`）

影响：两套牧场逻辑并存，未来维护时可能改错地方。属于历史遗留，未造成当前数据串台。

### R4（中）：协议层有两套 Ranch 类型定义

`utils/proto.ts` 同时注册了：

- 旧 `gamepb.animalpb.*` 的 `RanchInfo`、`GetRanchDetailRequest` 等（:90-121）
- 新 `gamepb.ranchv2.*` 的 `Ranch*` 前缀类型（:123-131）

命名不冲突（新类型有 `Ranch` 前缀），但两套并存，混用风险由代码纪律保证，无编译期强制。

### 其他低风险观察（非缺陷）

- **场景降级读**：`transport.ts:157-174` 当场景 2 未解锁（1045002）时，不切场、直接在当前场景读牧场 AllCells。这是**有意的兼容降级**且带 `global_scene_id=2`，不是串台 bug；但它说明"场景隔离是运行时保障，非协议层强制"。
- **全局单例**：`globalSceneId`（`network/state.ts:48`）靠 `ranch.scene` 独占锁串行（`transport.ts:177`）；`automation-lock.ts` 单例被 farm/pasture/ranch 共用，仅性能串扰。
- **日志 module 不全**：`ranch/daily-share` 用 `module:'task'`（与农场 task 混淆）；农场 `Dashboard.vue` 日志面板默认不过滤 module，会混入牧场日志——属"概览性质"，可接受。

---

## 4. 最终结论

**问：必须做到农场、牧场数据 100% 隔离吗？**

答：**不需要，也不现实，但要分层看**：

1. **业务数据已经 100% 物理隔离**（A 层）——协议、路由、持久化、store 五套全分开，这是真正意义上的数据隔离，已完成，无需再动。
2. **活动数据物理隔离做不到**（B 层）——协议空请求、服务端返回全站流，只能靠客户端双向过滤。当前农场侧 0 残留、实测通过；唯一残余风险是启发式规则对新活动的漏判（R1），这是"分类准确性"问题。
3. **共享基础设施本就不该隔离**（C 层）——靠锁和班次协调即可，但审计发现**牧场班次配错（R2）是真实 bug，建议优先修**。

### 建议优先级

| 优先级 | 项 | 动作 |
|---|---|---|
| P0 | R2 牧场班次 `pasture` 非法 | 改用合法班次或扩展白名单，恢复牧场自动化 |
| P1 | R1 活动分类漏判 | 把 uid/id 归属规则改成可配置表，降低新活动串台窗口 |
| P2 | R3 旧 pasture 双实现 | 评估是否下线旧 `/api/pasture` 与 `pasture_*` 配置 |
| P3 | R4 双套 Ranch 类型 | 逐步清理旧 `animalpb` 牧场类型注册 |

> 本次审计起初中发现的问题，已于 2026-11-16 按优先级全部修复，修复记录见下节。

---

## 5. 修复记录（2026-11-16 全部完成）

| 项 | 状态 | 改动 |
|---|---|---|
| **R2（P0）** 牧场班次非法 | ✅ 已修 | `worker/schedules.ts` 的 `runWithRequestClass('pasture', …)` 改为合法班次 `farm`（与农场共用互斥锁串行，不抢槽位）；同步更新 `ranch/transport.ts` 注释。 |
| **R1（P1）** 活动分类漏判 | ✅ 已修 | 新建 `config/ranch-activity-scope.json` 可配置归属表（uid 前缀 / id 前缀 / 精确 id / 排除 id）；`activity-scene.ts` 改为加载配置，新增 `reloadRanchActivityScope` 热更新、`setRanchActivityScopeRules` 注入、`getRanchActivityScopeRules` 诊断，支持 `excludeIds` 纠正前缀误判；补 3 个测试，活动归属测试共 9 项通过。 |
| **R3（P2）** 旧 pasture 双实现 | ✅ 已清 | 删除 `services/pasture/` 目录、`/api/pasture` 两个路由、worker 的 `getPastureSnapshot`/`operatePasture` 分支与 data-provider 对应方法、两个旧测试，以及 `pasture_*` 死配置字段（core 与 web 四处）。`schedules.ts` 中 `pasture*` 命名的调度状态属于新牧场，保留。 |
| **R4（P3）** 双套 Ranch 类型 | ✅ 已清 | 从 `proto.ts` 移除 `animalpb.proto`/`homesteadpb.proto` 加载与全部旧类型注册，删除两个 proto 文件。运行时验证：424 个类型加载成功，ranchv2 关键类型齐全，旧 animalpb 类型已无。 |

### 有意取舍（未实施的审计建议）

- **农场侧补 uid**：审计建议农场活动中心也调 `getActivityGroupExtra` 补 uid。经评估**未实施**，原因：① 牧场活动多不在 `activities` 树里、拿不到 groupId，补 uid 无效，真正兜底靠 id 前缀（已做成可配置表）；② `activity-center.ts` 有明确注释警告 Gateway 单连接不能并发 burst，为逐条活动补 uid 而增加 GetGroup 请求有拖垮连接的风险。收益边际、风险明确，故保留现状。

### 验证结果

- `core`：typecheck 通过；全量测试 **356 通过 / 0 失败 / 1 跳过**（删除 2 个旧 pasture 测试文件，总数由 369 降至 357）。
- `web`：typecheck（`vue-tsc -b`）通过；生产构建通过。
- 运行时：proto 加载成功（424 类型），ranchv2 关键类型齐全，旧 animalpb 类型已清除。
- 源码全量检索：`pasture_*` 死配置、`getPastureSnapshot`/`operatePasture`、`services/pasture`、`api/pasture`、`gamepb.animalpb`/`gamepb.homesteadpb` 引用均为 0。
