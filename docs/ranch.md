# 牧场模块说明

牧场功能来自上游 [liyangpengs/qq-farm-bot](https://github.com/liyangpengs/qq-farm-bot) 的 ranch 实现。2026-11-21 这轮同步把 `core/src/services/ranch/*`、`config/ranch-automation.ts`、`web/src/components/ranch/*` 整体换成了上游版本，并补齐了本仓库先前缺失的接线。

## 一、为什么要按模块移植，而不是 git merge

本地与上游是**两套独立历史**（`git merge` 直接报 unrelated histories），且分歧很大：worker 层结构不同，proto 同名消息的字段编号语义也不同（早期本地 `animalpb` 是按自己抓包手写的）。

因此采用「按模块移植 + 独立命名空间」：

| 层 | 处理 |
| --- | --- |
| proto | 牧场消息统一在自包含包 `gamepb.ranchv2`（`core/src/proto/ranchv2.proto`），在 `utils/proto.ts` 以 `Ranch<名字>` 注册，与农场 proto 完全隔离 |
| 格子读取 | `services/ranch/transport.ts` 通过 `homesteadpb.HomesteadService / AllCells`（注册名 `RanchAllCells`）读当前场景的牧场格子，不强行 `PlayerSceneLogin(2)` |
| 服务 | `core/src/services/ranch/`（16 个文件）整体替换为上游版本，仅补 `any` 类型标注 |
| 配置 | `core/src/gameConfig/ranch/*.json`（10 份）、`gameConfig/Goods.json`（补栏/升级要读）、`config/ranch-automation.ts` |
| 前端 | `web/src/components/ranch/*`（12 个面板 + `ranch-shared.ts`）、`views/Ranch.vue`、`views/RanchOverview.vue`、`stores/ranch.ts` |

## 二、接口速查

| 能力 | 路由 |
| --- | --- |
| 快照 | `GET /api/ranch?view=animals\|facilities\|bag\|shop\|market\|cans\|tasks\|illustrated\|activities\|friends`，可选 `shopId` / `hostGid` |
| 报价（不落库） | `POST /api/ranch/:action/quote` → 返回 `expected.signature` |
| 执行 | `POST /api/ranch/:action`，body 需带 `expected.signature`，不匹配返回 `RANCH_OFFER_CHANGED` |
| 图鉴已读 | `POST /api/ranch/illustrated/clear-new` |
| 好友黑名单 | `GET /api/ranch-friend-blacklist`、`POST /api/ranch-friend-blacklist/toggle` |
| 自动化选项 | `GET /api/ranch/automation-options` |
| 动作名 | `buy / place / addGrass / useCan / feed / produce / harvest / sell / clean / upgrade / completeUpgrade / claimTasks / reportEntry / exchange / claimIllustrated / claimDailyShare / buyCan / steal / stroke / release / putMosquito / cleanFriend` |

按单只动物操作时必须同时给 `ranchId` + `animalId`；批量用 `{ all: true }`。

> 排查提示：前端调用的接口若报 404，多半是**路由没挂**（401 才说明路由在）。牧场这轮就踩过 `POST /api/ranch/illustrated/clear-new` 漏接线的问题。

## 三、自动化开关

定义在 `core/src/config/ranch-automation.ts`，落库在账号配置 `automation.ranch_*`，默认值见 `models/store/shared-state.ts`。按用途分四类：

| 类别 | 键（节选） |
| --- | --- |
| 生产 | `ranch_harvest`、`ranch_produce`、`ranch_feed_normal`、`ranch_feed_organic`、`ranch_fill_cans`、`ranch_clean`、`ranch_stroke` |
| 建设 | `ranch_buy`、`ranch_activate_shed`、`ranch_upgrade`、`ranch_sell` |
| 集市 | `ranch_market_organic`、`ranch_market_organic_poop`、`ranch_market_organic_pinecone`、`ranch_grass`、`ranch_grass_buy` |
| 好友 | `ranch_friend_steal`、`ranch_friend_clean`、好友黑名单相关键 |

非布尔键（`ranch_check_minutes`、`ranch_feed_normal_stage`、`ranch_grass_threshold_percent` 等）在 `normalizeAccountConfig` 里单独校验，不会被当成开关。

`ranch_dry_run` 是演练模式：只走 `prepareAction` 报价并记 `result: 'dry'`，不发写请求，适合换账号或版本更新后先看判定是否符合预期。

## 四、执行效率与让路

- 面板请求没有请求班次，会在入口 `markManualTurn()` 举手；自动巡查 `checkpoint()` 见到就让路（`RANCH_PATROL_YIELD`，5 秒冷却），避免用户点按钮等巡查跑完
- 报价读 `AllCells + GetBag`；执行复用 20 秒内的快照（`transport` 的 `cacheGet`/`cacheSet`），写请求发出即失效
- 读面板（`getState` / `resourceBalances`）走 `fresh: true`，不吃缓存

## 五、牧场活动为什么要单独归类

`ActivityList` 是**全局**列表：请求是空消息，协议里没有场景字段，服务端也不按场景过滤。移植时曾给请求塞 `game_scene_id: 2`，但该字段在 proto 里不存在，protobufjs 直接丢掉——结果牧场页拿到的是农场同一份数据，页面出现「奶茶热销中」，真正的牧场活动反而看不见。

现在按活动自身的界面标识归类：

| 信号 | 来源 | 说明 |
| --- | --- | --- |
| `extra.uid` 前缀 `Muge` | `ActivityContent.extra`（UTF-8 JSON） | 牧场活动主界面 `MugeMainUI` |
| 活动 id 前缀 `20261117` | `config/activity-scene.ts` | 牧歌初启主题日；子活动拿不到 uid，用 id 前缀兜底。全局的「故友重逢」是 `2026111800`，不会误伤 |

相关实现：`services/activity-windows.ts`（解 `uid` 与 `tips.txt`，按分组补取缓存 10 分钟）、`config/activity-scene.ts`（`activityScope()` / `isRanchActivity()` / `isGlobalActivity()`）、`services/ranch/state.ts` 的 `ranchActivities()`（只留牧场活动，已结束的去掉）。新增牧场活动时若沿用 `Muge` 前缀或已登记日期段则无需改代码，否则补进 `config/ranch-activity-scope.json` 并调 `reloadRanchActivityScope()` 热更新。

## 六、已知限制（游戏状态导致，不是代码问题）

- 有机罐头为 0 或普通罐头已用尽 → 「喂养」被服务端拒绝，属正常业务态
- 动物都在生产期且 `canHarvest=false` → 收获/催产返回「没有可收取的产物」
- 牧草机已满 → 补草被拒（`RANCH_GRASS_CAPACITY`）
- 棚未建造时 `state=2`，升级按钮不可用

## 七、界面结构

侧边栏只有一个「牧场」入口，分区导航（概览 / 个人 / 图鉴 / 活动 / 好友 / 商城）在内容区顶部吸顶，子页签跟在分区右侧。

- 概览：身份与经验 → 资产/库存 → 动物速览（只显示状态）→ 待处理与今日统计 → 设施 → 运行日志
- 活动：每日分享礼包（`share_id 102`，与农场分享独立）+ 牧场活动卡
- 好友：紧凑卡片网格，展开显示牧场详情与偷取入口

运行日志卡支持 `module` 属性（牧场传 `ranch`）；实时推送的日志快照也要受该筛选约束，否则 WS 一连上就会把筛选结果覆盖成全量日志（`stores/status.ts` 的 `handleRealtimeLogsSnapshot`）。
