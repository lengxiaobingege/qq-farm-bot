# 牧场优化方案

> 状态：**A / B / C 三批均已实施**（2026-11-16），实施记录见文末第七节
> 基线提交：`bb9b6f5`（牧场模块成型）
> 范围：只涉及 `core/src/services/ranch/**`、`web/src/components/ranch/**`、`web/src/views/RanchOverview.vue`、`web/src/components/RunLogCard.vue`，不触碰 proto 与游戏协议。

## 一、结论

功能已稳定，剩下的是**体感与效率**问题，共 9 项。按风险分三批：

| 批次 | 内容 | 后端改动 | 风险 | 建议时机 |
| --- | --- | --- | --- | --- |
| A | 自动刷新、日志默认过滤、事件中文名、待处理可点击 | 无 | 低 | 随时 |
| B | 减少重复全量读、手动优先于巡查、快照回传真实场景 | 有 | 中（需回归写操作） | 有测试账号时 |
| C | 场景降级提示、今日产出统计、动物筛选排序 | 小 | 低 | A 之后 |

## 二、现状基线（实测口径）

一次手动「一键收获」的完整链路：

| 阶段 | 报文 | 说明 |
| --- | --- | --- |
| 报价 `POST /api/ranch/harvest/quote` | `GetBag(2)` + （场景降级时 `AllCells`） | `prepareAction → inScene → loadRaw` |
| 执行 `POST /api/ranch/harvest` | 同上 2 条 + `HarvestRanch` 写 + `after` 再全量 `AllCells` + `GetBag` | `operate` 内 `before`/`after` 各一次全量读 |
| 合计 | **6 条报文，其中 4 条是全量读** | 场景 2 可用时切场景回包自带 cells，可省 2 条 |

另外两个基线事实：

- **前端不轮询**：牧场相关组件无 `useIntervalFn`；农场 `FarmPanel.vue:592` 有 60 秒刷新。
- **日志卡不区分模块**：`RunLogCard.vue` 无 props，`filter.module` 初始为 `''`。

## 三、优化项

### A 批（体验，纯前端）

#### A1 牧场页面自动静默刷新

- **现象**：页面停留时动物倒计时归零后仍显示旧阶段，必须手点刷新。
- **根因**：`useRanchLoader`（`web/src/components/ranch/ranch-shared.ts:92`）只在 `currentAccountId` 与参数变化时读取，无定时器。
- **改法**：
  1. `useRanchLoader(view, params, { intervalMs = 60000 })` 内加 `useIntervalFn`，`onMounted` 启动、`onBeforeUnmount` 停止。
  2. 静默刷新不触发按钮 loading：`ranch.load` 增加第四参 `{ silent }`，silent 时不置 `loading`，避免刷新按钮与面板骨架闪动。
  3. 跳过条件：`document.hidden`、`busy`（写操作中）、`pending`（确认框打开）、距上次读取 `< 5s`。
  4. 间隔取 60 秒，与农场一致；写操作成功后 `receivedAt` 更新，定时器自然顺延。
- **文件**：`ranch-shared.ts`、`stores/ranch.ts`。
- **风险**：低。唯一注意点是「静默刷新与写操作交错」，用 `busy` 判断即可。
- **验收**：停留在牧场个人页 2 分钟，倒计时到 0 后 60 秒内自动变为「可收获」，刷新按钮不闪 loading；打开确认框期间不刷新。

#### A2 日志卡默认只看牧场

- **现象**：牧场概览的「运行日志」混着农场日志，用户要先手动把模块切到「牧场」。
- **根因**：`RunLogCard.vue` 未接 props，`filter.module` 初始 `''`。
- **改法**：
  1. 组件加 `defineProps<{ module?: string, events?: boolean }>`，`filter.module` 初值取 props。
  2. `loadLogs` 已按 `filter.module` 传参，无需改请求逻辑。
  3. `RanchOverview.vue` 传 `module="ranch"`；农场页保持不传（行为不变）。
  4. 清空日志按钮的 `/api/logs` 是**全模块删除**，牧场页里保留但增加二次确认文案「将清空该账号全部日志」。
