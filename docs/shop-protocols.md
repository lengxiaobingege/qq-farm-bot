# 商城与购买协议

> **适用版本**：`1.16.3.8_20261028`（2026-11-02 复核）
> **样本**：神秘商人 2026-08-14；商城/道具商店 2026-09-24 完整回包 + 2026-11-02 实购
> **现状**：仍有效。字段号与陷阱来自抓包逐字节核对，改动前请重新抓包比对

覆盖三套彼此独立的接口：神秘商人、游戏商城（Mall）、道具商店（Shop）。它们**不共用**同一个 service，别按名字混用。

## 一、通用约定

网关外层统一是 `gatepb.Message`：`meta` 描述 service/method，`body` 是业务 protobuf。

- 请求 body 经 TSDK `ba` 变换；**服务端响应在抓包里已经是明文 protobuf，不要再调 TSDK 解密**
- 解码脚本用 `tools/decode-shop-protocols.js`，输出里 `roundtrip: true` 表示"解码后重新编码"与原始 body 字节完全一致，可用来确认没漏 wire 字段

## 二、神秘商人

`gamepb.mysteryshoppb.MysteryShopService.GetActiveNPC`

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `is_active` | bool | 是否存在有效商人（样本为 `true`） |
| `npc` | ActiveNPC | 一条活动商品/配置 |
| `active_time` | int64 | 开始 Unix 秒；样本 `2026-08-05 16:27:15`（东八区） |
| `expire_time` | int64 | 结束 Unix 秒；样本为次日同一时刻 |

`ActiveNPC`：

| 字段 | 含义 | 注意 |
| --- | --- | --- |
| `npc_id` | 商人实例 ID | |
| `reward_item_id` | 出售物品 | |
| field 3 | **含义未确认**，暂名 `unknown_field_3` | **不能当商品数量用** |
| `reward_count`（field 4） | 本次获得总量 | 数量看这个 |
| `currency_item_id` | 货币物品 ID | |
| `price` / `original_price` | 折后单价 / 原始单价 | 整批价 = 单价 × `reward_count` |
| `discount_percent` | 价格百分比 | `60` = 6 折 |
| field 8 | 协议保留 | 不能发送 |

**样本验证（艾草种子）**：field 3 = 2，`reward_count` = 8，折后单价 6000，原价 10000，`discount_percent` = 60 → 游戏展示 `x8`、原价 80000、6 折、优惠价 48000。**数量是 field 4**，不是 field 3。

## 三、游戏商城（Mall）

### 请求与列表

`GetMallListBySlotTypeRequest`：`slot_type` 是商城槽位；**field 2 是布尔 `is_manual_open`，不是子槽位**。

| slot_type | 商城 |
| --- | --- |
| 1 | 普通商城 |
| 4 | SVIP 商城 |
| 5 | 限时商店 |

2026-11-02 官方请求还带 field 3 `global_scene_id=1`（农场）。响应 `goods_list` 是重复的 `MallGoods` 消息（**不是 bytes**），`refresh_countdown` 是刷新倒计时秒数（样本 27076，与 16:28:43 → 24:00 的剩余秒数一致）。

新增藏品礼包 1047（金豆豆 300 → 奖励 101619）、1048（钻石 40 → 奖励 101618），均由实时目录读取，**不静态推断售价或限购**。商品 field 21/22 为 `bg_pic` / `color`，已保留；购买请求仍然只有商品 ID 与数量。

### MallGoods 字段

| # | 字段 | 说明 |
| --- | --- | --- |
| 1 | `goods_id` | 购买接口使用的 ID |
| 2 | `name` | 展示名 |
| 3 | `goods_type` | 类别枚举，本批普通商品均为 1 |
| 4 | `reward_items` | 一次购买获得的物品列表 |
| 5 | `price` | `corepb.Item`：id=货币 ID，count=单价；空消息代表免费 |
| 6 | `is_free` | 免费标记 |
| 7 | `purchase_limit` | 限购类型/已购/上限 |
| 8 | `is_available` | 官方名 `is_available_purchase`；**不限购商品会省略**，不能凭默认 false 判不可购买 |
| 9 | `discount_text` | 展示文案，如 `7.4折` |
| 10 | `is_discounted` | 官方名 `is_display_countdown`，控制倒计时展示 |
| 11 | `discount_end_time` | 折扣结束 Unix 秒 |
| 12 | `product_type` | 官方名 `goods_type`，是商品类型，**不是可购买标志** |

