# 文档中心

本目录存放专题文档：实现原理、协议结论、运维细节。**安装部署、功能开关、常见问题请先看根目录 [README](../README.md)**，这里不重复。

## 按任务找文档

| 我要做什么 | 看哪些 |
| --- | --- |
| 刚部署完，跑不起来 | 根 [README](../README.md) → [配置存储与备份](config-storage.md) |
| 更新游戏配置 / 图鉴缺图 | 根 README 的「游戏资源更新」→ [工具脚本](tools.md) |
| 面板登录不上 / 要重置信任 | 根 README「首次登录」→ [工具脚本](tools.md)（`admin-rescue`） |
| 掉线提醒不推 / 推太频繁 | [事件推送与掉线判定](event-notify.md) |
| 面板卡、后台任务抢请求 | [网络并发模型](network-concurrency.md) |
| 牧场功能异常、写操作被拒 | [牧场模块说明](ranch.md) → [牧场优化记录](ranch-optimization.md) |
| 排查协议字段、解码抓包 | [TSDK 运行约定](tsdk-runtime.md)、[微信连接与掉线诊断](wechat-connection.md)、对应业务协议文档 |
| 维护图鉴 / 藏品 | [图鉴、变异宝典与藏品](collections-20261101.md) |
| 维护商城 / 神秘商人 | [商城与购买协议](shop-protocols.md) |
| 维护宠物 / 狗 | [个人页宠物协议](pet-protocols.md)、[好友宠物缓存](friend-pet-cache.md) |
| 维护某个活动 | 活动文档（[奶茶](milk-tea-20261015.md)、[节令日历](solar-calendar-20261016.md)、[慕格](muge-20261117.md)、[召回](friend-recall-20261118.md)） |

## 文档分两类，别混着用

**活文档**（描述当前实现，代码变了它就该改）

| 文档 | 内容 |
| --- | --- |
| [工具脚本](tools.md) | 配置/图片下载、抓包解码、备份恢复、登录救援 |
| [配置存储与备份](config-storage.md) | 数据文件清单、迁移、缓存、备份与还原 |
| [网络并发模型](network-concurrency.md) | 五个班次、容量上限、让路闸门、定时任务退避 |
| [事件推送与掉线判定](event-notify.md) | 150 秒延迟判定、去重、被挤让位阶梯 |
| [牧场模块说明](ranch.md) | 协议隔离、场景 2 降级、接口速查、开关 |
| [牧场优化记录](ranch-optimization.md) | A/B/C 三批优化的结论与实施状态 |
| [TSDK 运行约定](tsdk-runtime.md) | WASM 来源、宿主映射、ABI、ACE 生命周期 |
| [微信连接与掉线诊断](wechat-connection.md) | 连接适配、掉线定位、版本核对记录 |

**研究记录**（某次抓包的结论，带日期，反映当时版本）

`collections-20261101` / `shop-protocols` / `pet-protocols` / `friend-pet-cache` / `milk-tea-20261015` / `solar-calendar-20261016` / `muge-20261117` / `friend-recall-20261118`

这些文档**不改写结论**，只在开头标注适用范围；游戏版本变化后如果字段对不上，以新抓包为准，并新开文档而不是改写旧的。

**决策记录**（为什么当初这么定，内容冻结）在 [adr/](adr/README.md)：牧场为什么另开 `ranchv2`、旧 pasture 模块的勘误、2026-11-19 上游同步评审。引用时注明是历史依据，不要当作现状。

## 维护约定

- 根目录只留仓库入口 `README.md`；安装部署和用户配置写根 README
- 实现原理、协议结论、工具用法写 `docs/`
- 文档里的路径一律相对仓库根，示例命令默认从仓库根执行
- 新增文档时同步更新本索引和根 README 的「项目文档」表
- 涉及具体版本的结论，标题或开头写清日期与客户端版本
