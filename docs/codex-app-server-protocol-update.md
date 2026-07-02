# Codex app-server 协议更新流程

本文用于记录 T3 Code 更新 Codex app-server 协议和 `ai-engine.exe` 的固定流程。核心原则只有一个：**协议生成产物和 `ai-engine.exe` 必须来自同一个 GitHub commit**。不要只更新 TypeScript 协议，也不要只替换引擎二进制。

为了降低兼容性和安全风险，本项目默认只跟随 Codex app-server 的 stable API surface。不要在常规更新流程中使用 `--experimental`，也不要把 experimental 方法或字段纳入客户端协议。

## 1. 先选定 GitHub 上游 commit

推荐使用明确的 commit SHA，不要长期依赖浮动的 `main`：

```powershell
cd D:\workspace\codexdev
git remote add upstream https://github.com/openai/codex.git
git fetch upstream main
git rev-parse upstream/main
```

记下输出的 SHA，下面用 `<UPSTREAM_SHA>` 表示。

## 2. 用同一个 commit 构建 ai-engine

```powershell
cd D:\workspace\codexdev
git checkout <UPSTREAM_SHA>

cd D:\workspace\codexdev\codex-rs
cargo build -p codex-app-server --release
```

构建完成后，把产物按桌面端发布约定复制并改名为 `ai-engine.exe`。实际目标目录以当前打包脚本和 manifest 为准，常见来源是：

```text
D:\workspace\codexdev\codex-rs\target\release\codex-app-server.exe
```

注意：如果只更新协议、不更新 `ai-engine.exe`，运行时可能出现 `method not found`、字段被拒绝或 schema 解码失败。

## 3. 从 GitHub stable schema 重新生成项目协议

T3 Code 的生成脚本在：

```text
packages/effect-codex-app-server/scripts/generate.ts
```

默认从 GitHub 拉取 checked-in stable schema：

```text
codex-rs/app-server-protocol/schema/json
codex-rs/app-server-protocol/schema/typescript
```

执行前设置上游来源：

```powershell
$env:CODEX_APP_SERVER_UPSTREAM_OWNER = "openai"
$env:CODEX_APP_SERVER_UPSTREAM_REPO = "codex"
$env:CODEX_APP_SERVER_UPSTREAM_REF = "<UPSTREAM_SHA>"

cd D:\workspace\t3codedev
bun run --filter effect-codex-app-server generate
```

生成结果会更新：

```text
packages/effect-codex-app-server/src/_generated/schema.gen.ts
packages/effect-codex-app-server/src/_generated/meta.gen.ts
packages/effect-codex-app-server/src/_generated/namespaces.gen.ts
```

生成文件头部会记录 upstream source 和 upstream ref。后续排查协议漂移时，先确认这些 ref 和 `ai-engine.exe` 的源码 commit 是否一致。

## 4. 不使用 experimental 协议

上游 `codex app-server generate-ts` 和 `generate-json-schema` 默认生成 stable API；加 `--experimental` 才会包含实验性方法和字段。本项目常规开发不要使用：

```powershell
codex app-server generate-ts --out DIR --experimental
codex app-server generate-json-schema --out DIR --experimental
```

也不要为协议生成脚本新增 `CODEX_APP_SERVER_EXPERIMENTAL` 这类开关。原因是 experimental API 没有稳定兼容性保证，客户端升级后更容易遇到方法变更、字段变更和运行时能力门禁。

如果上游文档出现某个实验性能力确实需要接入，必须先单独评审：

- 确认该能力是否已经转为 stable。
- 确认商业化客户端是否真的需要暴露该能力。
- 确认 `ai-engine.exe`、协议生成产物、server 适配层和 Web UI 都能同源更新。
- 确认失败降级和隐藏 UI 入口的方案。

## 5. 轻量检查

本仓库约束是测试时不做依赖下载、环境下载和额外编译。协议更新后至少做这些轻量检查：

```powershell
Select-String -Path packages\effect-codex-app-server\src\_generated\meta.gen.ts -Pattern "Upstream protocol"
```

然后检查项目里是否调用了已被新协议删除的方法：

```powershell
rg '"[a-zA-Z][^"]+/[^"]+"' apps packages -g '!**/dist/**'
```

发布前可由人工决定是否额外运行 typecheck 或更完整测试。

## 6. 常见问题

### 协议更新后 ai-engine 报 method not found

通常是 `ai-engine.exe` 和协议不是同一个 commit。重新确认：

```powershell
git -C D:\workspace\codexdev rev-parse HEAD
Select-String -Path D:\workspace\t3codedev\packages\effect-codex-app-server\src\_generated\meta.gen.ts -Pattern "Upstream protocol ref"
```

两边必须一致。

### 新协议删除了项目正在调用的方法

先不要回滚生成产物。应该查调用方是否可以降级、隐藏 UI 入口或基于能力检测分支处理。协议更新的目标是暴露真实引擎能力，而不是让类型继续假装旧能力存在。

### 想临时使用实验性方法

不要直接修改 `_generated` 文件，也不要在常规协议生成流程中打开 experimental。先把需求、风险和可替代 stable 能力列出来，再决定是否做独立技术方案。