`PurchaseLimit`：field 1 周期（1 每日 / 2 每周 / 3 每月 / 4 永久），field 2 已购数，field 3 上限。**是否限购看 `purchase_limit` 是否存在且 `limit_type != 0`**。

### 两种藏品礼包实测

各买一次：`Purchase` 的 `count` 均为 1、`success=true`、周限购已购 1/50。金豆豆通过 `ItemNotify` 确认扣 300；钻石通过 `RechargeInfoNotify.info.balance` 确认 302→262（该通知 field 1 是嵌套 `RechargeInfo`，早前按交易号字符串解码是错的）。

「立即使用」在购买后另发 `ItemService.Use`。钻石礼包实际产出 101622 ×1、桃米 700005 ×1、金币 100000 —— **结果取使用回包，不从礼包描述推算**。`UseReply` field 100 的 `random_pack` 返回各奖池剩余数量，已补齐；`used_items` / `items` 字段名保留兼容旧调用。

## 四、道具商店（Shop）

「商店 → 道具」用的是 `gamepb.shoppb.ShopService.ShopInfo(shop_id=4)`，和 Mall 的 SVIP slot 4 是**两套接口**。

`BuyGoodsRequest`：商品 ID、数量、实际单价。回复含 `goods`、`get_items`、`cost_items`。

`GoodsInfo` field 9–14：`is_display_countdown`、`end_time`、`discount_price`、`discount_start_time`、`discount_end_time`、`show_conds`（字符串 `type` / `params`）。

### 实现要点

- 促销期内 `discount_price=0` 会被 proto3 省略，**不能因此回退基础价**；时间为空或负值不构成促销
- 只有普通商城的不限购商品走"不限购"规则，仍要重新校验余额、报价、广告/分享/已拥有；SVIP 仍检查会员资格与商品标志
- 「余额不足」「余额未确认」「SVIP 限定」等限制独立展示，不要统一成「暂不可购买」
- 「开启新田园」= 官方 `NEWBIE_OPEN` 新手开园福利（client ID 171），与地图/蓝晶土地无关。全局目录里的 2026092200/2026092201 时间窗不代表当前账号获准参与，官方还检查活动组、个人参与期限与特权期限。本工具未接入其详情操作

### 验证

2026-09-24 回包 `session-1790215551955/001343-recv.bin` 中，1002/1003/1006（点券化肥、狗粮）与 1007–1017 的单份钻石商品**既无限购消息也无 field 8**；官方 `RechargeProductModel.isNoLimit` 与 `RechargeGiftBuy.buyGiftHandler` 按限购类型与余额判断。同批免费商品 1001 已领 1/1，1044 已购满，界面分别显示「已领取」「售罄」。

2026-11-02 实购：20001 青野农家小屋基础价 5400、促销成交 0，得 201007 ×1、无扣费；20003 青野农家街道成交 2250，得 207007 ×1，扣金豆豆 1005 ×2250。两笔都更新了已拥有与限购状态。

## 五、购买与通知

`PurchaseRequest`：`goods_id` + `count`。响应含商品 ID、`success`（field 2，**不是数量**）、重复 `reward_items`、更新后的 `purchase_limit`。

购买后还会推送：

- `gamepb.itempb.ItemNotify` —— 背包/货币增量
- `gamepb.mallpb.NeedNotify` —— 商城刷新提示

`corepb.Item` 的 field 100 是 `ItemShow` 展示元数据，多数为空；商品 1029 奖励的 29003 带 `sell_price`（货币 1001，数量 12000）。项目保留了这个强类型字段，通知也能无损重编码。

**样本**：商品 1001 ×1 → 化肥 80001 ×1；商品 1029 ×1 → 29003 ×1 + 有机化肥 80011 ×2 + 普通化肥 80001 ×2，扣点券 1002 ×25。

## 六、复现

```bash
pnpm -C core exec node ../tools/decode-shop-protocols.js <capture-dir>
```

## 七、踩过的坑（改代码前必读）

1. 响应已是明文，**不要二次解密**
2. 商人数量是 `reward_count`（field 4），field 3 含义未确认
3. 限购看 `purchase_limit` 存在性，不看 `is_available`
4. 促销期 `discount_price=0` 是 proto3 省略，不是"回退原价"
5. `PurchaseReply.success` 是布尔，不是数量
6. `RechargeInfoNotify` field 1 是嵌套消息，不是交易号
7. Mall 的 slot 4 与 Shop 的 `shop_id=4` 不是一回事
