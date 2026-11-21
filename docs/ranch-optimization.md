# 牧场优化记录

> 范围：`core/src/services/ranch/**`、`web/src/components/ranch/**`、`views/RanchOverview.vue`、`components/RunLogCard.vue`，不碰 proto。
> 历史：2026-11-16 完成 A/B/C 三批（基线 `bb9b6f5`）；2026-11-21 牧场模块整体同步上游，部分结论需重新量测（见第五节）。

## 一、优化前的实测基线

一次手动「一键收获」的完整链路：

| 阶段 | 报文 | 说明 |
| --- | --- | --- |
| 报价 `POST /api/ranch/harvest/quote` | `GetBag(2)` +（降级时 `AllCells`） | `prepareAction → inScene → loadRaw` |
| 执行 `POST /api/ranch/harvest` | 同上 2 条 + `HarvestRanch` + `after` 再全量 `AllCells` + `GetBag` | `operate` 前后各一次全量读 |
| 合计 | **6 条报文，其中 4 条全量读** | 弱网下手感明显 |

另外两个基线事实：

- 前端不轮询：牧场组件没有定时器，农场 `FarmPanel.vue` 才有 60 秒刷新
- 日志卡不区分模块：`RunLogCard.vue` 无 props，默认显示全量

## 二、A 批：体验（纯前端，低风险）

| 项 | 做法 | 验收口径 |
| --- | --- | --- |
| A1 自动静默刷新 | `useRanchLoader` 加 60 秒定时器；`silent` 刷新不置 loading；`document.hidden`、写操作中、确认框打开、距上次读取 <5s 时跳过 | 停留 2 分钟，倒计时归零后 60 秒内自动变「可收获」，刷新按钮不闪 |
| A2 日志默认只看牧场 | `RunLogCard` 接 `module` / `events` props，`filter.module` 初值取 props；牧场页传 `module="ranch"` | 进入牧场概览只看到 ranch 事件，切「所有模块」恢复全量 |
| A3 事件中文名 | 补齐 `ranch_harvest` / `ranch_produce` / `ranch_clean` / `ranch_sell` / `ranch_buy` / `ranch_grass` / `ranch_upgrade` / `ranch_feed_normal` / `ranch_feed_organic` / `ranch_friend_steal` / `ranch_friend_clean` / `ranch_friend_mosquito` 等下拉项，值与后端 `event` 完全一致 | 跑一轮自动化，事件列全中文 |
| A4 待处理可点击 | `todo` 每项带 `action`/`to`：可收获→`request('harvest',{all:true})`、可生产→`produce`、待清理→`clean`、可喂养→跳个人页；走报价+确认弹窗，不绕过二次确认 | 点「可收获」弹报价弹窗，确认后数字归零并出现日志 |

## 三、B 批：效率（需回归写操作）

| 项 | 做法 | 风险 |
| --- | --- | --- |
| B1 执行阶段免第二次全量读 | 按动作分级：写回包自带新状态的动作（`produce`/`harvest`/`clean`/`feed`/`release`）用 `reply.ranches` 增量更新；只需核对余额的（`buy`/`place`/`addGrass`/`useCan`/`exchange`/`buyCan`/`sell`）只补 `GetBag`；`place` 与 `buy(autoPlace)` 仍全量 | 中——增量合并写错比多读一次更危险，先只放开三个纯栏舍动作 |
| B2 报价结果短时复用 | 报价与执行之间复用 20 秒内的场景快照，写请求发出即失效 | 中 |
| B3 手动操作优先于巡查 | 面板请求入口 `markManualTurn()` 举手，自动巡查 `checkpoint()` 见到即让路（5 秒冷却） | 低 |
| B4 快照回传真实场景与降级状态 | 快照带上 `sceneId` 与是否降级，前端据此提示 | 低 |

收益预期：收获/催产/清理/喂养从 6 条降到 3 条；购买类 6 条降到 4 条。

## 四、C 批：增强

- 场景降级提示（快照里带降级标记，界面明确告知「当前在场景 1 读牧场数据」）
- 今日产出统计（按动物/产物聚合当日收成）
- 动物列表筛选与排序（按阶段、可收获、缺草）
- 演练模式（`ranch_dry_run`：只报价不写，验证判定逻辑）

## 五、2026-11-21 同步上游后的现状

牧场服务、前端面板、`ranch-automation.ts` 整体换成了上游版本，因此：

| 关注点 | 现状 |
| --- | --- |
| 手动让路（B3） | 上游实现保留 `markManualTurn` / `checkpoint` 语义，行为一致 |
| 快照复用（B2） | 上游 `transport` 有 `cacheGet`/`cacheSet`，20 秒 TTL |
| 增量读（B1） | 换实现后需重新量测，不能沿用旧的「6 → 3 条」结论 |
| 日志 `module` 过滤（A2） | 组件保留，行为未变 |
| 场景 2 适配 | 上游改用 `homesteadpb.AllCells` 读格子，不再强行切场景，原先的降级分支不再是主线 |

**待办**：用当前版本重跑一次「一键收获」报文计数（`decode-latest-protocols.js` 对数），把实测值补进第一节；若与旧基线差异大，再决定是否重做 B1/B2。

## 六、验证与回滚

- 验证：连续 20 次收获，快照中的货架、动物数、产物数与手动刷新一致；`op_results` 条数与 `plan.count` 满足 `unknown()` 断言；日志事件全为中文
- 回滚：改动集中在 `services/ranch` 与 `components/ranch` 两层，`git revert` 单批提交即可；不涉及 proto 与账号配置迁移
