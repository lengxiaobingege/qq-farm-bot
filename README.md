# QQ农场微信端 + Web 面板

> [!NOTE]
> 本项目基于 [liyangpengs/qq-farm-bot](https://github.com/liyangpengs/qq-farm-bot) 原创项目进行二次开发/修改。
> 原项目版权归原作者所有，本版本为二创修改版，仅保留微信端。
> 当前代码托管于 [lengxiaobingege/qq-farm-bot](https://github.com/lengxiaobingege/qq-farm-bot)，已同步官方 v20261102（协议 1.16.1.6_20261028），完整跟进藏品宝典、独立图鉴与双端资源。

基于 Node.js 的 QQ 农场微信端自动化工具：多账号挂机、农场与好友自动化、活动自动化、独立图鉴与藏品、活动中心、商城、数据分析和 Web 控制面板。

> [!IMPORTANT]
> **安全须知**
> - 首次部署只创建账号 `admin`，**不预设任何密码**；首次打开登录页时由你自行设置密码（账号固定不变）
> - 密码至少 8 位，且包含大写字母、小写字母、数字、特殊符号中的至少 3 类
> - 密码只在首次设置时由你输入，系统不生成、不存储明文、不提供查询命令
> - 忘记密码：停止服务 → 删除 `core/data/admin.json` → 启动服务 → 重新在登录页设置（会清空原密码）
> - 后端 API 监听 `3007`，前端开发服务器监听 `5173`；请勿将未加防护的管理端口直接暴露公网

## 项目截图

|  |  |
| --- | --- |
| ![项目截图 1](https://free.picui.cn/free/2026/08/21/6a87f4e28ce59.jpg) | ![项目截图 2](https://free.picui.cn/free/2026/08/21/6a87f4e2e5557.jpg) |
| ![项目截图 3](https://free.picui.cn/free/2026/08/21/6a87f4e3780bb.jpg) | ![项目截图 4](https://free.picui.cn/free/2026/08/21/6a87f4e398c30.jpg) |
| ![项目截图 5](https://free.picui.cn/free/2026/08/21/6a87f4e8bbbce.jpg) | ![项目截图 6](https://free.picui.cn/free/2026/08/21/6a87f4e90d06c.jpg) |
| ![项目截图 7](https://free.picui.cn/free/2026/08/21/6a87f4e95678d.jpg) | ![项目截图 8](https://free.picui.cn/free/2026/08/21/6a87f4e958eae.jpg) |
| ![项目截图 9](https://free.picui.cn/free/2026/08/21/6a87f4e91bccb.jpg) | ![项目截图 10](https://free.picui.cn/free/2026/08/21/6a87f4e355da8.jpg) |

## 功能概览

### 账号与登录

- 游戏账号可无限添加并独立运行，每个账号可单独配置种植、好友、自动化和执行间隔策略
- 支持抓包 Code 登录和微信扫码登录；扫码登录后 loginBuffer 失效时自动通过 refreshToken / openid+accessToken 重获，避免扫码后不久即掉线
- 支持账号启停、状态监控（含游戏角色 ID 同步展示）、实时日志和离线提醒
- Web 面板只有一个超级管理员，不提供注册、普通用户和租户隔离

### 农场自动化

- 自动收获、种植、浇水、除草、除虫、铲除和土地升级
- 自动施肥、多季作物补肥、指定土地类型施肥和化肥自动购买
- 一键务农、一键种植、一键收获、一键铲除、一键全收等面板操作
- 多种种植策略、背包种子优先级、作物黑名单和执行间隔配置
- 汇总任务、免费礼包、分享奖励、会员礼包、月卡礼包和图鉴奖励等每日状态，按天自动领取

### 活动自动化（`core/src/services/activity-auto/`）

每个活动一个独立文件，串行编排、单步容错（某一步失败不中断整轮）、错误 30 分钟去重刷屏：

| 活动 | 自动化内容 |
| --- | --- |
| 奶茶热销中 | 领收银台收益/工资 → 按工位上限补雇员工（24h→12h→4h 阶梯降档）→ 加速收银台 → 升级店铺 → 制作饮品 → 涨薪互动 → 成长基金解锁与领取 |
| 快乐不独享 | 每日快乐值、每日首次分享、档位奖励 |
| 节令日历 | 节令开放当天自动执行一次（按北京时间记账）：领奖、本地题库答题、季度累计奖励 |

### 图鉴

- 「个人 → 图鉴」查看作物图鉴和超变图鉴的等级、进度及果实收藏状态
- 超变图鉴依据 `Illustrated.json` 的 `param`/`type` 字段区分黄金果实、活动果实与装扮果实
- 超变属性弹窗汇总当前生效加成、等级列表与达成状态；移动端四列布局自适应

### 好友互动

- 自动访问好友、偷菜、帮忙浇水、除草除虫及放草放虫
- 好友巡查合并为单次访问：每位好友只进一次农场做完全部互动
- 好友上场宠物按天缓存 + 后台每日分批补齐，避免"护主犬经验满仍帮忙"逐个试探
- 好友黑名单、安静时段、互动经验上限、按 GID 批量维护与互动记录查询

### 背包与交易

- 背包物品使用、出售与批量出售；按活动区间/过期时间智能判断可售状态
- 神秘商人活动商品、游戏商城价格折扣限购与购买
- 种子、果实、道具和作物收益数据查询

### 活动中心

- 活动列表协议统一展示当前/已结束活动，快照请求串行合并，避免占满游戏网关
- 千星游记、观星礼录、星砂商店、节令活动、鹊桥寄情、雨落成诗等活动页面

### Web 控制面板

- 概览、个人、活动、好友、分析、神秘商人、游戏商城和设置页面
- Socket.IO 实时状态与日志；液态玻璃风格界面，PC 固定侧栏 / 移动端底部导航
- 作物收益分析、策略预览、批量维护作物黑名单
- 基于 `pushoo` 的实例级事件推送、通知渠道与离线自动清理

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 后端 | Node.js 20、Express 4、Socket.IO 4、TypeScript 5.9 |
| 前端 | Vue 3.5、Naive UI 2、Vue Router 5、Pinia 3、Vite 7、UnoCSS 66 |
| 工程 | pnpm 10.30.2、ESLint 9、node:test（284 个协议与并发测试） |
| 协议 | WebSocket、Protocol Buffers、TSDK WASM |

## 端口说明

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| 后端 API | `3007` | Express + Socket.IO，REST API 与 WebSocket |
| 前端开发服务器 | `5173` | Vite，`/api` 代理至 `http://localhost:3007` |

## 快速开始

### 环境要求

| 运行方式 | 要求 |
| --- | --- |
| 源码运行 | Node.js 20.19+、pnpm 10+ |

推荐通过 Corepack 启用项目指定版本的 pnpm：

```bash
corepack enable
pnpm --version
```

### 源码运行（Windows / Linux / macOS）

```bash
git clone https://github.com/lengxiaobingege/qq-farm-bot.git
cd qq-farm-bot
pnpm install
pnpm dev
```

`pnpm dev` 会先构建前端再启动后端。启动后访问：

- 后端 API：`http://localhost:3007`
- 前端开发服务器：`http://localhost:5173`
- 局域网：`http://<服务器 IP>:3007`

分别启动开发服务：

```bash
pnpm dev:web   # 终端 1：Vite 前端
pnpm dev:core  # 终端 2：后端（tsx）
```

只跑 `pnpm dev:core` 由后端托管页面时，先执行一次 `pnpm build:web`。

### 首次登录

1. 服务首次启动只创建管理员账号 `admin`（密码为空）
2. 打开 Web 面板，登录页会自动切换为「首次使用 · 设置管理员密码」
3. 输入自己设定的密码并确认，提交后即自动登录进入面板
4. 忘记密码：停止服务 → 删除 `core/data/admin.json` → 重启 → 回到第 2 步重新设置

### Linux 后台脚本

```bash
git clone https://github.com/lengxiaobingege/qq-farm-bot.git
cd qq-farm-bot
corepack enable
bash ./start.sh              # 缺依赖或代码变化时自动安装/重建

bash ./start.sh --rebuild    # 忽略缓存完整重建
tail -f app_dev.log          # 查看日志
bash ./stop.sh               # 停止服务
```

`start.sh` 按文件更新时间增量判断 Web/Core 是否需要重建，以生产模式后台运行 `node core/client.js`；`stop.sh` 校验 PID 的工作目录与启动命令后停止整个进程组。

## 项目结构

```text
qq-farm-bot/
├── core/                  # Node.js 后端、账号 Worker 与协议实现
│   ├── src/
│   │   ├── controllers/   # Web API 与鉴权路由
│   │   ├── core/          # 单账号 Worker 与任务调度
│   │   ├── runtime/       # 多账号运行时和状态同步
│   │   ├── services/      # 农场、好友、图鉴、活动、商城、微信登录等业务
│   │   │   └── activity-auto/  # 活动自动化（每活动一个文件）
│   │   ├── scripts/       # 运维脚本（如初始密码查询）
│   │   ├── proto/         # Protocol Buffers 定义
│   │   ├── gameConfig/    # 作物、道具、等级、图鉴等游戏配置
│   │   └── models/        # 超级管理员、游戏账号与配置持久化
│   ├── data/              # 运行数据（admin.json、账号、日志等）
│   └── tests/             # 协议、活动与并发测试
├── web/                   # Vue 3 Web 面板
├── docs/                  # 项目专题文档
├── tools/                 # 配置下载、图片下载与协议分析工具
└── pnpm-workspace.yaml
```

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 构建前端并启动后端开发服务 |
| `pnpm dev:web` / `pnpm dev:core` | 分别启动前端 / 后端开发服务 |
| `pnpm lint` | 检查并自动修复前后端代码风格 |
| `pnpm -C core typecheck` / `pnpm typecheck:web` | 后端 / 前端类型检查 |
| `pnpm build` | 依次构建前端和后端 |
| `pnpm -C core test` | 编译 Core 并运行 284 个协议、活动与并发测试 |

### 抓包协议分析

```bash
# 解码指定抓包目录中的协议帧
pnpm -C core exec tsx ../tools/decode-latest-protocols.js <capture-dir>

# 检查抓包 RPC 与本地 Protobuf 定义的兼容性
pnpm -C core exec tsx ../tools/audit-capture-compatibility.js <capture-dir>
```

## 项目文档

专题说明统一收录在 [`docs/`](docs/README.md)：

- [工具脚本](docs/tools.md)
- [网络并发模型](docs/network-concurrency.md)
- [TSDK Node.js 运行约定](docs/tsdk-runtime.md)
- [配置存储、迁移与缓存](docs/config-storage.md)
- [2026-10-22 游戏版本与资源对齐](docs/game-update-20261022.md)
- [雨落成诗活动协议与实现](docs/weather-activity.md)
- [神秘商人、游戏商城与购买协议](docs/shop-protocols.md)
- [好友宠物缓存与每日同步](docs/friend-pet-cache.md)
- [个人页宠物协议](docs/pet-protocols.md)
- [图鉴、变异宝典与藏品](docs/collections-20261101.md)

## 二创变更摘要

- **移除外部 farm-code 换码 fallback**：微信换码仅保留本地 `loginBuffer` 方式
- **微信登录 buffer 失效自动重获**：无 refreshToken 时自动用 openid+accessToken 重获 loginBuffer 再换码
- **移除 QQ 端**：仅保留微信扫码与抓包 Code 登录
- **活动自动化重构**：`activity-auto/` 按活动拆分独立文件，单步容错 + 错误去重；奶茶活动支持阶梯雇佣与工位上限补满
- **管理员凭据加固**：首次部署不预设密码，由用户在首次登录页自行设置（账号固定 `admin`），系统不保存明文
- **日志时间统一北京时间（UTC+8）**

## 免责声明

本项目仅供学习与研究用途。使用本工具可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。

<div align="center">
  <p>如果觉得项目有用，欢迎点一个 Star。</p>
</div>
