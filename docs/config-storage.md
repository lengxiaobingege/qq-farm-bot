# 配置存储与备份

运行数据全部在 `core/data/`（打包版为实例目录下的 `data/`）。本文说明每个文件装什么、怎么迁移、怎么备份还原，以及哪些文件**绝不能**进 Git。

## 一、文件清单

| 文件 / 目录 | 内容 | 敏感 |
| --- | --- | --- |
| `accounts.json` | 账号列表、下一个账号编号、登录凭据（加密） | 是 |
| `account-configs/<id>.json` | 单账号完整配置（自动化开关、间隔、名单） | 是 |
| `account-configs/.format.json` | 逐账号配置格式版本，当前 `1` | 否 |
| `store.json` | 公共配置：系统、登录、通知渠道、界面 | 是 |
| `admin.json` | 管理员用户名、PBKDF2 哈希、受信任设备列表 | 是 |
| `admin-sessions.json` | 管理端会话令牌（重启不掉线靠它） | 是 |
| `login-attempts.json` | 登录失败计数与锁定状态 | 否 |
| `.secret.key` | 敏感字段加密密钥（账号凭据、备份） | **是** |
| `backups/data-backup-*.enc` | 加密备份 | 是 |
| `event-notify-state.json` | 掉线提醒周期状态（重启后不重复推） | 否 |
| `kickout-guard.json` | 被挤下线的让位档位与截止时间 | 否 |
| `logs/` | 运行日志（按日切分） | 是 |
| `seed/`、`qrcode` 等 | 扫码临时产物 | 是 |

账号编号直接作文件名；非数字的历史编号会做可逆十六进制编码，避免路径穿越与 Windows 保留名冲突，**编号本身不变**。

## 二、配置拆分与迁移

`store.json` 早期把所有账号配置塞在一个字段里（`accountConfigs`）。现在拆成 `account-configs/<id>.json`，只在主进程启动时迁移一次。

迁移步骤：

1. 读旧 `store.json`；没有旧文件、或 `accountConfigs` 为空 → 跳过，不建目录不建备份
2. 校验每个账号配置，原文件复制一份 `.bak`
3. 写到 `account-configs.migrating-<随机>/`，逐个读回核对，写格式标记
4. 整个临时目录 rename 成 `account-configs/`，一次性发布
5. 从 `store.json` 删除旧字段，写入 `accountConfigStorageVersion: 1`

失败行为：发布前写失败 → 旧 `store.json` 仍然有效，下次启动重试；发布后清理失败 → 报错但不覆盖，下次以已发布目录为准继续清理。临时目录永远不会被当作正式配置读取。

**降级注意**：旧版本不认识逐账号格式。要降级必须先停服，把逐账号配置合回旧格式，或整套还原升级前的备份（接受备份后的改动丢失）。只替换 `store.json` 不会让新版放弃 `account-configs/`。

## 三、缓存与写入

- 账号列表首次读入后缓存在主进程内存；增删改在**成功落盘之后**才更新缓存
- 缓存不依赖文件监听或后台定时器；手改文件后要重启进程
- 保存是同步落盘，成功才发布内存新值；失败抛 `STORAGE_READ_FAILED` / `STORAGE_WRITE_FAILED` / `STORAGE_MIGRATION_FAILED`，接口不会把失败报成成功
- 文件存在但损坏、格式版本不支持、目录缺格式标记 → 明确失败并保留原文件，**不会按空数据覆盖**
- `persist: false` 的快照只用于 worker 内存同步，不落盘

多个文件之间没有跨文件事务：账号配置写成功、公共设置写失败是可能的，调用方应分别确认。

## 四、备份与还原

自动备份由 `services/data-backup.ts` 完成，写到 `core/data/backups/`，用 `.secret.key` 派生密钥加密。

```bash
node tools/restore-data-backup.js --list        # 列出备份（按日期）
node tools/restore-data-backup.js               # 还原最近一份
node tools/restore-data-backup.js 2026-11-06    # 还原指定日期
```

还原流程：先把当前 `core/data` 复制成 `core/data.pre-restore-<时间戳>/`，再解密覆盖。**`.secret.key` 丢了，旧备份就解不开**，所以密钥要和备份分开保管，别只存一份。

手工备份（停服后整目录打包，最稳）：

```bash
systemctl stop qq-farm-bot
tar czf /root/qqfarm-data-$(date +%F).tgz -C /opt/qq-farm-bot/core data
systemctl start qq-farm-bot
```

`.bak` 文件只是迁移前的公共配置副本，不能当完整备份用。

## 五、安全底线

- `core/data/` 已在 `.gitignore`；提交前用 `git status` 确认没有 `data*`、`*.secret.key`、`admin-sessions.json`
- 目录权限建议 `700`，文件 `600`（工具写盘时已按此设置）
- 换机器时先只拷 `data/`，**别把 `.secret.key` 提交到任何仓库**
- 备份文件可以离线存一份，但不要放进公开的同步盘或 Git
