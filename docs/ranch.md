# 牧场（ranch）模块说明

牧场功能整体移植自上游 [liyangpengs/qq-farm-bot](https://github.com/liyangpengs/qq-farm-bot) 的 `ranch` 实现（PR #134 / #135 / #136）。
原先自研的 `services/pasture`、`/api/pasture` 手动接口、`pasture_*` 配置以及 `animalpb.proto`/`homesteadpb.proto`
已随隔离审计全部下线（详见 `docs/ranch-isolation-audit.md`），牧场协议统一使用自包含的 `ranchv2.proto`。

## 一、为什么不能直接合并上游

- 本地与上游是**两套独立 Git 历史**（`git merge` 直接报 unrelated histories），且本地领先 139 个提交、上游领先 132 个。
- worker 层结构完全不同：上游把 worker 收敛成单个 `core/src/core/worker.ts`，本地是按 `worker/{schedules,api-handlers,runtime-config,state...}.ts` 拆分。
- proto 同名消息字段不同：早期本地 `animalpb` 的 `HarvestRanch` / `FeedAnimal` / `GetRanchDetail` 是按我们自己的抓包手写的，
  与上游从官方定义整理的版本**字段编号语义不同**，直接复用会解码错位。因此改用独立包 `gamepb.ranchv2` 全量承载牧场消息。

因此采用「**按模块移植 + 独立命名空间**」：

| 层 | 处理方式 |
| --- | --- |
| proto | 上游 `animalpb` / `homesteadpb` / `ranchpb` 合并成新包 `gamepb.ranchv2`（`core/src/proto/ranchv2.proto`，139 条消息），在 `utils/proto.ts` 以 `Ranch<名字>` 注册，与本地既有 proto 完全隔离 |
| 服务 | `core/src/services/ranch/`（13 个文件）原样搬入，仅补 `any` 类型标注 |
| 配置 | `core/src/gameConfig/ranch/*.json`（10 份，约 1.1MB）、`core/src/gameConfig/Goods.json`（商店商品，牧场补栏/升级要读）、`core/src/config/ranch-automation.ts`；`config/gameConfig.ts` 补 `getShopGoodsById`（运行时按 runtime-paths 加载，不走静态 import） |
| 网络 | 新增 `utils/network/scene.ts`：`loginGameScene` / `invalidateGameScene` / `applyShareInfos` / `getDailyShareInfo`；`S.user` 增加 `globalSceneId`、`unlockedSceneIds`；`sendMsgAsync` 支持 `beforeSend` / `onSent` 钩子 |
| 调度 | `worker/schedules.ts` 的牧场 tick 改为唤醒 `ranch/automation.run()`，间隔由 `ranch_check_minutes` 决定；开关变化时 `ranchAutomation.resetSchedule()` |
| 接口 | `GET /api/ranch?view=`、`POST /api/ranch/:action/quote`、`POST /api/ranch/:action`、`GET /api/ranch/automation-options` |
| 前端 | `web/src/components/ranch/*`（11 个面板）、`views/Ranch.vue`、`views/RanchOverview.vue`、`stores/ranch.ts`；侧边栏「牧场」进入概览，页内分区：概览 / 个人 / 图鉴 / 活动 / 好友 / 商城 |

## 二、关键适配：场景 2

上游所有牧场写操作都包在 `transport.inScene(2)` 里（先 `PlayerSceneLogin(2)` 切到牧场场景，再发写请求），
这是「请求字节完全正确但服务端一直拒绝」的根因。

实测本账号 `PlayerSceneLogin(2)` 返回 `1045002 该场景还未解锁`，而 `AllCells` / `GetRanchDetail` / `GetBag(global_scene_id=2)`
在场景 1 里都能正常返回牧场数据。因此 `inScene` 做了降级：

1. 场景 2 能进 → 切进去，用回包 `big_farm_scene_ext_data` 解出的 `homestead_cells`；
2. 场景 2 未解锁 → 不切场景，改用 `AllCells` 读当前场景的牧场格子，**30 分钟内不再重试切场**（避免每次操作白跑一条失败请求）；
3. 换账号（gid 变化）时重置该判定。

## 三、接口速查

| 能力 | 路由 |
| --- | --- |
| 快照 | `GET /api/ranch?view=animals\|facilities\|bag\|shop\|market\|cans\|tasks\|illustrated\|activities\|friends&shopId=&hostGid=` |
| 报价（不落库） | `POST /api/ranch/:action/quote`，返回 `expected.signature` |
| 执行 | `POST /api/ranch/:action`，body 需带 `expected.signature`，否则回 `RANCH_OFFER_CHANGED` |
| 动作 | `buy / place / addGrass / useCan / feed / produce / harvest / sell / clean / upgrade / completeUpgrade / claimTasks / reportEntry / exchange / claimIllustrated / claimDailyShare / buyCan / steal / stroke / release / putMosquito / cleanFriend` |

注意：`harvest` / `produce` / `feed` 等按单只动物操作时必须同时给 `ranchId` + `animalId`；批量用 `{ all: true }`。

## 四、自动化开关

`core/src/config/ranch-automation.ts` 定义，落库在账号配置 `automation.ranch_*`，默认值见 `models/store/shared-state.ts`。
非布尔键（`ranch_strategy` / `ranch_bag_fallback` / `ranch_check_minutes` / `ranch_coop_animal` / `ranch_shed_animal`）
在 `normalizeAccountConfig` 里走 `normalizeRanchSetting` 校验，不会被当成布尔值。

`ranch_dry_run` 是演练开关：开启后每轮巡查只调 `prepareAction` 报价并记 `result: 'dry'` 日志，不发任何写请求，
用于新账号或版本更新后先验证「判定逻辑认为该做什么」，再决定是否真正执行。

### 执行效率与让路

- 一次手动操作的读请求：报价读 `AllCells + GetBag`，执行复用 20 秒内的快照（`transport` 的 `cacheGet`/`cacheSet`），
  写请求发出即失效；只有 `harvest` / `produce` / `clean` 用回包 `ranches` 拼新快照，其余动作仍全量读一次。
- 面板请求没有请求班次（`getAmbientRequestClass() === null`），会在入口 `markManualTurn()` 举手；
  自动巡查的 `checkpoint()` 见到就让路（`RANCH_PATROL_YIELD`），5 秒冷却，避免用户点按钮等巡查跑完。
- 读面板（`getState` / `resourceBalances`）走 `inScene(..., { fresh: true })`，不吃快照缓存。

## 五、已验证

- `GET /api/ranch?view=animals` 返回牧场 Lv.9、金券/点券/金豆豆/松果、普通罐头 72.8h、有机罐头 0h、牧草 770、窝 Lv2 4/4（鹅 ×4）。
- 十个视图（animals / facilities / bag / shop / market / cans / tasks / illustrated / activities / friends）全部可读。
- 报价链路：`harvest` / `clean` / `addGrass` / `upgrade` 返回 skipped 或明确业务提示，不再抛服务端原始错误码。
- 前端概览、个人（动物详情卡片、喂养/放生/一键收获）、设置页牧场开关均正常渲染。
- 后端 360 项测试 359 通过 / 1 跳过 / 0 失败，前后端类型检查通过。

## 六、已知限制（游戏状态导致，不是代码问题）

- 有机罐头 0、普通罐头每只动物一生一次已用过 → 按钮点「喂养」会被服务端拒绝，属正常业务态。
- 动物全部处于生产期且 `canHarvest=false` → 收获/催产返回「没有可收取的产物」。
- 牧草机 100/100 已满 → 补草被拒（`RANCH_GRASS_CAPACITY`）。
- 棚（facility id=3）尚未建造，`state=2`，升级按钮不可用。

## 七、牧场活动为什么要单独归类

`ActivityList` 是**全局**列表：`ActivityListRequest` 是空消息，协议里没有场景字段，服务端也不按当前场景过滤。
移植时的实现给请求塞了 `game_scene_id: 2`，但该字段在 proto 里不存在，protobufjs 的 `fromObject` 直接丢弃，
于是牧场页拿到的就是农场同一份数据 —— 页面上出现「奶茶热销中」「故友重逢」，真正的牧场活动反而看不到。

现在按活动自己的界面标识归类：

| 信号 | 来源 | 说明 |
| --- | --- | --- |
| `extra.uid` 前缀 `Muge` | `ActivityContent.extra`（UTF-8 JSON） | 牧场活动主界面 `MugeMainUI`，从「牧歌初启」的 `GetGroup` 原文确认 |
| 活动 id 前缀 `20261117` | `core/src/config/activity-scene.ts` | 牧歌初启主题日；ActivityList 的 `activities` 树只给主活动（00/07）挂 uid，子活动（02/03/04/05/08）拿不到 uid，用 id 前缀整段兜底。全局的「故友重逢」是 `2026111800`（11-18），不会被误伤 |

相关代码：

- `services/activity-windows.ts`：`decodeActivityExtra` 解析 `uid` 与 `tips.txt`（说明文本），并把二者挂到时间窗口上；
  `getActivityGroupExtra(groupId)` 按分组补取内容（缓存 10 分钟），因为牧场活动在 `ActivityList` 里通常没有进度节点。
- `config/activity-scene.ts`：`activityScope()` / `isRanchActivity()` / `isGlobalActivity()`，未识别的活动一律按全局处理，不混进牧场页。
- `services/ranch/state.ts` 的 `ranchActivities()`：只留牧场活动，去掉已结束的，进行中在前、即将开始在后。
- `services/activity-center.ts` 的 `buildActivityDirectory()`：用 `isGlobalActivity()` 反向过滤，农场活动中心只显示全站/农场活动，不再串进牧歌初启、以薯换福；并按服务器时间隐藏 `endTime` 已过的活动（`endTime===0` 视为长期有效；负数为 protobuf 未设置时间的垃圾值如 `DateTime.MinValue`，同样隐藏），与牧场侧 `ranchActivities()` 的"去掉已结束"口径一致——跨天后昨天结束的活动（如奶茶热销中）不再出现在活动中心。判定放在分组聚合之后，取合并后的最大 endTime。

新增牧场活动时：如果界面标识沿用 `Muge` 前缀、或活动 id 落在已登记的牧场日期段，无需改代码；否则把前缀补进 `config/ranch-activity-scope.json`（uid 前缀 / id 前缀 / 精确 id / 排除 id 四类，改完可调 `reloadRanchActivityScope()` 热更新）。

界面图标（2026-11-16）：牧场入口（侧栏/底栏/页头/设置页）用 `i-tabler-horse` 线性骏马，与底栏其余 Carbon 线性图标风格统一（原 `i-fas-horse` 实心骏马笔画过粗、风格不一致）；农场活动中心图标为 `i-carbon-gift`（礼物）。Carbon 集没有动物图标，tabler 的描边骏马是保留马造型又能与 Carbon 协调的最佳选择。uno.config.ts 已注册 tabler 图标集。

资产单位：牧场概览的资产磁贴沿用农场 `formatAssetAmount` 口径（万/亿/兆缩写），与农场资产单位一致；`formatCount`（BigInt 千分位）仍用于经验、产物数量等精确字段。

松果图标：松果（item id=1008，`icon_res=gui/texture/icon/1008/spriteFrame`）此前因图片目录缺 `1008.png` 在商城余额栏显示占位图。已从 QQ 农场官方服务器资源中恢复原始 `1008.png`——该文件在牧场移植提交 `f607a3d` 中曾随官方素材带入（100×100 RGBA，金黄色松塔，与金券/点券/金豆豆/便便同一美术风格），后因目录整理丢失，现按官方原图（SHA-256 `349bd388…c00`）还原，非手绘/第三方图标。`getItemImageById(1008)` 可正确返回图片。资源站为 `cdn-resource.nqf.qq.com/release/remote/delayRes/`，路径经 Cocos manifest 映射为 uuid 后下载。

## 八、界面结构

- 牧场页只有一个侧边栏入口，分区导航（概览 / 个人 / 图鉴 / 活动 / 好友 / 商城）在内容区顶部吸顶，
  子页签紧跟在分区右侧（不再把子页签 teleport 到页头，避免两行相似的导航抢层级）。
- 概览：身份与经验 → 资产 / 库存 → 牧场动物速览（只显示状态，操作去个人页）→ 待处理与今日统计 → 牧场设施 → 运行日志。
  日志固定在页面最后、卡内滚动，不再像农场概览那样占据主体。
- 活动：每日分享礼包（`share_id 102`，与农场分享独立）+ 牧场活动卡（阶段、倒计时、活动说明折叠）。
- 好友：紧凑卡片网格，展开后跨整行显示牧场详情与偷取入口。

运行日志卡支持 `module` 属性（牧场传 `ranch`）。注意实时推送的日志快照也要受该开关约束，
否则 WS 一连上就会把筛选结果覆盖成全量日志（`stores/status.ts` 的 `handleRealtimeLogsSnapshot`）。

