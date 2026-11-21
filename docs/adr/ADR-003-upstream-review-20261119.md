> **状态**：部分已执行：2026-11-21 已同步上游牧场模块，文中结论按当时版本记录
> **类型**：决策记录（ADR），内容冻结不改写；如需变更请新开一篇并标注取代关系
> **原路径**：`docs/upstream-review-20261119.md`

# 上游甄别报告（2026-11-19）

甄别范围：`f0f0a6f`（上次同步点 11-17）..`bd93d3f`（上游最新 11-19），共 17 个功能提交 + 9 个 merge。

## 根本结论

本地与上游是**平行演进的两条线**，历史不相关、结构已分化：

- 上游 `core/src/core/worker.ts`、`core/src/utils/network.ts` 是**单文件**；本地已拆成 `worker/` 和 `network/` 目录。
- 上游 `ranch/state.ts` 有 `salePrices`、`readMarketRotation` 等函数；本地没有。
- 本地有上游没有的功能：场景2降级、数据隔离重构、牧歌前端重构、删奶茶/快乐自动化。

因此**绝大多数上游提交无法直接 cherry-pick**（会冲突或缺失前置依赖）。要合必须逐条手工移植，相当于"人造移植"，风险和本地测试回归成本都不低。

## 分级清单

### 🟢 可考虑手工移植（价值明确、改动小、依赖少）

| 提交 | 内容 | 说明 |
|---|---|---|
| `63e7ccb` | vite.config 改读 web/package.json + 版本 20261119 | 修了"版本号读错文件"的小 bug；本地仍读 core/package.json。单独改 2 行即可，但会改变 `__APP_VERSION__` 来源，需确认显示版本口径。 |

### 🟡 有价值但需连改/评估行为变化

| 提交 | 内容 | 风险 |
|---|---|---|
| `55df467` | 农场催熟：新增 `normal_ripen`/`organic_ripen` 模式 + `ripening.ts` + 测试 | 功能完整自带测试，但改 planting/scheduler/shared-state/types 多处；且把新账号默认施肥从 `smart` 改成 `none`、smart 逻辑重写，行为变化大 |
| `c58a51f` | 修复21级棚未自动解锁（新增 `activateShed`） | 依赖上游 `shedAwaitingActivation`/`salePrices`，本地 state.ts 无此函数；改 actions/automation/contract/transport/state/web 六处 |
| `e11b572` + `7c55a19` | 巨大图鉴条目修正 + 一键已读 | 本地图鉴已重构过，book.ts 无 `claimAll` 基础，前端结构也不同 |

### 🔴 不建议合（整块新功能 / 大范围冲突）

| 提交 | 内容 | 原因 |
|---|---|---|
| `5750494` `dc4d8e2` `3d3ec9b` `209ff9e` | 仓鼠集市化肥兑换（松果/便便按货币拆分、到访通知排队） | 本地完全没有集市自动兑换功能与开关，是从零引入一整块功能；改 worker/network/state/transport + 配置 + 前端 + 测试，依赖 `readMarketRotation`/`shopProfiles` 等本地没有的前置 |
| `7f5c529` | 好友偷取/巡查续跑/次数停排大重构 | 依赖上面集市链的中间状态；改 worker.ts（本地为目录）+ automation/friends 数百行 |
| `a085d5b` | 窝棚分组、幼崽补栏、购买流程优化 | 19 文件 654 行，覆盖本地高频改动的 ranch 核心与前端，冲突面最大 |
| `a66755c` | 按场景同步好友名单、优先昵称 | 改 friendpb.proto（本地 GetAllRequest 为空）+ 7 文件；本地好友名单走另一套 |
| `2a4d53a` | 背包出售 + 成熟后图鉴领奖 | 改 actions/book/state + 前端 + 设置，依赖上游 automation 结构 |
| `86af45c` | 一键已读所有新增图鉴 | 改 worker/commerce-routes/data-provider/illustrated + 前端；本地结构不同 |
| `e97f69a` | 自动完成"打开好友面板"成长任务 | 依赖本地没有的 `daily.claimBenefit`/`reportEntry` 动作 |
| `f9dd757` | 上报类成长任务 cond_type 加 25 | 本地 task.ts 根本没有 `CLIENT_REPORT_COND_TYPES` 机制，无从下手 |

## 建议

1. **默认：这批不合**。本地已按自己的方向重构（场景降级/数据隔离/牧歌），上游这批主要是集市功能与牧场细节，硬合收益低于回归风险。
2. 若确实想要某个功能（最可能是 `55df467` 催熟模式或 `c58a51f` 棚解锁），走"手工移植 + 单测 + 全量回归"，不要直接 cherry-pick。
3. 仅 `63e7ccb` 是低风险小修，可按需单独处理。
