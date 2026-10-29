# QQ农场微信端 + Web 面板

> [!NOTE]
> 本项目基于 [liyangpengs/qq-farm-bot](https://github.com/liyangpengs/qq-farm-bot) 原创项目进行二次开发/修改。
> 原项目版权归原作者所有，本版本为二创修改版。
> 当前代码托管于 [lengxiaobingege/qq-farm-bot](https://github.com/lengxiaobingege/qq-farm-bot)。

基于 Node.js 的 QQ 农场微信端自动化工具，提供多账号挂机、农场与好友自动化、作物与超变图鉴、活动中心、商城、数据分析和 Web 控制面板。当前项目版本为 `20261022`，微信游戏协议版本为 `1.15.1.4_20261001`。

> [!IMPORTANT]
> 服务端口说明：后端 API 监听 `3007`，Vite 前端开发服务器监听 `5173`，前端通过 `/api` 代理将请求转发至后端 `http://localhost:3007`。对外部署后请立即修改默认管理员密码，并避免将未加防护的管理端口直接暴露到公网。

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
- 支持抓包 Code 登录和微信扫码登录
- 微信扫码登录后若 loginBuffer 失效，系统会先尝试通过已保存的 refreshToken 刷新 loginBuffer；若无 refreshToken 但保留了 openid+accessToken，则自动重新获取 loginBuffer 再换码，避免扫码后不久即无法登录
- 支持账号启停、状态监控、实时日志和离线提醒
- Web 面板只保留一个超级管理员，不提供注册、普通用户和租户隔离

### 农场自动化

- 自动收获、种植、浇水、除草、除虫、铲除和土地升级
- 自动施肥、多季作物补肥、指定土地类型施肥和化肥自动购买
- 支持一键务农、一键种植、一键收获、一键铲除和一键全收等面板操作
- 支持多种种植策略、背包种子优先级、作物黑名单和执行间隔配置
- 汇总任务、免费礼包、分享奖励、会员礼包、月卡礼包和图鉴奖励等每日状态，并按天自动处理支持的领取项

### 图鉴

- 在“个人 → 图鉴”中查看作物图鉴和超变图鉴的等级、进度及果实收藏状态
- 作物图鉴按游戏配置排序展示作物，收藏奖励统一放在详情弹窗中查看
- 超变图鉴依据 `Illustrated.json` 的 `param` 和 `type` 字段区分黄金果实、活动果实与装扮果实，不依赖果实名或协议奖励分类字段推断
- 超变属性弹窗顶部汇总当前生效加成，等级列表展示属性名称、触发概率或数量，以及已达成状态或所需进度
- 移动端图鉴使用四列果实布局，等级进度和弹窗样式与现有面板保持一致

### 好友互动

- 自动访问好友、偷菜、帮忙浇水、除草除虫及放草放虫
- 支持好友黑名单、安静时段和互动经验上限
- 支持已知好友 GID 的批量维护、同步参数和互动记录查询
- 好友巡查合并为单次访问：每位好友只进一次农场，一次做完帮忙（除草/除虫/浇水）、偷菜和捣乱（放草/放虫）
- 好友上场宠物按天缓存：进好友农场时顺手记录，另有后台分批的每日补齐，“护主犬经验满仍帮忙”不再每轮逐个进农场试探
- 面板可对指定好友执行单次访问或农场操作

### 背包与交易

- 查看背包，使用、出售或批量出售物品
- 根据游戏配置判断活动区间外、活动结束后和道具过期后的物品可售状态
- 查看神秘商人活动商品及购买状态
- 浏览游戏商城商品、价格、折扣和限购信息，并执行购买
- 查询种子、果实、道具和作物收益数据

### 活动中心

- 通过活动列表协议统一展示当前活动和已结束活动；未实现详情页的活动仍会显示，但不可进入玩法页面
- 千星游记：查看赛季与通行证进度，领取可用奖励
- 观星礼录：查看星座进度、点亮星座并领取奖励
- 星砂商店：查看星砂余额和活动商品，执行兑换
- 节令活动：查看当前节令并领取开放奖励
- 鹊桥寄情：查看筑桥阶段、领取鹊桥奖励，并向好友赠送鹊羽香囊
- 雨落成诗：查看雷雨剩余时间和闪电变异配置，兑换或使用天气瓶，并推进气象研究节点
- 活动快照请求采用串行和重复请求合并，避免登录或切换账号时占满游戏网关请求队列
- 青梅酿酒活动已下线，前端不再提供入口；相关协议和实现暂时保留用于兼容

### Web 控制面板

- 概览、个人、活动、好友、分析、神秘商人、游戏商城和设置页面
- Socket.IO 实时状态与日志，全局使用单一暖白液态玻璃界面
- PC 端使用固定侧栏，移动端使用顶部栏和底部导航，并针对常用操作完成响应式适配
- 作物收益分析、策略预览、批量维护作物黑名单
- 设置页统一管理游戏账号、自动化策略、运行环境、管理员密码和下线提醒
- 基于 `pushoo` 的实例级事件推送，可配置通知渠道和离线自动清理时间

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 后端 | Node.js 20、Express 4、Socket.IO 4、TypeScript 5.9 |
| 前端 | Vue 3.5、Naive UI 2、Vue Router 5、Pinia 3、Vite 7、UnoCSS 66 |
| 工程 | pnpm 10.30.2、ESLint 9 |
| 协议 | WebSocket、Protocol Buffers、TSDK WASM |

## 端口说明

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| 后端 API | `3007` | Express + Socket.IO，提供 REST API 和 WebSocket 连接 |
| 前端开发服务器 | `5173` | Vite 开发服务器，通过 `/api` 代理将请求转发至后端 `http://localhost:3007` |

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

### 源码运行

Windows、Linux 和 macOS 均可使用以下方式：

```bash
git clone https://github.com/lengxiaobingege/qq-farm-bot.git
cd qq-farm-bot
pnpm install
pnpm dev
```

`pnpm dev` 会先构建前端，再启动后端服务。启动后访问：

- 本机后端 API：`http://localhost:3007`
- Vite 前端开发服务器：`http://localhost:5173`
- 局域网：`http://<服务器 IP>:3007`

如需分别启动开发服务：

```bash
# 终端 1：Vite 前端开发服务
pnpm dev:web

# 终端 2：后端开发服务
pnpm dev:core
```

只运行 `pnpm dev:core` 并由后端托管页面时，应先执行一次 `pnpm build:web`。

### Linux 后台脚本

```bash
git clone https://github.com/lengxiaobingege/qq-farm-bot.git
cd qq-farm-bot
corepack enable
bash ./start.sh

# 拉取代码后如需忽略缓存并完整重建
bash ./start.sh --rebuild

# 查看日志
tail -f app_dev.log

# 停止服务
bash ./stop.sh
```

`start.sh` 会在依赖缺失或依赖清单变化时执行 `pnpm install --frozen-lockfile`，并按文件更新时间分别判断 Web、Core 是否需要重建。源码和依赖均未变化时会直接复用现有产物；`--rebuild` 可强制完整重建。脚本随后以生产模式后台运行 `node core/client.js`，日志写入 `app_dev.log`，进程号记录在 `app_dev.pid`。`stop.sh` 会校验 PID 对应的工作目录和启动命令，再停止整个服务进程组。

前端类型检查已与生产构建拆分，需要单独检查时执行 `pnpm typecheck:web`。

## 项目结构

```text
qq-farm-bot/
├── core/                  # Node.js 后端、账号 Worker 与协议实现
│   ├── src/
│   │   ├── controllers/   # Web API 与鉴权路由
│   │   ├── core/          # 单账号 Worker 与任务调度
│   │   ├── runtime/       # 多账号运行时和状态同步
│   │   ├── services/      # 农场、好友、图鉴、活动、商城、微信登录等业务
│   │   ├── proto/         # Protocol Buffers 定义
│   │   ├── gameConfig/    # 作物、道具、等级、图鉴与属性加成等游戏配置
│   │   └── models/        # 超级管理员、游戏账号与配置持久化
│   └── data/              # 源码模式运行数据
├── web/                   # Vue 3 Web 面板
│   ├── src/components/    # 农场、图鉴、背包、任务、活动与基础组件
│   ├── src/stores/        # Pinia 状态管理
│   ├── src/views/         # 各功能页面
│   └── dist/              # 前端构建产物
├── docs/                  # 项目专题文档
├── tools/                 # 配置下载、图片下载与协议分析工具
├── pnpm-workspace.yaml
└── package.json

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 构建前端并启动后端开发服务 |
| `pnpm dev:web` | 启动 Vite 前端开发服务 |
| `pnpm dev:core` | 使用 `tsx` 启动后端 |
| `pnpm lint` | 检查并自动修复前后端代码风格 |
| `pnpm -C core typecheck` | 执行后端 TypeScript 类型检查 |
| `pnpm typecheck:web` | 执行前端 TypeScript 类型检查（不参与生产启动） |
| `pnpm build:web` | 构建 Web 面板到 `web/dist/` |
| `pnpm -C web build:compressed` | 构建 Web 并额外生成预压缩 `.gz` 文件 |
| `pnpm -C web build:analyze` | 构建 Web 并生成 bundle 分析报告 |
| `pnpm build:core` | 编译后端 TypeScript |
| `pnpm build` | 依次构建前端和后端 |
| `pnpm -C core test` | 编译 Core 并运行抓包协议、活动和请求并发测试 |

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

## 免责声明

本项目仅供学习与研究用途。使用本工具可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。

## 二创变更摘要

本版本基于原项目进行二次开发，主要变更如下：

- **移除外部 farm-code 换码 fallback**：删除了通过外部 API 接口获取微信登录 Code 的兜底逻辑（`open-api-code.ts`、`open-api-config.ts` 及相关测试），微信换码仅保留本地 `loginBuffer` 方式。
- **微信登录 buffer 失效自动重获**：当 `issueCodeFromLoginBuffer` 失败且无 `refreshToken` 时，若保留了 `openid+accessToken`，会先自动重新获取 `loginBuffer` 再换码，避免扫码登录后不久即无法登录。
- **刷新 Code 路由简化**：`refresh-account-code.ts` 与 `account-routes.ts` 不再透传外部 `fetchFarmCode`，直接调用本地 `issueWxLoginCode`。
- **子进程 Worker 与自动重登简化**：`worker.ts` 与 `wechat-auto-relogin.ts` 移除了外部 fallback 调用，仅使用本地微信会话换取 Code。
- **移除 QQ 端**：不再支持 QQ 扫码登录，删除了与 QQ 登录相关的 `qq-miniapp-auth` 依赖和 NapCat 配置说明，仅保留微信扫码与抓包 Code 登录。

<div align="center">
  <p>如果觉得项目有用，欢迎点一个 Star。</p>
</div>