- **文件**：`RunLogCard.vue`、`RanchOverview.vue`。
- **风险**：低。确认 `watch(hasActiveLogFilter)` 的实时日志开关逻辑在 props 初值下仍正确。
- **验收**：进入牧场概览，日志卡模块选择器显示「牧场」且列表只有 ranch 事件；切到「所有模块」能恢复全量。

#### A3 补齐牧场事件中文名

- **现象**：日志事件显示 `ranch_harvest`、`ranch_feed_normal` 这类原始 key。
- **根因**：`RunLogCard.vue` 的 `events` 只有 `ranch_task_claim`、`ranch_daily_share`。
- **改法**：按下表补 12 项（`value` 与后端 `log(..., { event })` 完全一致）：

  | value | 显示名 |
  | --- | --- |
  | `ranch_harvest` | 牧场收获 |
  | `ranch_produce` | 牧场生产 |
  | `ranch_clean` | 牧场清理 |
  | `ranch_sell` | 出售产物 |
  | `ranch_buy` | 购买/放养 |
  | `ranch_grass` | 补充牧草 |
  | `ranch_upgrade` | 设施升级 |
  | `ranch_feed_normal` | 普通罐头喂养 |
  | `ranch_feed_organic` | 有机罐头喂养 |
  | `ranch_friend_steal` | 好友偷取 |
  | `ranch_friend_clean` | 好友清理 |
  | `ranch_friend_mosquito` | 好友放蚊 |

  事件下拉建议按模块分组显示（农场/牧场/通用），避免单选列表过长。
- **文件**：`RunLogCard.vue`。
- **风险**：无。
- **验收**：跑一轮自动化，日志事件列全部为中文。

#### A4 概览「待处理」可点击

- **现象**：概览显示「可收获 3」，但要自己去个人页再点一键收获。
- **根因**：`RanchOverview.vue:73` 的 `todo` 只用于展示。
- **改法**：`todo` 每项加 `action`/`to`：
  - 可收获 → 触发 `useRanchActions().request('harvest', { all: true })`（复用现有报价 → 确认弹窗流程，不绕过二次确认）。
  - 可生产 → `request('produce', { all: true })`。
  - 可喂养 → 跳转 `/ranch/personal?tab=animals` 并滚动到缺草/可喂动物（不做批量喂，因涉及罐头类型选择）。
  - 待清理 → `request('clean')`。
  - 值为 0 时不可点（`is-zero` 已有样式）。
- **文件**：`RanchOverview.vue`。
- **风险**：低。`RanchQuoteModal` 在 `Ranch.vue` 外壳渲染一次，概览属于其子路由，可直接复用 `useRanchActions`。
- **验收**：概览点「可收获」弹出报价弹窗，确认后数字归零且日志出现对应记录。

### B 批（效率，需回归）

#### B1 执行阶段不再做第二次全量读

- **现象**：一次收获有 4 条全量读，弱网下手感明显。
- **根因**：`actions.ts:249` 的 `operate` 在写请求后又 `loadRaw()` 全量拉 `AllCells + GetBag`，只为了做「自动放养校验」「库存扣减校验」和返回新快照。
- **改法**（按动作分级，不做一刀切）：
  1. **写回包已含新状态的动作**（`produce` / `harvest` / `clean` / `feed` / `release`）→ 直接用 `reply.ranches` / `reply.op_results` 增量更新 `before.cells`，跳过 `after` 全量读；快照基于内存推算，`refreshRequired` 保持 false。
  2. **必须核对余额的动作**（`buy` / `place` / `addGrass` / `useCan` / `exchange` / `buyCan` / `sell`）→ 保留 `after`，但**只发 `GetBag`**，不重拉 `AllCells`（这些动作不改栏舍结构，除 `place` 需校验放养结果）。
  3. `place` 与 `buy(autoPlace)` 仍全量读，因为要确认动物真的进了栏位。
  4. `snapshot()` 需要 `cells` 与 `bag`，签名改为 `snapshot({ cells, bag })`，允许传入合并后的对象。
