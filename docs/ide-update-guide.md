# IDE 更新发布指南

本文档说明 T3 Code 桌面端两类更新的发布方式：

- `ai-engine.exe` 引擎二进制更新，即 `kind=engine`
- 整个桌面应用安装包更新，即 Electron App 更新

## 一、`MYIDE_ENGINE_MANIFEST_URL` 配置在哪里

`MYIDE_ENGINE_MANIFEST_URL` 是桌面端主进程读取的运行时环境变量，读取位置在 `apps/desktop/src/app/DesktopConfig.ts`。

它不是前端页面配置，也不是 sub2api 后台配置。它必须在启动桌面端进程前注入到桌面端进程环境里。

### 开发环境配置

在 PowerShell 中启动桌面端前设置：

```powershell
$env:MYIDE_ENGINE_MANIFEST_URL="http://localhost:3000/ide/api/version/engine?current=bundled&platform=win32&arch=x64"
$env:MYIDE_ENGINE_SIGNATURE_PUBLIC_KEY=""
bun run dev
```

如果你的开发命令不是 `bun run dev`，保持第一行不变，然后执行项目实际的桌面端启动命令即可。

在 `cmd.exe` 中启动桌面端前设置：

```cmd
set MYIDE_ENGINE_MANIFEST_URL=http://localhost:3000/ide/api/version/engine?current=bundled^&platform=win32^&arch=x64
set MYIDE_ENGINE_SIGNATURE_PUBLIC_KEY=
bun run dev
```

注意：`cmd.exe` 里 URL 的 `&` 要写成 `^&`，否则会被当成命令分隔符。

### 打包后的 Windows 客户端配置

当前实现也是读取桌面端进程环境变量，所以生产环境有三种常见做法：

1. 安装器写入用户级或机器级环境变量，然后提示用户重启应用。
2. 使用启动器脚本或企业分发工具，在启动应用前注入环境变量。
3. 后续改造为品牌/构建配置内置更新地址，避免依赖用户系统环境变量。

用户级环境变量示例：

```cmd
setx MYIDE_ENGINE_MANIFEST_URL "https://api.example.com/ide/api/version/engine?current=bundled&platform=win32&arch=x64"
```

`setx` 写入后只对新进程生效，必须完全退出并重新打开 T3 Code。

生产环境建议使用 HTTPS 地址，不要使用 `localhost`。`localhost` 只适合本机开发调试。

## 二、更新 `ai-engine.exe`

### 更新范围

`kind=engine` 只更新 AI 引擎二进制，例如 Windows 下的 `ai-engine.exe`。

它不会更新：

- React 前端页面
- Electron 主进程
- `apps/server`
- 应用图标、菜单、安装包资源
- 已安装的桌面应用版本号

### 用户侧体验

当前 `ai-engine.exe` 更新是后台静默更新。

桌面端启动后会在后台检查 `MYIDE_ENGINE_MANIFEST_URL`：

- 启动约 5 分钟后检查一次
- 之后约每天检查一次
- 下载成功后写入本机 engine versions 目录
- 下次后端启动或重启时使用新的 engine
- 如果协议不兼容或完整性校验失败，会拒绝使用新版本，并尝试回退到上一个可用版本

当前没有单独的“ai-engine 更新弹窗”或“下载/安装按钮”。设置页里的 `Check for Updates` 主要是整个桌面应用安装包的更新入口，不是 `ai-engine.exe` 的专属更新入口。

### 后端发布 release

后端接口：

```text
POST http://localhost:3000/api/v1/admin/ide/releases
```

查询接口：

```text
GET http://localhost:3000/ide/api/version/engine?current=bundled&platform=win32&arch=x64
```

健康检查：

```text
GET http://localhost:3000/health
```

### Windows `cmd.exe` 发布示例

`cmd.exe` 里不要使用单引号包 JSON，否则后端会收到非法 JSON 并返回：

