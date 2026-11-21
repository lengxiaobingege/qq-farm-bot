# 工具脚本

`tools/` 下的脚本分三类：**游戏资源同步**、**抓包分析**、**运维操作**。全部在仓库根目录执行，只用 Node 内置模块（抓包分析类会加载 `core` 的 protobuf 定义）。

先装依赖并编译，抓包类脚本才能跑：

```bash
pnpm install && pnpm build:core
```

## 一、游戏资源同步

### download-game-config.js

从官方 CDN 下载并校验游戏 JSON 配置，输出到指定目录（默认 `tools/json`）。

```bash
node tools/download-game-config.js --source <目录> --output <输出目录>
```

`--source` 指向一个包含 `src/settings.json` 的目录。两种来源：

| 来源 | 做法 |
| --- | --- |
| 微信 PC 小程序缓存（推荐，无需反编译） | 从 `%APPDATA%\Tencent\xwechat\radium\users\<id>\applet\local\wx5306c5978fdb76e4\usr\gamecaches\cacheList.json` 里取每个 bundle 的最新版本，自己拼一个 `settings.json`，放进 `<目录>/src/` |
| 反编译源码 | 直接把反编译目录传进去，工具自己读 `src/settings*.json` |

`settings.json` 需要的字段：

```json
{
  "assets": {
    "server": "https://cdn-resource.nqf.qq.com/release/",
    "bundleVers": { "mainscene": "8e8d5", "plant": "28471", "animal": "c86eb" },
    "remoteBundles": ["mainscene", "plant", "animal", "extraRes", "delayRes", "audio", "petdog", "commonRes", "mcRes"]
  }
}
```

输出：`ItemInfo / Plant / Illustrated / RoleLevel / Land / MutantEffect / BuffCfg` 落到输出目录根，其余配置进 `allconfig/`。

工具**不会**自动覆盖 `core/src/gameConfig`。它只负责下载与校验（ID 连续、变异 `effect_name`、Plant 引用、土地网格坐标唯一），全部通过才替换输出文件；失败保留上一次成功结果。要不要上线由你决定，落盘步骤见根 README「游戏资源更新」。

### download-game-images.js

按配置下载图标，输出 `<id>.png`。

```bash
node tools/download-game-images.js --input <配置目录> --output <图片目录> \
  --source <settings 目录> --concurrency 16 --retries 2
```

映射规则：`icon_res` 非空时严格按它定位 `cc.SpriteFrame`；为空时用 `asset_name` 拼路径（有 `bundle_name` 走该 bundle 的 `texture/<asset_name>`，否则 `model/v4/<asset_name>_Seed`）。不猜 URL、不模糊匹配、不用占位图兜底。

失败会写进 `download-images-report.json`，并列出三类原因：

| 原因 | 含义 |
| --- | --- |
| `PATH_NOT_FOUND` | manifest 里确实没有这个资源，客户端本身就没图 |
| `PATH_AMBIGUOUS` | 同名资源出现在多个 bundle，无法唯一确定 |
| `UNMAPPABLE_NO_IMAGE_FIELD` | 配置里既无 `icon_res` 也无可用 `asset_name` |

遇到已有的同名文件：内容相同跳过，不同则经临时文件安全替换，失败保留原文件。

### download-mutant-images.js

按 `MutantEffect.json` 下载变异图，输出 `<变异ID>.png`（默认 `tools/img/mutant`）。

```bash
node tools/download-mutant-images.js --input <配置目录> --output <图片目录> --source <settings 目录>
```

与 `download-game-images.js` 共用同一套 manifest 解析逻辑，区别是图源字段来自变异配置而不是物品配置。

### 压缩与缓存

```bash
pngquant --quality=70-96 --speed 3 --ext .png --force core/src/gameConfig/seed_images_named/seed_images/*.png
```

压完建议按新 URL（`?v=<mtime>`）预热一遍 CDN 边缘缓存。

## 二、抓包分析

抓包帧先落成 `.bin`，下面脚本按目录批量处理。**抓包含账号凭据与网关 Token，分析前先留副本，输出日志前先脱敏。**