- **预期收益**：收获/催产/清理/喂养从 6 条降到 3 条；购买类从 6 条降到 4 条。
- **文件**：`actions.ts`、`state.ts`。
- **风险**：中。增量合并写错会给出错误的快照（比多读一次危险）。缓解：先只对 `harvest`/`produce`/`clean` 三个纯栏舍动作做增量，其余保留全量，一轮线上对照后逐项放开。
- **验收**：连续 20 次收获，快照中的货架、动物数、产物数与手动刷新一致；`op_results` 条数与 `plan.count` 关系仍满足现有 `unknown()` 断言。

#### B2 报价结果短时复用，免去重复进场景

- **现象**：报价与执行是两个 HTTP 请求，各自 `inScene` → 各切一次场景、各读一次数据。
- **根因**：`prepareAction` 与 `operate` 独立进入 `inScene`，之间无状态传递。
- **改法**：在 `transport.ts` 增加**进程内短 TTL 快照**：
  - `inScene` 读到的 `cells + bag` 存 `{ gid, at, cells, bag }`，TTL 20 秒。
  - `operate` 进入时若快照命中且 `gid` 一致，直接把 `cells/bag` 交给 `planAction` 与 `reservations`，省掉一次 `loadRaw`。
  - 快照在**任何写请求发出后立即失效**（`onSent` 里清空），保证不复用脏数据。
  - `quotes` 已带 `signature`，`planAction` 仍会重算并比对，状态变了照样抛 `RANCH_OFFER_CHANGED`——安全性不依赖缓存。
- **文件**：`transport.ts`、`actions.ts`。
- **风险**：中。缓存失效点漏一个就会用旧状态报价；靠 `signature` 兜底可接受，但必须补「写后失效」的单测。
- **验收**：正常流程点「一键收获」→ 确认，服务端报文数从 6 降到 4；若两次点击间隔超过 20 秒仍能正确报价。

#### B3 手动操作优先于自动巡查

- **现象**：自动巡查进行中点牧场按钮，要等巡查跑完才响应（最长一个 5 秒切片，含好友拜访/任务领取时更久）。
- **根因**：巡查整体包在 `runExclusiveAutomationTask('ranch.scene')` 里（`automation.ts:61`），HTTP 请求的 `inScene` 排在同一个队列尾部；`checkpoint()` 只在 `act` 前检查让路条件，没有「有人类在等」的信号。
- **改法**：
  1. `transport.ts` 暴露 `requestManualTurn()` / `consumeManualTurn()`：`prepareAction`、`operate` 入口置一个 `manualWaiting = Date.now()` 标记。
  2. `automation.ts` 的 `checkpoint()` 增加条件「`manualWaiting` 在最近 N 秒内」→ 抛 `RANCH_PATROL_YIELD` 立即让路，`nextCheckAt = now + 5s`。
  3. 巡查让路后不重置 `completedPhases`（现有 `resetCycle()` 在 yield 分支里没调用，已符合「续跑」语义），确认这一点即可。
- **文件**：`transport.ts`、`automation.ts`。
- **风险**：中。让路过频会导致巡查完不成（尤其自动刷新叠加点击）。约束：让路后至少 5 秒内不再让路，且每天让路次数上限可观测（记日志 `ranch_patrol_yield`）。
- **验收**：巡查执行中连点三次刷新，页面响应 < 2 秒；日志中每日 `ranch_patrol_yield` 次数 < 20。

#### B4 快照回传真实场景与降级状态