```json
{"code":400,"message":"invalid release payload"}
```

正确写法：

```cmd
curl -X POST "http://localhost:3000/api/v1/admin/ide/releases" ^
  -H "Authorization: Bearer <JWT>" ^
  -H "Content-Type: application/json" ^
  --data-raw "{\"kind\":\"engine\",\"version\":\"0.1.0\",\"min_app_version\":\"\",\"release_notes\":\"ai-engine 0.1.0\",\"is_mandatory\":false,\"protocolVersion\":\"app-server-v1\",\"engineName\":\"ai-engine\",\"upstream\":\"openai/codex\",\"upstreamVersion\":\"0.0.0\",\"build\":\"20260526\",\"binaries\":{\"win32-x64\":{\"url\":\"https://cdn.example.com/ai-engine.exe\",\"sha256\":\"6EDDDEEF2CE6C89A6698EAF48125AC24CD88DBC41350754DEF9999B165A626A0\",\"signature\":\"\",\"size\":12345678}}}"
```

### PowerShell 发布示例

PowerShell 推荐先构造对象，再转 JSON：

```powershell
$body = @{
  kind = "engine"
  version = "0.1.0"
  min_app_version = ""
  release_notes = "ai-engine 0.1.0"
  is_mandatory = $false
  protocolVersion = "app-server-v1"
  engineName = "ai-engine"
  upstream = "openai/codex"
  upstreamVersion = "0.0.0"
  build = "20260526"
  binaries = @{
    "win32-x64" = @{
      url = "https://cdn.example.com/ai-engine.exe"
      sha256 = "6EDDDEEF2CE6C89A6698EAF48125AC24CD88DBC41350754DEF9999B165A626A0"
      signature = ""
      size = 12345678
    }
  }
} | ConvertTo-Json -Depth 5

curl.exe -X POST "http://localhost:3000/api/v1/admin/ide/releases" `
  -H "Authorization: Bearer <JWT>" `
  -H "Content-Type: application/json" `
  --data-raw $body
