# 个人页宠物协议

> **适用版本**：`1.15.x`（2026-09-14 抓包）
> **现状**：字段结论仍有效；`field_10` 与守护记录请求字段语义未证明
> **实现**：`core/src/services/pets.ts`

个人 → 宠物页的每个动作都是一次 `gamepb.dogpb.DogService` RPC。

## 一、状态位怎么判

`GetDogInfoReply.dogs[]` 是 `DogInfo`。别被前两个字段骗了：

| 字段 | 实际表现 | 能不能用来判断 |
| --- | --- | --- |
| `status`（field 4） | **所有图鉴项都返回 1** | 不能 |
| `level`（field 5） | **所有项都返回 100** | 不能 |

真正的状态位：

| 字段 | 含义 | 依据 |
| --- | --- | --- |
| `field_6` | 背包里有同 ID 宠物卡 → 1 = 可激活 | 激活前只有 `field_6`，同时 `ItemService.Bag` 里存在 `90031`（uid 3069） |
| `owned` | 已激活（可上场） | `ActivateDog` 后 `field_6` 消失、`owned` 出现；`DeployDog` 只接受带 `owned` 的 |
| `field_10` | 疑似"新获得未查看"（激活后出现、`ViewDog` 后消失） | 语义未完全证明，**不参与业务判断** |

宠物本体是 `type = 8` 的道具，所以"有卡片"和"已获得宠物"是两件事：**卡片只是激活材料，激活时被服务端消耗**。

## 二、激活

```
ActivateDogRequest { dog_id = 1 }
ActivateDogReply   { dog = 1 }        // field 1 = 激活后的 DogInfo
```

样本（比熊犬 90031，`ws_00148` / `ws_00149`）：

```
请求: 08afbf05
回包: 0a1c 08afbf05 1209e6af94e7868ae78aac 188827 2001 2864 3001 3801 5001
       │    │        │                       │      │    │    │    │    └ f10
       │    │        │                       │      │    │    │    └ owned
       │    │        │                       │      │    │    └ f6
       │    │        │                       │      │    └ lv(100)
       │    │        │                       │      └ st(1)
       │    │        │                       └ price
       │    │        └ name = 比熊犬
       │    └ id = 90031
       └ DogInfo
```

激活成功后服务端**紧接着推 `ItemNotify`**：宠物卡 90031（uid 3069）`delta = -1` —— 卡片被消耗的证据。

实现：`activateDog()` 发请求前用 `field_6` 或背包卡片算出的 `activatable` 校验，发完再拉一次快照确认 `owned`。

## 三、上场与收回

| 操作 | 请求 | 回包 | 注意 |
| --- | --- | --- | --- |
| 上场 | `DeployDogRequest { dog_id = 1 }` | `DeployDogReply { dog_id = 1 }` | 只能对已激活的用；成功后 `current_dog_id` 变为该 ID，并推 `DogSkinChangeNotify` |
| 收回 | `WithdrawDogRequest {}`（真实为空体） | `WithdrawDogReply { dog_id = 1 }` | 收回后 `current_dog_id` 缺失 |

## 四、狗粮

- `AddFoodRequest { item_id = 1, count = 2 }` 是狗盆「确定」，回包 `protect_time` 是使用后的剩余秒数。走 `DogService`，**不是** `ItemService.Use`
- `GetDogInfoReply.items[].status`（field 3）是**状态位不是库存**，三种狗粮都可能返回 1；真实库存必须查 `ItemService.Bag`

## 五、守护记录

`GetProtectLogsRequest { field_1 = 1, count = 2, field_3 = 3 }`，真实点击固定发 `{ 0, 100, 0 }`。字段 1/3 语义未证明，**不要解释成分页或筛选**。

## 六、验证

以上来自 2026-09-14 真实抓包（`pnpm -C core exec tsx ../tools/decode-latest-protocols.js <capture-dir> --all`）：激活链路以 `ws_00148` / `ws_00149` 验证回包字节与 `ItemNotify`。语义未证明的字段保留原始观察，不参与业务。

> 易错点：把 `items[].status` 当库存 → 狗粮数量永远显示"有"，喂食时才发现为 0。
