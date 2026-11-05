# QQ农场智能助手

<p align="center">
  <img src="https://img.shields.io/badge/version-20261102-green" alt="version">
  <img src="https://img.shields.io/badge/protocol-1.16.1.6__20261028-blue" alt="protocol">
  <img src="https://img.shields.io/badge/tests-284%20passing-brightgreen" alt="tests">
  <img src="https://img.shields.io/badge/node-20.19%2B-339933" alt="node">
</p>

> [!NOTE]
> 本项目基于 [liyangpengs/qq-farm-bot](https://github.com/liyangpengs/qq-farm-bot) 二次开发。
> 原项目版权归原作者所有；本版本为二创修改版，仅保留微信端。
> 当前代码托管于 [lengxiaobingege/qq-farm-bot](https://github.com/lengxiaobingege/qq-farm-bot)，已同步官方 v20261102（协议 1.16.1.6_20261028），完整跟进藏品宝典、独立图鉴与双端资源。

基于 Node.js 的 QQ 农场微信端自动化工具：多账号挂机、农场与好友自动化、活动自动化、独立图鉴与藏品、活动中心、商城、数据分析与 Web 控制面板。

---

## 目录

- [功能总览](#功能总览)
- [🔐 管理端安全设计](#-管理端安全设计)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [开发命令](#开发命令)
- [项目文档](#项目文档)
- [二创变更摘要](#二创变更摘要)
- [免责声明](#免责声明)

## 项目截图

|  |  |
| --- | --- |
| ![项目截图 1](https://free.picui.cn/free/2026/08/21/6a87f4e28ce59.jpg) | ![项目截图 2](https://free.picui.cn/free/2026/08/21/6a87f4e2e5557.jpg) |
| ![项目截图 3](https://free.picui.cn/free/2026/08/21/6a87f4e3780bb.jpg) | ![项目截图 4](https://free.picui.cn/free/2026/08/21/6a87f4e398c30.jpg) |
| ![项目截图 5](https://free.picui.cn/free/2026/08/21/6a87f4e8bbbce.jpg) | ![项目截图 6](https://free.picui.cn/free/2026/08/21/6a87f4e90d06c.jpg) |
| ![项目截图 7](https://free.picui.cn/free/2026/08/21/6a87f4e95678d.jpg) | ![项目截图 8](https://free.picui.cn/free/2026/08/21/6a87f4e958eae.jpg) |
| ![项目截图 9](https://free.picui.cn/free/2026/08/21/6a87f4e91bccb.jpg) | ![项目截图 10](https://free.picui.cn/free/2026/08/21/6a87f4e355da8.jpg) |

## 功能总览

### 账号与登录

- 游戏账号无限添加、独立进程 Worker 运行，每个账号单独配置种植、好友、自动化与执行间隔策略
- 微信扫码登录 + 抓包 Code 登录；loginBuffer 失效时自动经 refreshToken / openid+accessToken 链路重获会话，避免扫码后不久即掉线
- 账号启停、实时状态（含游戏角色 ID 同步展示）、实时日志与离线事件推送
- Web 面板全局仅一名超级管理员，无注册、无普通用户、无租户隔离

### 农场自动化

- 自动收获、种植、浇水、除草、除虫、铲除与土地升级
- 自动施肥、多季作物补肥、指定土地类型施肥、化肥自动购买
- 一键务农 / 种植 / 收获 / 铲除 / 全收等面板快捷操作
- 多套种植策略、背包种子优先级、作物黑名单、执行间隔可配置
- 任务、免费礼包、分享奖励、会员礼包、月卡礼包、图鉴奖励等每日状态汇总，按天自动领取

### 活动自动化（`core/src/services/activity-auto/`）

每个活动一个独立文件，串行编排避免触发网关限速；**单步容错**（某一步失败不中断整轮）+ 错误 30 分钟去重，不会刷屏：

| 活动 | 自动化内容 |
| --- | --- |
| 奶茶热销中 | 领收银台收益与工资 → 按店铺等级工位上限补雇员工（24h → 12h → 4h 阶梯降档，有多少花多少）→ 加速收银台 → 升级店铺 → 制作饮品 → 涨薪互动 → 成长基金解锁与领取 |
| 快乐不独享 | 每日快乐值、每日首次分享、可领档位奖励 |
| 节令日历 | 节令开放当天自动执行一次（按北京时间记账）：领奖、本地题库答题（带题目变化防呆）、季度累计奖励 |

### 图鉴

- 作物图鉴与超变图鉴的等级、进度、果实收藏状态一站式查看
- 超变图鉴依据 `Illustrated.json` 的 `param`/`type` 字段区分黄金果实、活动果实与装扮果实，不依赖名称推断
- 超变属性弹窗汇总当前生效加成与等级达成明细；移动端四列布局自适应

### 好友互动

- 自动访问好友、偷菜、帮忙浇水、除草除虫、放草放虫
- 巡查合并为单次访问：每位好友只进一次农场完成全部互动
- 好友上场宠物按天缓存 + 后台每日分批补齐，"护主犬经验满仍帮忙"不再逐个试探
- 好友黑名单、安静时段、互动经验上限、按 GID 批量维护与互动记录查询

### 背包与交易

- 背包物品使用 / 出售 / 批量出售，按活动区间与过期时间智能判断可售状态
- 神秘商人活动商品、游戏商城价格折扣限购与购买
- 种子、果实、道具与作物收益数据查询

### 活动中心

- 活动列表协议统一展示当前与已结束活动；快照请求串行合并，避免占满游戏网关请求队列
- 千星游记（赛季通行证）、观星礼录（星座点亮）、星砂商店（兑换）、节令活动、鹊桥寄情（筑桥/赠礼）、雨落成诗（天气瓶/气象研究）等玩法页面

### Web 控制面板

- 概览、个人、活动、好友、分析、神秘商人、游戏商城、设置页面
- Socket.IO 实时状态与日志流；液态玻璃风格界面，PC 固定侧栏 / 移动端顶部栏 + 底部导航
- 作物收益分析、策略预览、批量维护作物黑名单
- 基于 `pushoo` 的实例级事件推送、通知渠道配置与离线自动清理

## 🔐 管理端安全设计

面板不设注册体系，全局仅一名超级管理员，账号固定为 `admin`。

### 凭据模型

| 阶段 | 触发条件 | 行为 |
| --- | --- | --- |
| **未初始化** | `admin.json` 不存在或标记 `needsSetup` | 登录接口拒绝一切密码尝试，登录页自动切换为「设置管理员密码」表单 |
| **已初始化** | 首次设置完成 | 进入常规登录；设置接口永久失效，无法被再次调用覆盖凭据 |

设计取舍：

- **无预设密码、无默认密码、无后门**。从根上消除"部署后未及时改密"这一最常见的事故窗口——攻击者不存在可以猜的默认值
- **明文密码永不落盘、不经网络回传**。首次设置时密码仅存在于浏览器到服务器的单次请求中，服务端只保存 PBKDF2 派生哈希（`sha512`、10 万次迭代、32 字节随机盐）；此后没有任何命令或接口能读回密码
- **登录页内置 16 位随机密码生成器**：浏览器 `crypto.getRandomValues` 密码学安全随机源，大小写字母、数字、特殊符号四类齐全，剔除易混淆字符 `0O1lI`；生成值自动填入并支持一键复制
- **密码策略**：至少 8 位，且包含大写、小写、数字、特殊符号中的至少 3 类；拒绝常见弱口令字典

### 防爆破与锁定

- 双层限流：每 IP 每分钟最多 10 次请求，登录失败 5 次锁定该 IP 15 分钟，窗口自动过期清理
- 锁定按 IP 分桶而非全局锁账号：单来源暴力尝试不会把账号整体锁死形成 DoS，也无法靠换用户名绕过
- 客户端 IP 经反向代理链路解析，不可伪造
- 登录成功 / 失败（含来源 IP）全部落日志，可审计

### 哈希与找回

- 旧算法（裸 sha256）存量记录在下次成功登录时透明升级为 PBKDF2，无需手动迁移
- 管理员密码丢失后的找回属于服务器运维操作，需要文件系统级访问权限，具体流程不在本公开文档中说明

### 部署侧加固清单

程序边界之外的安全，需要你在基础设施层完成：

- [ ] **不要将 `3007`/`5173` 直接暴露公网**；生产环境用 Nginx/Caddy 反向代理 + HTTPS，面板路径叠加访问控制（IP 白名单或 Basic Auth）
- [ ] `core/data/` 含账号凭据、会话令牌与运行数据：目录权限建议 `700`，纳入备份但**绝不提交到公开仓库**
- [ ] 定期审计 `core/data/logs/` 中 `admin` 模块日志，关注异常来源 IP
- [ ] 公网部署建议配置实例级事件推送（`pushoo`），掉线与异常第一时间知晓

### 端口与网络

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| 后端 API | `3007` | Express + Socket.IO，REST API 与 WebSocket |
| 前端开发服务器 | `5173` | 仅开发用；生产模式由后端托管 `web/dist/` 静态资源 |

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 后端 | Node.js 20、Express 4、Socket.IO 4、TypeScript 5.9 |
| 前端 | Vue 3.5、Naive UI 2、Vue Router 5、Pinia 3、Vite 7、UnoCSS 66 |
| 工程 | pnpm 10.30.2、ESLint 9、node:test（284 个协议 / 活动 / 并发测试） |
| 协议 | WebSocket、Protocol Buffers、TSDK WASM |

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

1. 服务首次启动只创建管理员账号 `admin`，**密码为空**
2. 打开 Web 面板，登录页自动切换为「首次使用 · 设置管理员密码」
3. 自行输入密码并确认；或点击「生成随机密码」生成 16 位强密码自动填入——生成后立即保存或复制
4. 提交后自动登录进入面板；密码请妥善保管，丢失后的找回属服务器运维操作（见上文安全设计章节）

### Linux 后台脚本

```bash
git clone https://github.com/lengxiaobingege/qq-farm-bot.git
cd qq-farm-bot
corepack enable
bash ./start.sh              # 缺依赖或代码变化时自动安装/增量重建

bash ./start.sh --rebuild    # 忽略缓存完整重建
tail -f app_dev.log          # 查看日志
bash ./stop.sh               # 停止服务
```

`start.sh` 按文件更新时间增量判断 Web/Core 是否需要重建，以生产模式后台运行 `node core/client.js`，日志写入 `app_dev.log`；`stop.sh` 校验 PID 的工作目录与启动命令后停止整个进程组。

## 项目结构

```text
qq-farm-bot/
├── core/                  # Node.js 后端、账号 Worker 与协议实现
│   ├── src/
│   │   ├── controllers/   # Web API 与鉴权路由
│   │   ├── core/          # 单账号 Worker 与任务调度
│   │   ├── runtime/       # 多账号运行时与状态同步
│   │   ├── services/      # 农场、好友、图鉴、活动、商城、微信登录等业务
│   │   │   └── activity-auto/  # 活动自动化（每活动一个文件）
│   │   ├── proto/         # Protocol Buffers 定义
│   │   ├── gameConfig/    # 作物、道具、等级、图鉴等游戏配置
│   │   ├── activity-data/ # 活动静态配置与本地题库
│   │   └── models/        # 超级管理员、游戏账号与配置持久化
│   ├── data/              # 运行数据（凭据哈希、账号、日志等，勿提交）
│   └── tests/             # 协议、活动与并发测试（284 个）
├── web/                   # Vue 3 Web 面板
│   ├── src/components/    # 农场、图鉴、背包、任务、活动与基础组件
│   ├── src/stores/        # Pinia 状态管理
│   ├── src/views/         # 各功能页面
│   └── dist/              # 前端构建产物
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
| `pnpm build:web` / `pnpm build:core` / `pnpm build` | 分别或依次构建前后端 |
| `pnpm -C core test` | 编译 Core 并运行 284 个协议、活动与并发测试 |
| `pnpm -C web build:compressed` | 构建前端并额外生成预压缩 `.gz` |
| `pnpm -C web build:analyze` | 构建前端并生成 bundle 分析报告 |

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
- **活动自动化重构**：`activity-auto/` 按活动拆分独立文件，单步容错 + 错误 30 分钟去重；奶茶活动支持阶梯雇佣与按工位上限补满
- **管理员凭据加固**：首次部署不预设密码，由用户在首次登录页自行设置，支持一键生成 16 位随机强密码；服务端仅存 PBKDF2 哈希，不存任何明文
- **日志时间统一北京时间（UTC+8）**

## 免责声明

本项目仅供学习与研究用途。使用本工具可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。

<div align="center">
  <p>如果觉得项目有用，欢迎点一个 Star ⭐</p>
</div>