```

### 计算 SHA256

```powershell
Get-FileHash D:\workspace\t3codedev\apps\desktop\bin\ai-engine.exe -Algorithm SHA256
```

发布时 `sha256` 可以使用大写或小写十六进制；建议统一使用小写，便于排查。

### 签名字段

`signature` 当前是可选字段。

如果设置了 `MYIDE_ENGINE_SIGNATURE_PUBLIC_KEY`，客户端会要求下载包必须带签名，并使用 Ed25519 校验签名。没有配置公钥时，只校验 SHA256。

生产环境建议启用签名：

```powershell
$env:MYIDE_ENGINE_SIGNATURE_PUBLIC_KEY="<base64-spki-public-key>"
```

### 发布后验证

```cmd
curl "http://localhost:3000/ide/api/version/engine?current=bundled&platform=win32&arch=x64" -H "Authorization: Bearer <JWT>"
```

期望看到：

```json
{
  "code": 0,
  "data": {
    "kind": "engine",
    "latest_version": "0.1.0",
    "download": {
      "url": "https://cdn.example.com/ai-engine.exe",
      "sha256": "..."
    },
    "protocolVersion": "app-server-v1"
  }
}
```

## 三、更新整个桌面应用安装包

### 更新范围

整个桌面应用安装包更新，也就是 Electron App 更新，会更新：

- Electron 主进程
- React/Vite 前端页面
- `apps/server` 打包产物
- 应用资源文件
- 随安装包捆绑的默认 `ai-engine.exe`
- 应用版本号

### 用户侧体验

这是用户能在设置页看到的更新入口：

- `Check for Updates`
- `Download`
- `Install`

菜单里的 `Check for Updates...` 也是走同一套 Electron 自动更新。

### 当前实际更新源

当前桌面应用更新走 `electron-updater`，依赖打包资源里的：

```text
app-update.yml
```

开发环境会读取：

```text
dev-app-update.yml
```

生产环境会读取：

```text
resources/app-update.yml
```

如果没有配置更新源，按钮点击后会提示类似：

```text
Automatic updates are not available because no update feed is configured.
```

### `kind=app` 的作用边界

sub2api 的 `kind=app` 当前表示后端保存了一份 App release 元数据，可通过下面接口查询：

```text
GET http://localhost:3000/ide/api/version/app
```

但当前桌面端的 Electron 自动更新并不会直接消费这个接口。也就是说，发布：

```json
{"kind":"app"}
```

不会自动让设置页的 `Check for Updates` 检查到新安装包。

要让整个桌面应用自动更新生效，仍然需要配置 Electron 更新源，例如 GitHub Releases 或 generic HTTPS feed，并让 `app-update.yml` 指向正确地址。

## 四、推荐发布策略

### 只修复引擎能力

适合场景：

- 更新 `codex-app-server` 二进制
- 修复 ai-engine 协议兼容 bug
- 提升模型调用或沙箱能力
- 不需要改 UI 或 `apps/server`

发布方式：

1. 编译新的 `ai-engine.exe`
2. 上传到 HTTPS CDN
3. 计算 SHA256
4. 可选生成 Ed25519 签名
5. POST `kind=engine` 到 sub2api
6. 确认客户端配置了 `MYIDE_ENGINE_MANIFEST_URL`
7. 等待客户端后台静默更新

### 更新完整客户端

适合场景：

- 改了前端 UI
- 改了 Electron 主进程
- 改了 `apps/server`
- 改了默认捆绑资源
- 需要用户看到新版本号

发布方式：

1. 构建新的桌面安装包
2. 发布安装包和 Electron updater manifest，例如 `latest.yml`
3. 确认 `app-update.yml` 指向正确更新源
4. 用户在设置页点击 `Check for Updates`
5. 用户下载并安装，应用重启后生效

### 同时更新客户端和引擎

适合场景：

- 新 UI 依赖新 engine 协议
- `apps/server` 与 engine 协议一起升级

推荐做法：

1. 先发布完整客户端，让新客户端具备兼容逻辑。
2. 再发布 `kind=engine`。
3. `protocolVersion` 必须匹配客户端支持的版本，例如当前是 `app-server-v1`。
4. 如果协议不兼容，客户端会拒绝更新 engine。

## 五、常见问题

### `invalid release payload`

通常是 JSON 没有正确传到后端。

Windows `cmd.exe` 不支持用单引号包 JSON：

```cmd
-d '{"kind":"engine"}'
```

请改用转义双引号，或用 PowerShell 的 `ConvertTo-Json`。

### `/ide/api/version/engine` 返回空

说明后端没有成功发布 engine release，或者当前服务没有连接保存 release 的数据库。

排查顺序：

1. 确认 POST 地址是 `/api/v1/admin/ide/releases`。
2. 确认 POST 返回 `code:0`。
3. 调用 `GET /api/v1/admin/ide/releases` 查看是否有 `kind=engine`。
4. 调用 `GET /ide/api/version/engine?current=bundled&platform=win32&arch=x64` 查看客户端视角。

### `Check for Updates` 点了没有发现 ai-engine 更新

这是正常的。设置页按钮是完整桌面应用更新入口，不是 `ai-engine.exe` 静默更新入口。

`ai-engine.exe` 更新看 `MYIDE_ENGINE_MANIFEST_URL`，并在后台定时检查。

### 生产环境能不能把 `MYIDE_ENGINE_MANIFEST_URL` 指向 localhost

不能。生产客户端上的 `localhost` 指的是用户自己的电脑，不是你的后端服务器。

生产环境应该使用公网 HTTPS 地址，例如：

```text
https://api.example.com/ide/api/version/engine?current=bundled&platform=win32&arch=x64
```

更理想的后续改造是客户端自动带上当前 engine version、platform、arch，而不是在环境变量里写死查询参数。