- **现象**：`snapshot()` 里 `sceneId: 2`、`unlocked: true` 是写死的（`state.ts:86`），实际降级在场景 1 读数据时前端仍显示场景 2。
- **根因**：移植时该字段未被使用，硬编码遗留。
- **改法**：
  1. `snapshot()` 改读 `network.getUserState().globalSceneId`，并把 `inScene` 的降级结果（`sceneFallback: true`、`sceneLockedUntil`）一并带出。
  2. 前端 `RanchGate.vue`/`RanchOverview.vue` 在 `sceneFallback` 为真时显示轻提示条：「当前账号的牧场场景未解锁，数据在通用场景读取，部分写操作可能被拒绝」。
- **文件**：`state.ts`、`RanchOverview.vue`。
- **风险**：低。纯展示字段。
- **验收**：降级账号进入牧场，概览出现提示条；正常账号不出现。

### C 批（增强）

#### C1 今日产出统计

- **现状**：概览只有 4 个「待处理」计数，没有「今天收了多少、卖了多少」。
- **改法**：`actions.ts` 写操作成功后，把 `rewards` 累加到 `data/ranch-stats/<gid-hash>.json`（按 `YYYY-MM-DD` 分桶，字段：`harvest`/`produce`/`sell`/`feed` 次数与物品汇总），`getState` 返回 `todayStats`；概览加一行「今日：收获 N 次 · 出售 M 件 · 收入 X」。
- **注意**：只做**计数与物品汇总**，不做收益估值（产物价格随图鉴/集市波动，估了会误导）。
- **风险**：低。新增只写文件，失败不影响主流程。

#### C2 动物列表筛选与排序

- **现状**：动物按栏舍平铺，几十只时找「可收获的」很费眼。
- **改法**：`RanchAnimalsPanel.vue` 顶部加筛选 chip（全部/可收获/可生产/缺草/幼崽期/成长期），排序支持「剩余时间升序 / 稀有度」。纯 `computed` 过滤，不改接口。
- **风险**：无。

#### C3（可选）自动化演练模式

- **动机**：本次排查中多次因「棚未建、罐头为 0、牧草已满」导致写操作无法验证，只能靠抓包推断。
- **改法**：新增开关 `ranch_dry_run`，开启后 `automation.run()` 只跑 `prepareAction`（报价）并记 `result: 'dry'` 日志，不发写请求。用于在新账号/新版本上先验证「判定逻辑是否认为该动作可执行」。
- **风险**：低，但要注意别让演练日志污染「今日产出统计」（按 `result` 过滤）。

## 四、不建议做的

| 想法 | 为什么不做 |
| --- | --- |
| 给牧场 API 加通用响应缓存层 | 牧场状态秒级变化（动物成熟、货架产出），缓存收益低而错判成本高；只在 `inScene` 层做 20 秒快照（B2）已够 |
| 把 `ranchv2.proto` 再拆回三个包 | 现在独立命名空间正是为了避免与本地 `animalpb` 字段冲突，拆开等于把已解决的问题重新引入 |
| 牧场自动化改成独立 worker 线程 | 牧场与农场共用一条 WS 连接和场景状态，分线程会让「切场景」互相踩，现有 `runExclusiveAutomationTask` 串行是必要约束 |
| 概览做实时推送（WS 主动推牧场状态） | 收益是「不用等 60 秒」，成本是要在游戏协议层加订阅与解包，性价比低于 A1 |

## 五、实施顺序建议

1. **A1 + A2 + A3**（一次提交，纯前端，可当天验证）
2. **A4**（依赖 A1 的静默刷新不冲突，单独提交）
3. **B4 + C1 + C2**（展示层，不碰写链路）
4. **B1**（先只放开 harvest/produce/clean，观察一轮）
5. **B3**（让路逻辑，加日志观察让路频次）
6. **B2**（缓存，风险最高，放最后）
7. **C3**（按需）

## 六、验证与回滚

