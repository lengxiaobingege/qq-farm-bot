# 故友重逢（好友召回）活动实现计划

> 状态：**研究完成，待一次真实抓包即可实现**。本文是对 `2026-11-17` 多轮探测的存档，
> 目的是让后续接手的人（或下次对话的我们）不必重复试错，照本文档抓一次包就能把自动领奖写完。

## 1. 活动是什么

「故友重逢」是**好友召回类复刻活动**，证据是礼包图标路径 `pack_friendrecall_friend`（friend recall）。

| 项目 | 值 |
| --- | --- |
| 本期主活动 id | `2026111800` |
| 本期子活动 id | `2026111801`（**领奖要用这个**，主 id 会被服务端判"活动未开始"） |
| 活动时间 | 11-16 10:00 ~ 11-23 23:59 |
| 往期 | 7 月 `2026070100` |
| 相关道具 | `101601` 故友重逢礼包、`101625` 回归专属礼包、`101626` 召回成功礼包 |

官方规则（已从活动 extra JSON 完整解析）：

1. **召回老友**：向久未登录玩家发召回邀请，成功回归 1 名得 1 份奖励，**最多 10 份**，超出只累计记录不发奖；
2. **社交互动掉礼包**：回归玩家与好友互相拜访、浇水/除草/除虫，**概率掉落重逢礼包**，每日上限 10 次；
3. 活动结束未领奖励**邮件补发**。

## 2. 已实测确认的事实

用只读协议探测器（`GET /api/activity-center/probe/:groupId`）对在线账号实测：

- **协议完全可读**：
  - 专属配置体 `f109`（46 字节静态配置）：召回上限 `10`、奖励道具 `101625`/`101626`、阈值 `500`/`2000`、冷却 `604800`(7天)/`2592000`(30天)；
  - 子活动 `f5` 是 2975 字节完整 JSON（`{"uid": "FriendRecallUI", "tips": {...}}`），全是 UI 文案，**无协议命令号**；
- **背包当前无相关礼包**，印证"礼包要先领取才进背包"；
- **领奖通道**：所有活动领奖统一走 `gamepb.activitypb.ActivityService.Operate`，帧结构为
  `f1 = activity_id`(string)，`f2 = operate_type`(命令号)，`f3+ = 操作专属参数`；
- **命令号按活动上线顺序递增**：许愿签 `51/52` → 快乐不独享 `69-74` → 萌宠 `27-50` → 奶茶 `158-179`。
  故友重逢 11-16 才上线，命令号应在已知最大值 `179` 附近或之后，**但本地 proto 无定义**。

### 关键卡点：命令号未知

故友重逢的领奖/召回走**活动专属 RPC**（类似 `PetDiaryOperateRequest`，每个活动独立 message），
其命令号和参数结构都不在本地 proto，项目代码与 git 历史里**全部没有**。

## 3. 已排除的路：受控试探（A 方案）

曾尝试"遍历 operate_type 发空参数反推命令号"，**证明走不通**，勿再重复：

| 尝试 | 结果 | 结论 |
| --- | --- | --- |
| 主活动 id `2026111800` + 空参数遍历 cmd | 全部 `1034001 活动未开始` | 主 id 不对，要用子 id |
| 子活动 id `2026111801` + 空参数，cmd 1/9999/50000 对照 | **全部 `1034004 活动参数错误`** | 服务端校验顺序是"参数→活动状态→命令号"，空参数永远卡在第一步，到不了命令号校验 |
| 子活动 id + 万能占位参数（f151~200 塞空 message） | cmd 1/50/100 → `1020001 网络繁忙`，cmd 180 → `1034001` | 构造畸形包导致网关层报错，信号不可靠且有风险 |

**结论**：要穿过参数校验，必须知道命令号对应的那一个字段的准确结构——这又回到"要先知道协议"。
A 方案在当前信息下无解。**相关试探代码已从项目清理，只保留只读的 `rawBase64` 探测能力。**

## 4. 待执行：真实抓包（B 方案）

这是唯一干净、一次到位的解法。流程成熟——项目里的命令号向量（`autumn-official-vectors.json`
等）都是这么拿到的。

### 4.1 你要做的操作（约 2 分钟）

1. 打开游戏里的**故友重逢**活动（微信小游戏，当前协议 `1.16.3.8_20261028`）；
2. 开启抓包（Reqable / Charles / 浏览器 HAR，**导出时必须勾选"保留 WebSocket 消息/帧"**）；
3. 在活动页**手动点一次关键操作**，二选一（能抓到哪个抓哪个）：
   - **"领取召回奖励"**（最理想，直接给出领奖命令号），或
   - **"召回好友 / 发起召回"**；
4. 导出 `.har` 文件给我。

> 提示：抓包可能含账号凭据、网关 Token 和业务数据。导出后本地保存即可，我这边分析时会先清理敏感信息。

### 4.2 我拿到包后的处理（无需你参与）

```bash
# 1) HAR → WebSocket 帧 .bin
node tools/extract-har-frames.js <capture.har> /tmp/recall-frames

# 2) 只解结构（--shape），定位 Operate 帧的字段号
pnpm -C core exec tsx tools/decode-latest-protocols.js /tmp/recall-frames --all --shape
```

从输出里筛出 `service=gamepb.activitypb.ActivityService, method=Operate` 且 `activity_id=2026111801`
的 SEND 帧，读出：

- `f2 = operate_type`（**领奖命令号**）
- `f3+` 的参数结构（uid / 索引 / 数量等）

再用非 `--shape` 模式看字段值，交叉验证，即可确定领奖请求怎么构造。

## 5. 拿到命令号后的实现（已规划好）

1. 新建 `core/src/services/activity-auto/friend-recall-auto.ts`：
   - 读 `GetGroup(2026111801)` 拿召回进度与可领状态（`f109` 配置已可解析）；
   - 走 `ActivityService.Operate` 用实测命令号领取召回奖励；
   - 背包里的重逢礼包（`101601/101625/101626`）复用已验证的 `warehouse.batchUseItems` 自动开包；
2. 接入 `core/src/services/activity-auto/index.ts` 与 `activity_task` 自动化开关；
3. **不做**自动群发召回邀请（会打扰好友、易触发风控）；
4. 补测试、`typecheck`、`build`；改代码需重新构建+重启，账号约 30 秒自动重登。

## 6. 相关文件

| 文件 | 作用 |
| --- | --- |
| `core/src/services/activity-probe.ts` | 只读探测器，`rawBase64` 可离线反复解析原始字节 |
| `core/src/services/activity-center.ts` | `buildActivityDirectory()` 活动过滤（含过期清理） |
| `core/src/services/activity-auto/index.ts` | 活动自动化总入口（待接入本活动） |
| `core/src/services/warehouse.ts` | `batchUseItems`，已验证的背包开包协议 |
| `tools/extract-har-frames.js` | HAR → WebSocket 帧 |
| `tools/decode-latest-protocols.js` | 帧解码，`--shape` 只看字段结构 |
