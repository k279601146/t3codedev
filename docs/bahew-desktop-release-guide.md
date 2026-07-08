# Bahew 桌面客户端打包、发布与测试指南

> **唯一权威指导文档。** 本文件覆盖 Bahew 桌面应用的版本管理、构建打包、SaaS 后台发布、以及开发/验证全流程。
> 任何其他涉及客户端版本、打包、发布的文档以本文件为准。

---

## 目录

1. [版本架构](#1-版本架构)
2. [Dev 模式版本测试](#2-dev-模式版本测试)
3. [构建桌面安装包](#3-构建桌面安装包)
4. [SaaS 后台发布](#4-saas-后台发布)
5. [端到端验证](#5-端到端验证)
6. [环境变量速查](#6-环境变量速查)
7. [常见问题](#7-常见问题)

---

## 1. 版本架构

### 1.1 版本号唯一权威来源

**Bahew 桌面应用版本**（如 `0.0.24`）是唯一的版本口径。Electron 版本（`41.5.0`）只是运行时 metadata，不参与展示、不参与更新比较、不进入更新请求头。

以下所有位置使用同一个 Bahew app version：

| 位置 | 取值来源 |
|---|---|
| 关于页显示版本 | `APP_VERSION` 环境变量 / `apps/web/package.json` version |
| `DesktopEnvironment.appVersion` | `ElectronApp.ts` 中 `resolveAppVersion()` |
| `DesktopUpdateState.currentVersion` | 同上 |
| 更新请求头 `x-t3code-version` | 同上 |
| 构建产物文件名 | `--build-version` 参数 |
| Release helper JSON | `--build-version` 参数 |

### 1.2 版本解析器 (`ElectronApp.ts`)

`resolveAppVersion(rawVersion)` 按以下顺序返回 Bahew 版本：

1. `process.env.T3CODE_DESKTOP_VERSION` —— 构建脚本注入
2. `process.env.APP_VERSION` —— Web 构建注入
3. `apps/desktop/package.json` 的 `version` 字段

并**明确拒绝**等于 `process.versions.electron` 或 `desktopPackageJson.dependencies.electron` 的原始值。

### 1.3 版本一致性检查

构建脚本在确定 `appVersion` 后，会比较 `apps/web/package.json`、`apps/desktop/package.json`、`apps/server/package.json` 三者的 `version` 是否与 `appVersion` 一致。不一致时输出 warning 日志，不阻止构建——构建版本始终以 `--build-version` 为准。

---

## 2. Dev 模式版本测试

### 2.1 版本唯一配置源：.env 文件

**推荐做法**：在项目根 .env 文件中修改 T3CODE_DESKTOP_VERSION，这是 dev 和 build 共享的单一版本来源。

`ash
# D:\workspace\t3codedev\.env
T3CODE_DESKTOP_VERSION=0.0.24
`

修改后保存即可，**无需**每次在命令行设环境变量。

### 2.2 Dev 模式启动链路

`powershell
cd D:\workspace\t3codedev
bun run dev:desktop
`

`
bun run dev:desktop
  -> scripts/dev-runner.ts dev:desktop
    -> bun run dev --filter=@t3tools/desktop --filter=@t3tools/web --parallel
      -> apps/desktop/scripts/dev-electron.mjs
        -> loadRootDotenv() loads ../../.env into process.env
        -> spawn Electron with childEnv = { ...process.env }
          -> ElectronApp.ts: resolveAppVersion()
            -> T3CODE_DESKTOP_VERSION (from .env) -> APP_VERSION -> desktop package.json
`

### 2.3 版本优先级

| 优先级 | 来源 | 适用场景 |
|---|---|---|
| 1 | T3CODE_DESKTOP_VERSION（.env 中设置） | dev / build 通用 |
| 2 | APP_VERSION 环境变量 | Web 构建注入 |
| 3 | pps/desktop/package.json version 字段 | 兜底 |

### 2.4 模拟特定客户端版本

**场景 A：用 .env 切换版本**

`powershell
# 编辑 .env -> T3CODE_DESKTOP_VERSION=0.0.24
bun run dev:desktop
`

**场景 B：临时覆盖（不修改 .env）**

`powershell
="0.0.25"
bun run dev:desktop
`

命令行覆盖优先（loadRootDotenv 只在 process.env[key] === undefined 时设置）。

### 2.5 启动诊断日志

Dev 模式启动后在日志中查找 desktop.startup.begin 事件。

### 2.6 更新检查在 Dev 模式

Dev 模式下自动更新**默认跳过**。手动检查更新的按钮仍可用。

连本地 SaaS 后台测试，在 .env 中追加：

`ash
T3CODE_DESKTOP_UPDATE_FEED_URL=http://localhost:8000/api/v1/client-updates/app
`
## 3. 构建桌面安装包

### 3.1 前置条件

- Node.js v24+
- bun v1.3.11+
- Windows 环境需确保 Python 3.10+ 可用
- `apps/desktop/bin/` 下有对应平台的引擎二进制文件（如 Windows 的 `ai-engine.exe`、`rg.exe`）

### 3.2 构建命令

`powershell
# 推荐：.env 中已设 T3CODE_DESKTOP_VERSION=0.0.24，无需传 --build-version
node scripts/build-desktop-artifact.ts --platform win
node scripts/build-desktop-artifact.ts --platform mac
node scripts/build-desktop-artifact.ts --platform linux

# 或直接用 npm script（同样读取 .env）
bun run dist:desktop:win:x64
bun run dist:desktop:dmg:arm64
bun run dist:desktop:linux

# 临时覆盖版本（优先级高于 .env）
node scripts/build-desktop-artifact.ts --platform win --build-version 0.0.25

# 查看所有选项
node scripts/build-desktop-artifact.ts --help
`

版本来源优先级：--build-version CLI 参数 > .env 中 T3CODE_DESKTOP_VERSION > pps/server/package.json version。

构建脚本会自动：
1. 加载根 .env 文件
2. 运行 un run build:desktop（除非传 --skip-build）
3. 注入 APP_VERSION 和 T3CODE_DESKTOP_VERSION 到构建环境
4. 产物放到 
elease/ 目录（Mock 模式放到 
elease-mock/）
5. 生成 ahew-client-release-{version}.json release helper JSON
4. 生成 `bahew-client-release-{version}.json` 的 release helper JSON

### 3.3 产物输出

构建完成后在输出目录得到：
- 安装包：`Bahew-0.0.24-x64.exe`（Windows）、`Bahew-0.0.24-arm64.dmg`（macOS）、`Bahew-0.0.24-x64.AppImage`（Linux）
- Release helper JSON：`bahew-client-release-0.0.24.json`

Release helper JSON 格式：

```json
{
  "assets": [
    {
      "version": "0.0.24",
      "kind": "app",
      "channel": "latest",
      "platform": "win32",
      "arch": "x64",
      "file": "D:\\workspace\\t3codedev\\release\\Bahew-0.0.24-x64.exe",
      "filename": "Bahew-0.0.24-x64.exe",
      "size_bytes": 123456789,
      "sha512": "<64-char hex>",
      "sha256": "<64-char hex>"
    }
  ]
}
```

### 3.4 构建脚本输出释义

| 日志行 | 含义 |
|---|---|
| `[desktop-artifact] Building desktop/server/web artifacts...` | 正在编译 |
| `[desktop-artifact] Staging release app...` | 拷贝编译产物到临时目录 |
| `[desktop-artifact] Installing staged production dependencies...` | 安装生产依赖 |
| `[desktop-artifact] Building win/nsis ...` | 调用 electron-builder |
| `[desktop-artifact] Wrote release helper JSON: ...` | 已生成辅助 JSON |
| `[desktop-artifact] Done. Artifacts:` | 构建完成 |

若出现 `[desktop-artifact] Package versions differ from build version 0.0.24` warning：表示 `apps/web`/`apps/desktop`/`apps/server` 的 `package.json` version 未全部同步为 `0.0.24`。构建产物版本仍以 `--build-version` 为准，但建议后续统一。

---

## 4. SaaS 后台发布

### 4.1 发布流程总览

```
构建安装包 → 上传资产 / 登记 URL → 校验完整性 → 一键自检 → 发布
```

管理入口：`http://localhost:3001/zh/admin/client-releases?kind=app`

### 4.2 步骤 1：创建 Release

1. 在左侧表单选择 **App** 类型
2. 填写版本号（如 `0.0.24`）
3. 选择渠道（`latest` 或 `nightly`）
4. 设置灰度百分比（0-100）
5. 如需最小支持版本，在 `min_supported_version` 填写
6. 点击 **创建版本**

创建成功后版本列表中会显示新版本，状态为 **草稿** 或 **资产不完整**。

### 4.3 步骤 2：添加资产

资产表单支持两种模式（用 segmented control 切换）：

#### 模式 A：上传安装包

1. 选择版本下拉框中刚创建的 release
2. 选择 Platform（如 `win32`）和 Arch（如 `x64`）
3. 点 **上传安装包** → 选择本地 `.exe` / `.dmg` / `.AppImage`
4. 服务端自动计算 `size_bytes`、`sha512`、`sha256` 并生成托管下载 URL
5. 点击 **保存资产**

注意：上传文件会受 `CLIENT_RELEASE_MAX_UPLOAD_BYTES` 限制（默认 2 GB），且只允许 `.exe`、`.zip`、`.dmg`、`.appimage`、`.blockmap`。

#### 模式 B：登记外部 URL

1. 选择版本、Platform、Arch
2. 点 **登记外部 URL**
3. 输入 CDN / 对象存储的 HTTPS 下载 URL
4. 点 **检查 URL** → 服务端 HEAD/GET 读取可获得的 size 和 hash 并自动回填
5. 补全缺失字段后点 **保存资产**

URL 必须是公网 HTTPS 地址，拒绝 localhost、内网 IP、非 HTTPS 地址，且不自动跟随重定向。

### 4.4 步骤 3：一键自检

在版本列表中找到目标 release，点行内 **一键自检** 按钮。自检会用模拟客户端身份发起请求，检查：

| 检查项 | 通过条件 |
|---|---|
| 版本号 | version 非空且格式正确 |
| 渠道 | channel 为 `latest` 或 `nightly` |
| 平台/架构 | platform + arch 在已知组合中 |
| 返回更新 | 当前版本小于目标版本时 `update_available=true` |
| 资产存在 | 选定 platform/arch 有匹配资产 |
| 资产完整 | 资产的必填字段均不为空 |
| 无异常警告 | 无疑似坏资产的 warning |

自检结果会显示在发布按钮旁：**通过** 或 **需修复**，并列出缺失字段与疑似异常原因。

### 4.5 疑似异常资产

以下情况资产会被标记为"疑似异常"：

| Warning Key | 含义 |
|---|---|
| `download_url_not_installer` | URL 没有安装包扩展名（`.exe`/`.dmg`/`.zip`/`.appimage`） |
| `size_too_small` | 文件大小小于 1 MB（对 app 而言明显过小） |
| `sha512_suspicious` | sha512 长度不足 64 位 hex |
| `filename_not_bahew` | 文件名不含 `bahew` 且不是托管资产 |
| `download_url_not_engine_binary` | engine 资产 URL 不是 `.zip` 或 `.exe` |
| `sha256_suspicious` | engine 资产的 sha256 长度不足 64 位 hex |

疑似异常不阻止保存，但发布前自检不会通过。

### 4.6 步骤 4：发布

自检通过后，发布按钮可用。点击 **发布** 按钮后：
- 同一 kind/channel 下已有的已发布版本会被**自动停用**
- 只有最新发布的版本处于 `enabled` 状态
- 客户端 `/resolve` 接口仅返回 `enabled=true` 的 release

已发布版本可点击 **停用** 撤销发布（恢复到可发布状态）。

### 4.7 发布状态一览

| 状态 | 含义 | Pill 颜色 |
|---|---|---|
| 已发布 | 当前启用中，客户端可获取 | 绿色 |
| 可发布 | 资产完整、无异常、待发布 | 蓝色 |
| 疑似异常 | 资产有 warning，需人工确认 | 黄色 |
| 草稿 | 没有任何资产 | 灰色 |
| 资产不完整 | 有资产但缺少必填字段 | 红色 |

### 4.8 托管资产目录

上传的安装包存储在 `CLIENT_RELEASE_ASSETS_DIR`（默认 `./temp/client-release-assets`）。版本列表顶部显示当前托管目录总占用大小。

---

## 5. 端到端验证

### 5.1 完整验证流程

**前提**：`.env` 中已设 `T3CODE_DESKTOP_VERSION=0.0.24`。

```powershell
# === 桌面 repo ===
cd D:\workspace\t3codedev

# 1. 构建安装包（版本自动从 .env 读取）
bun run dist:desktop:win:x64

# 2. 读 helper JSON
Get-Content release\bahew-client-release-0.0.24.json

# === SaaS repo ===
cd D:\workspace\dev2_OpenHarness_SaaS

# 3. 确认后端运行中

# === 浏览器 ===
# 4. 打开 http://localhost:3001/zh/admin/client-releases?kind=app
# 5. 创建 release "0.0.24" (channel=latest)
# 6. 上传安装包
# 7. 一键自检 -> "可发布"
# 8. 发布

# === 桌面 repo ===
# 9. .env 中临时改版本为 0.0.23 + 追加 update feed URL
#    T3CODE_DESKTOP_VERSION=0.0.23
#    T3CODE_DESKTOP_UPDATE_FEED_URL=http://localhost:8000/api/v1/client-updates/app
cd D:\workspace\t3codedev
bun run dev:desktop

# 10. Settings -> 检查更新 -> 应提示有新版本
```

### 5.2 用 curl 直接验证

```powershell
curl "http://localhost:8000/api/v1/client-updates/app/latest/resolve?version=0.0.23&platform=win32&arch=x64&installation_id=test"
```

期望返回 `update_available=true` 及真实资产 URL、sha512。

### 5.3 验证请求头版本

在 dev 桌面启动日志中确认 `desktop.startup.begin` 的 `appVersion` 字段是 Bahew 版本（如 `0.0.23`），不是 `41.5.0`。

---

## 6. 环境变量速查

### 6.1 桌面端

| 环境变量 | 用途 | 默认值 |
|---|---|---|
| `T3CODE_DESKTOP_VERSION` | 桌面应用版本（构建注入，最高优先级） | 无 |
| `APP_VERSION` | Web 构建注入版本 | 无 |
| `T3CODE_DESKTOP_UPDATE_FEED_URL` | 更新 feed 地址 | `https://www.bahew.com/api/v1/client-updates/app` |
| `T3CODE_DESKTOP_MOCK_UPDATES` | 启用 Mock 更新服务 | `false` |
| `T3CODE_DISABLE_AUTO_UPDATE` | 禁用自动更新 | `false` |

### 6.2 SaaS 后端

| 环境变量 | 用途 | 默认值 |
|---|---|---|
| `CLIENT_RELEASE_ASSETS_DIR` | 上传安装包存储目录 | `./temp/client-release-assets` |
| `CLIENT_RELEASE_PUBLIC_BASE_URL` | 生成下载 URL 的基础地址 | 按请求来源推导 |
| `CLIENT_RELEASE_MAX_UPLOAD_BYTES` | 上传文件大小上限 | `2147483648`（2 GB） |

---

## 7. 常见问题

### Q: Dev 模式下关于页显示 `41.5.0` 而不是 `0.0.23`

A: 这是已修复的问题。`resolveAppVersion()` 会拒绝 Electron 版本。如果仍出现，检查 `apps/web` 的构建是否有 `APP_VERSION` 异常注入。

### Q: 后台发布了 `0.0.24`，但客户端检查更新提示"已是最新版本"

A: 按以下步骤排查：
1. 确认后台该 release 状态为 **已发布**（enabled=true）
2. 确认客户端版本确实是 `< 0.0.24`（关于页确认）
3. 用 curl 调 `/resolve?version=0.0.23` 确认服务端返回 `update_available=true`
4. 检查 asset URL 是否可公开访问、sha512 是否完整
5. 确认没有另一个同 channel 的更高版本覆盖

### Q: 构建脚本报 `bun` 命令找不到

A: Windows 环境需确保 bun 在 PATH 中。构建脚本内部在 Windows 上会启用 shell 模式解析 `.cmd` shim。

### Q: 上传安装包时报 "不支持的文件类型"

A: 检查文件扩展名是否在允许列表中：`.exe`、`.zip`、`.dmg`、`.appimage`、`.blockmap`。

### Q: 版本列表里看到 "疑似异常" 但资产看起来没问题

A: 可能是 URL 路径不含安装包扩展名，或文件过小。托管上传的资产不会出 `filename_not_bahew`，手动登记 URL 时如果域名/路径不含 `bahew` 会被标记。不影响功能，但自检不会通过，需要发布前人工确认。

### Q: 自检显示 "缺少字段：asset" 怎么办

A: 表示发布列表里没有与自检所选 platform/arch 匹配的资产。为 release 添加对应平台的资产即可。

### Q: 多个平台需要分别上传资产吗

A: 是的。不同 platform + arch 组合需要分别添加资产。发布时只要有一条完整资产（如 win32-x64），该平台的客户端就能获取更新。

### Q: 发布后可以回滚吗

A: 可以。在版本列表中找到之前发布的版本，点击 **重新发布** 按钮即可重新启用。当前发布的版本会自动停用。

---

## 相关文件索引

| 文件 | 说明 |
|---|---|
| `apps/desktop/src/electron/ElectronApp.ts` | `resolveAppVersion()` 版本解析器 |
| `apps/desktop/src/app/DesktopApp.ts` | 启动诊断日志、update feed 配置 |
| `apps/desktop/src/updates/DesktopUpdates.ts` | 更新状态机、dev2 更新查询 |
| `apps/desktop/src/app/DesktopConfig.ts` | 桌面端环境变量配置 |
| `scripts/build-desktop-artifact.ts` | 构建脚本、版本一致性检查 |
| `apps/web/src/app/[locale]/admin/AdminSectionClient.tsx` | SaaS 后台客户端版本管理 UI |
| `apps/api/client_updates.py` | 客户端更新 API（上传、发布、自检） |