- 每批改动前跑：`pnpm -C core test`、`pnpm typecheck`、`pnpm -C web build`（基线：360 项测试 359 通过 / 1 跳过）。
- 写链路改动（B1/B2/B3）必须有真实账号跑一轮：报价 → 确认 → 结果与手动刷新一致 → 账本 `data/ranch-operations/*.json` 无残留 `pending`。
- 回滚粒度：A 批整体回滚无副作用；B1 的增量快照只作用于 `harvest`/`produce`/`clean`，拼接失败会自动退回全量读，
  需要彻底关闭时把这三个动作从 `actions.ts` 的 `INCREMENTAL_ACTIONS` 移除即可，不必回滚整批。

## 七、实施记录（2026-11-16）

三批全部落地，与方案的差异如下。

### A 批

| 项 | 实际实现 |
| --- | --- |
| A1 自动刷新 | `useRanchLoader` 增加 `intervalMs`（默认 60s），内部 `apply(silent)` 与无参 `refresh()` 分离——模板 `@click="refresh"` 会传 MouseEvent，若直接给 refresh 加参数会被当成静默调用 |
| A2 日志默认过滤 | `RunLogCard` 新增 `module` prop 并 `watch` 同步；顺带把清空日志改为二次确认（原实现直接删除全模块日志） |
| A3 事件中文名 | **方案里的猜测值有误**：后端事件名是 `ranch_${action}`，取值来自 `contract.ts` 的 `ACTIONS`，因此 `ranch_grass` 应为 `ranch_addGrass`、`ranch_feed_normal`/`feed_organic` 实际都记在 `ranch_feed`。已按实际值补 24 项，并给事件下拉加 `filterable` |
| A4 待处理可点击 | 四项都可点：收获/生产/清理走报价弹窗，喂养跳个人页选罐头；值为 0 或写入中禁用 |

### B 批

| 项 | 实际实现 |
| --- | --- |
| B1 减少全量读 | 仅 `harvest` / `produce` / `clean` 用回包 `ranches` 经 `mergeRanches` 拼新快照（回包 `RanchDetail` 与 `FacilityInfo.ranch` 是同一消息，可直接替换），其余动作仍全量读；合并失败自动退回全量读 |
| B2 报价快照复用 | `transport` 增加 20 秒 `cells`/`bag` 快照，写请求 `onSent` 即 `clearRawCache()`；`getState` / `resourceBalances` 走 `inScene(..., { fresh: true })` 绕开缓存 |
| B3 手动让路 | 用 `getAmbientRequestClass() === null` 区分面板请求（前台）与巡查（`pasture` 班次）；`markManualTurn()` 在 `prepareAction`/`operate` 入口举手，巡查 `checkpoint()` 见到就抛 `RANCH_PATROL_YIELD`，5 秒冷却 |
| B4 真实场景 | `snapshot()` 改读 `sceneStatus()`，返回 `sceneId` / `sceneFallback` / `sceneRetryAt`；概览在降级时显示提示条 |

### C 批

| 项 | 实际实现 |
| --- | --- |
| C1 今日产出 | 新增 `services/ranch/stats.ts`，按账号哈希存 `data/ranch-stats/<hash>.json`，按 `getSystemDateKey()` 分天归零；概览「待处理」卡片底部显示今日收获/生产/出售/喂养次数 |
| C2 动物筛选 | 「全部 / 可收获 / 可生产 / 缺草 / 待清理」五个 chip 可点，再点取消；**没做排序**——动物卡片位置随槽位固定更利于找到目标，排序会让位置乱跳 |
| C3 演练模式 | 新增配置 `ranch_dry_run`（默认关），开启后 `act()` 拿到报价即停，记 `result: 'dry'` 日志，不发写请求 |

### 验证

- `pnpm -C core typecheck`、`pnpm typecheck:web` 通过。
- `pnpm -C core test`：360 项 / 359 通过 / 1 跳过 / 0 失败（与基线相同）。
- 写链路（B1/B2/B3）仍需真实账号跑一轮确认，见第六节。
