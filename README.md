# QQ 农场智能助手

[![version](https://img.shields.io/badge/version-20261121-green)](https://github.com/lengxiaobingege/qq-farm-bot)
[![node](https://img.shields.io/badge/node-20.19%2B-339933)](#环境要求)
[![platform](https://img.shields.io/badge/platform-微信端-blue)](#它是什么)

面向 **QQ 农场微信小程序** 的自动化助手：多账号挂机、农场与牧场自动化、好友互动、活动自动化、图鉴藏品、Web 控制面板。

> [!NOTE]
> 本项目基于 [liyangpengs/qq-farm-bot](https://github.com/liyangpengs/qq-farm-bot) 二次开发，原项目版权归原作者所有。
> 本版本**只保留微信端**，已跟进藏品宝典、独立图鉴与牧场模块；游戏配置与图标同步至 2026-11-21（物品 1176 项、图鉴 329 项、图标 1441 张）。
> 二创改动清单见文末[二创变更摘要](#二创变更摘要)。

**目录**

- [它是什么](#它是什么)
- [快速开始](#快速开始)
- [功能说明](#功能说明)
- [游戏资源更新（配置与图标）](#游戏资源更新配置与图标)
- [运维与排障](#运维与排障)
- [安全设计](#安全设计)
- [项目结构](#项目结构)
- [开发命令](#开发命令)
- [二创变更摘要](#二创变更摘要)

## 它是什么

一个跑在自己服务器上的 Node.js 服务：登录你的农场账号，按策略自动完成日常操作，并通过 Web 面板让你查看状态、调参数、跑活动。

**能做什么**

- 农场：种植 / 收获 / 偷菜 / 浇水 / 除草 / 捉虫 / 施肥（普通与有机策略） / 仓库出售 / 土地升级
- 牧场：窝棚与动物管理、幼崽补栏、罐头分阶段喂养、集市兑换、图鉴、任务、背包、好友巡查与黑名单
- 好友：一键务农、偷取、按优先级拜访、黑名单与冷却
- 图鉴与藏品：普通图鉴、超变图鉴、藏品宝典，支持一键已读与领奖
- 活动：节令日历、奶茶小店、慕格、分享奖励、神秘商人、商城
- 面板：总览 / 好友 / 牧场 / 图鉴 / 活动中心 / 商城 / 个人 / 分析 / 设置
- 通知：基于 [pushoo](https://github.com/imaegoo/pushoo) 的多渠道推送，掉线延迟判定、去重

**边界**

- 只支持微信端登录（扫码 / Code），不包含 QQ 端
- 不提供账号、不破解、不代练；凭据只存在你自己的服务器上
- 依赖游戏协议，游戏更新后可能需要同步配置（见[游戏资源更新](#游戏资源更新配置与图标)）

## 快速开始

### 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | 20.19 或以上 |
| pnpm | 10 或以上（推荐用 `corepack enable`） |
| 系统 | Linux / macOS / Windows 均可，长期建议 Linux |

### 步骤一：获取并构建

```bash
git clone https://github.com/lengxiaobingege/qq-farm-bot.git
cd qq-farm-bot
corepack enable
pnpm install
pnpm build          # 构建前端 + 编译后端
```

### 步骤二：启动

```bash
cd core && node dist/index.js      # 前台试跑
```

或使用仓库自带脚本（Linux，后台常驻）：

```bash
./start.sh                          # 启动，并建立 3000 → 3007 的转发
./stop.sh                           # 停止
./watchdog.sh                       # 健康检查，异常自动拉起
```

> 默认后端监听 `3007`，对外入口固定 `3000`（`.env` 里 `PORT` 可调后端端口，`start.sh` 会重建转发）。
> 建议只把 `3000` 暴露出去，`3007` 仅本机访问。

### 步骤三：首次登录

1. 打开 `http://<服务器IP>:3000`
2. 首次部署**没有预设密码**，页面会引导你设置管理员账号与密码（`/api/setup`）
3. 设置完成后自动登录

**关于验证码**：新设备登录需要 6 位验证码，验证码通过你配置的推送渠道发送。这里有两条规则要知道：

- 系统里**没有任何受信任设备**时，首台设备登录会自动完成引导并信任，不需要验证码
- 换了浏览器 / 清了缓存 / 导入旧数据后，如果收不到验证码，用救援工具重置：
  ```bash
  node tools/admin-rescue.js                 # 查看受信任设备与会话数量
  node tools/admin-rescue.js --reset-trust   # 备份后清空，重启后重新引导
  systemctl restart qq-farm-bot
  ```

### 步骤四：添加游戏账号

面板 → 账号 → 添加 → 用微信扫码（或填入抓包得到的 Code）。扫码成功后账号进入运行状态，日志里会看到「微信离线自动重新登录成功」。

### 步骤五：确认在跑

- 总览页能看到在线时长、等级、金币、土地状态
- `core/data/logs/` 下当日日志持续有巡田、好友巡查、牧场巡查记录

## 功能说明

### 农场自动化

按作物优先级与季数自动种植、收获、补种；支持多季作物、土地等级匹配、缺货回退；肥料策略分普通/有机两套（可按剩余次数与阈值配置）；巡田失败后进入冷却，避免对必然失败的请求反复重试。

### 牧场自动化

牧场模块已与上游同步，覆盖窝棚、动物、集市、图鉴、任务与背包：

- **动物管理**：窝棚分组、幼崽补栏、健康与产出状态；一键喂养支持普通与有机罐头分阶段配置，罐头桶无可用时长时跳过本轮
- **集市与兑换**：松果、仓鼠集市按货币拆分独立开关，按到访通知排队兑换，避免并发抢占
- **图鉴**：牧场图鉴与巨型图鉴，支持一键已读、成熟后自动领奖
- **好友**：牧场好友巡查与偷取、按场景同步好友名单、好友黑名单（服务端拒绝拜访的非好友自动拉黑）
- **背包与设施**：牧场背包出售、罐头与棚舍升级、货架自动更新

### 好友互动

一键务农（帮种/帮收/浇水/除草/捉虫）、偷取成熟作物、按好友优先级排序拜访；黑名单与 10 分钟同类去重，避免刷屏与无效请求。

### 图鉴与藏品

普通图鉴、超变（黄金）图鉴、藏品宝典三个体系；支持单条与整页「一键已读」，图鉴升级奖励可自动领取。图鉴里的名称与图标来自客户端配置，见下一节。

### 活动自动化

节令日历（仅节令开始后领取与答题，当天只跑一次）、奶茶小店（阶梯雇佣，24h 不够自动降档）、慕格、分享奖励、神秘商人自动购买。

### Web 控制面板

总览、好友、牧场、图鉴、活动中心、商城、个人、分析、设置、配置管理。前端 `Vue 3 + Naive UI`，后端 Express，同源部署，无需单独起前端服务。

### 事件推送与掉线判定

断线先进入 150 秒的挂起窗口等待自动重登，只有终态才推送；同账号同类事件 10 分钟内去重。推送渠道基于 pushoo，可填企业微信机器人、PushPlus、钉钉、Server 酱、Telegram、Bark 或自定义 webhook，以设置页下拉项为准。

## 游戏资源更新（配置与图标）

游戏每次版本更新都会新增作物、动物、道具与活动条目。本地配置落后时会出现三类症状：图鉴/背包里显示成「种子1046038」这类纯 ID、格子只有占位图、牧场新动物在选项里缺失。

原因是**服务端只下发物品 ID，名称与图标都在客户端资源包里**，所以必须同步客户端配置。

### 方式一：从微信小程序缓存取版本（推荐，无需反编译）

微信 PC 端运行过小程序后，会把远程资源清单缓存在本地：

```
%APPDATA%\Tencent\xwechat\radium\users\<用户ID>\applet\local\wx5306c5978fdb76e4\usr\gamecaches\cacheList.json
```

该文件是「CDN URL → 本地缓存文件」的映射，形如：

```
https://cdn-resource.nqf.qq.com/release/remote/mainscene/config.8e8d5.json
https://cdn-resource.nqf.qq.com/release/remote/plant/config.28471.json
```

对每个 bundle 取 `lastTime` 最新的一条，即可得到 `settings.json` 需要的内容：

```json
{
  "assets": {
    "server": "https://cdn-resource.nqf.qq.com/release/",
    "bundleVers": { "mainscene": "8e8d5", "plant": "28471", "animal": "c86eb" },
    "remoteBundles": ["mainscene", "plant", "animal", "extraRes", "delayRes", "audio", "petdog", "commonRes", "mcRes"]
  }
}
```

放到一个空目录的 `src/settings.json`（例如 `/root/fakesrc/src/settings.json`），然后：

```bash
# 1) 下载配置
node tools/download-game-config.js --source /root/fakesrc --output /root/gc

# 2) 按配置下载图标
node tools/download-game-images.js --input /root/gc --output /root/imgs --source /root/fakesrc --concurrency 16
```

### 方式二：使用反编译源码目录

已经反编译过小程序（`wx5306c5978fdb76e4`）时，直接把源码目录传给 `--source`，工具会读 `src/settings*.json`：

```bash
node tools/download-game-config.js --source <反编译源码目录> --output <输出目录>
```

### 落盘与收尾

```bash
D=core/src/gameConfig

# 配置：先备份再覆盖
cp $D/*.json /root/gc-backup-$(date +%Y%m%d-%H%M%S)/
cp /root/gc/{ItemInfo,Plant,Illustrated,RoleLevel,Land,MutantEffect,BuffCfg}.json $D/

# 图标：只补缺失，然后统一压缩
rsync -a --ignore-existing /root/imgs/ $D/seed_images_named/seed_images/
pngquant --quality=70-96 --speed 3 --ext .png --force $D/seed_images_named/seed_images/*.png

systemctl restart qq-farm-bot
```

启动日志会打印实际加载条数，可作为校验：

```
[配置] 已加载植物配置 (323 种)
[配置] 已加载物品配置 (1176 项)
[配置] 已加载图鉴配置 (329 项)
```

再查 `/api/illustrated`，若「无图 0、名字退化 0」即同步完成。

> [!TIP]
> - 图标目录用 pngquant 可压掉约 60%（22.8MB → 9.1MB），肉眼无损，适合经隧道/公网访问面板
> - `/game-config` 已下发 `Cache-Control: public, max-age=31536000, immutable`，图片 URL 带 `?v=<mtime>` 自动失效；若前面有 Cloudflare，换图后可按新 URL 预热一遍边缘缓存
> - `download-game-images.js` 报 `PATH_NOT_FOUND` 的条目属于客户端本身没有该资源，可忽略
> - 启动日志出现 `已加载牧场物品配置 (0 项)` 是正常现象：牧场 `MCItemInfo.json` 与主 `ItemInfo.json` 同源，主表已覆盖全部 ID

## 运维与排障

### 端口与网络

| 端口 | 用途 | 建议 |
| --- | --- | --- |
| 3000 | 对外入口（反代/转发到 3007） | 仅暴露这个 |
| 3007 | 后端直连端口 | 只监听回环，或仅内网可达 |

被反向代理或 CDN 挡在前面时，注意 `TRUSTED_PROXY_IPS` 要填真实代理回源 IP，否则登录 IP 判定会失真。

### 后台常驻（Linux / systemd）

```ini
[Unit]
Description=QQ Farm Bot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/qq-farm-bot/core
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now qq-farm-bot
```

### 常见问题

| 问题 | 处理方式 |
| --- | --- |
| 扫码登录后不久掉线 | 会自动用 refreshToken 或 openid + accessToken 重获会话；持续掉线重新扫码即可 |
| 重启后面板掉登录 | 管理端会话持久化在 `core/data/admin-sessions.json`，正常情况下不会掉；若丢失，重新用密码登录 |
| 新浏览器登录要验证码但收不到 | 先确认设置页推送渠道可用；再不行执行 `node tools/admin-rescue.js --reset-trust` 后重启，让这台设备重新引导 |
| 导入旧数据后登录要求验证码 | 旧数据里的受信任设备属于旧机器的浏览器，新浏览器必然不匹配，同样用 `admin-rescue` 重置 |
| 验证码推送失败 | 验证码会写入本地日志：`journalctl -u qq-farm-bot \| grep 登录验证码`，或查看 `core/data/logs` 当日日志 |
| 图鉴/背包出现「种子xxxxxxx」或空白格 | 客户端配置落后，按[游戏资源更新](#游戏资源更新配置与图标)同步 |
| 某个按钮报 404 | 多为接口未接线（模块移植遗漏），检查 `controllers/admin/*.ts` 是否挂载对应路由 |
| 活动自动化没执行 | 确认设置页对应活动开关已启用；活动结束会自动静默 |
| 端口被占用 | 改 `.env` 的 `PORT`（后端），对外仍用 `3000` |

### 数据与备份

运行数据全部在 `core/data/`，**不要提交到仓库**：

| 文件/目录 | 内容 |
| --- | --- |
| `accounts.json` | 账号列表与游戏登录凭据 |
| `account-configs/<id>.json` | 单账号完整配置 |
| `store.json` | 公共配置（系统 / 通知 / 界面） |
| `admin.json` | 管理员凭据哈希与受信任设备 |
| `admin-sessions.json` | 管理端会话 |
| `.secret.key` | 敏感字段加密密钥 |
| `logs/` | 运行日志 |
| `backups/` | 加密备份 |

备份与恢复：

```bash
node tools/restore-data-backup.js --list        # 列出可用备份
node tools/restore-data-backup.js               # 恢复最近一份
node tools/restore-data-backup.js 2026-11-06    # 恢复指定日期（按 --list 里的日期）
```

恢复前会自动把当前 `core/data` 复制为 `core/data.pre-restore-<时间戳>/`；解密依赖 `core/data/.secret.key`，该文件丢失则旧备份无法还原。

### 从零排查顺序

1. `systemctl status qq-farm-bot` 看进程
2. `journalctl -u qq-farm-bot -n 100` 看最近日志
3. 面板总览看账号是否「运行中」、在线时长是否在涨
4. 查 `/api/ping` 确认后端存活
5. 面板 404/401 时，用不带 token 的 `curl -X POST` 探测：**401 = 路由存在，404 = 未挂载**

## 安全设计

- **凭据**：管理员密码用 PBKDF2 哈希存储，不落明文；游戏凭据写入账号文件前用 `.secret.key` 加密
- **设备验证**：新设备登录需 6 位验证码，验证通过后 30 天内免二次验证；无任何受信任设备时允许首台设备引导
- **防爆破**：登录失败计数 + 锁定 + 找回挑战，均按客户端 IP 判定（`TRUSTED_PROXY_IPS` 决定取哪个头）
- **会话**：令牌落盘持久化，重启不掉线；改密码或撤销设备会立即失效全部会话
- **跨域**：只允许同源与白名单，反向代理改写 Host 不会导致面板异常
- **静态资源**：`/game-config` 一年期 immutable 缓存，带 `?v=` 版本参数
- **HTTPS（可选）**：支持内置证书自启，也可放在 Nginx/Caddy 后面

部署侧加固清单：改默认端口暴露面、限制 `3007` 仅回环、管理端强密码、通知渠道使用专用机器人、定期轮换 `.secret.key` 与备份、不要把 `core/data` 放进 Git。

## 项目结构

```
qq-farm-bot/
├── core/                     # 后端
│   ├── src/
│   │   ├── config/           # 配置装配（含游戏配置加载）
│   │   ├── controllers/admin/# HTTP 路由（auth/farm/friend/commerce/...）
│   │   ├── core/             # 主进程、worker、协议调度
│   │   ├── models/           # 存储、认证、会话、挑战
│   │   ├── proto/            # Protobuf 定义（含 ranchv2）
│   │   ├── runtime/          # worker 管理、data-provider
│   │   ├── services/         # 业务：farm / ranch / friend / activity / illustrated ...
│   │   ├── gameConfig/       # 游戏静态配置与图标（可更新）
│   │   └── utils/            # 网络、proto、日志、加密
│   ├── tests/                # 协议、活动、并发测试
│   └── data/                 # 运行数据（不入库）
├── web/                      # 前端（Vue 3 + Naive UI + Vite）
├── tools/                    # 抓包分析、配置下载、备份恢复、登录救援
├── docs/                     # 专题文档
└── start.sh / stop.sh / watchdog.sh / preflight.sh
```

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 构建前端并启动后端开发服务 |
| `pnpm dev:web` / `pnpm dev:core` | 分别启动前端 / 后端 |
| `pnpm lint` | 前后端代码风格检查与修复 |
| `pnpm -C core typecheck` / `pnpm typecheck:web` | 类型检查 |
| `pnpm build:web` / `pnpm build:core` / `pnpm build` | 构建 |
| `pnpm -C core test` | 运行协议、活动与并发测试 |
| `SLOW_OFFLINE_E2E=1 pnpm -C core test` | 连同掉线兜底慢测一起跑（约 3 分钟） |
| `pnpm -C web build:compressed` | 构建前端并生成预压缩文件 |

抓包协议分析：

```bash
pnpm -C core exec tsx ../tools/decode-latest-protocols.js <capture-dir>
pnpm -C core exec tsx ../tools/audit-capture-compatibility.js <capture-dir>
```

工具一览见 [docs/tools.md](docs/tools.md)，专题文档见 [docs/](docs/README.md)（牧场、活动协议、图鉴藏品、配置存储、网络并发模型等）。

## 二创变更摘要

- 仅保留微信端：移除 QQ 端登录与相关任务
- 微信登录 buffer 失效自动重获；被挤下线后自动重登
- 活动自动化按活动拆分独立文件，单步容错 + 错误 30 分钟去重；奶茶支持阶梯雇佣与按工位上限补满
- 管理员凭据加固：首次部署不预设密码，PBKDF2 哈希存储，支持一键生成强密码
- 设备验证与登录救援：新设备验证码、无设备时首台引导、`tools/admin-rescue.js` 一键重置
- 掉线提醒延迟判定（150 秒）+ 同类 10 分钟去重；会话整点保活
- 日志时间统一为北京时间（UTC+8）
- 游戏资源更新流程：从微信小程序缓存读 bundle 版本，直接跑 `download-game-config.js` / `download-game-images.js`，无需反编译
- 游戏图片统一 pngquant 压缩（约降 60%），`/game-config` 下发一年期 immutable 缓存
- 牧场模块与上游同步：窝棚补栏、罐头分阶段喂养、集市按货币拆开关、好友黑名单、巨型图鉴一键已读

## 免责声明

本项目仅供学习与研究用途。使用本工具可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。请勿用于商业用途或大规模批量操作。

<div align="center">
  <p>如果觉得项目有用，欢迎点一个 Star ⭐</p>
</div>