| 脚本 | 用途 |
| --- | --- |
| `decode-latest-protocols.js` | 解码背包/物品/任务/赛季/活动操作等常用协议，未知字段原样保留 |
| `decode-shop-protocols.js` | 解码神秘商人、商城列表、购买响应与刷新通知；`roundtrip: true` 表示重编码字节与原文一致 |
| `audit-capture-compatibility.js` | 用本地 proto 校验抓包里的 RPC 是否都能解码，快速发现协议漂移 |
| `extract-har-frames.js` | 从 HAR 里提取 WebSocket 帧，省掉手动拆包 |
| `analyze-keepalive-capture.js` | 只输出非敏感的版本、心跳间隔与 Token 形态统计，可安全贴进 issue |
| `analyze-charity-red-flower-capture.js` | 慈善红花活动流程审计 |
| `analyze-weather-bottle-capture.js` | 天气活动瓶子玩法审计 |
| `audit-qingmei-flow.js` | 青梅酿酒与分享流程审计，按时间序输出关键请求/响应/错误码 |

```bash
pnpm -C core exec node ../tools/decode-latest-protocols.js <capture-dir>
pnpm -C core exec node ../tools/decode-shop-protocols.js <capture-dir>
pnpm -C core exec node ../tools/audit-capture-compatibility.js <capture-dir>
pnpm -C core exec node ../tools/extract-har-frames.js capture.har <输出目录>
```

## 三、运维操作

### admin-rescue.js — 登录救援

进不去面板时用（新浏览器要验证码但收不到、导入旧数据后设备对不上）。

```bash
node tools/admin-rescue.js                 # 看受信任设备数、会话数
node tools/admin-rescue.js --reset-trust   # 备份后清空设备与会话
systemctl restart qq-farm-bot              # 之后用密码登录会自动引导信任
```

会先备份 `admin.json` / `admin-sessions.json`（后缀 `.bak-<时间戳>`），不改密码。

### restore-data-backup.js — 备份还原

```bash
node tools/restore-data-backup.js --list        # 列出可用备份
node tools/restore-data-backup.js               # 恢复最近一份
node tools/restore-data-backup.js 2026-11-06    # 恢复指定日期
```

还原前自动把当前 `core/data` 存成 `core/data.pre-restore-<时间戳>/`；解密依赖 `core/data/.secret.key`，删了它旧备份就废了。

### sync-upstream.js — 上游逐提交甄别

本地与上游历史不相关，不能 `git merge`，这个脚本把「逐提交判断本地是否已有」的手工流程固化了：

1. `fetch upstream`，列出未甄别过的提交（已甄别记录在 `tools/.sync-upstream-reviewed.json`）
2. 每个提交双重甄别：`patch-id` 精确比对 + 特征行比对（取有信息量的新增行在本地对应文件里 grep，按命中率分类）
3. 输出三档报告：已存在 / 建议合入 / 待人工确认

```bash
node tools/sync-upstream.js                # 拉取并输出报告
node tools/sync-upstream.js --limit 30     # 只看最近 30 个提交
node tools/sync-upstream.js --show <sha>   # 看某提交完整 diff
node tools/sync-upstream.js --pick <sha>   # cherry-pick 并跑全量测试（冲突即停，不自动改代码）
node tools/sync-upstream.js --mark-done <sha>
```

> 手工搬上游代码时优先用它，比肉眼比对可靠：`--pick` 只执行 cherry-pick，冲突会停下而不是乱改。

### update-badges.js — README 徽章同步

消除徽章与代码的漂移，数据来源：`version` ← `core/package.json` 的 `version`；`protocol` ← `core/src/config/config.ts` 的 `DEFAULT_WX_CLIENT_VERSION`；`tests` ← 跑 core 全量测试并解析输出。

```bash
node tools/update-badges.js
```

## 通用约定

- 所有下载类脚本都**不直接改运行中的配置**，只写自己的输出目录
- 下载内容做 PNG 签名、IHDR、chunk CRC、IDAT、IEND 校验，非 PNG 不会伪装成 `.png`
- 脚本退出码：`0` 完成、非 `0` 表示部分失败或校验不通过，可据此接 CI
- 敏感数据（`core/data/`、抓包、Code、Token）永远不要提交进仓库
