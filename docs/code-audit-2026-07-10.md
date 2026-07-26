# T3 Code 严格代码审计报告

审计日期：2026-07-10  
范围：`apps/server`、`apps/web`、`apps/desktop`、`packages/*` 中与认证、provider、更新、插件/技能、文件系统、源码管理、日志相关的主链路。  
方式：静态审查和定向代码阅读。未启动服务，未运行测试，未修改业务代码。

## 总体结论

当前项目不是“整体设计完全不可用”，但安全边界不一致：桌面更新、provider 子进程、provider 事件日志、第三方技能安装、远程环境 token 持久化分别在不同模块各自实现安全策略，没有形成强制、统一、可审计的安全基线。商业化 IDE 客户端如果继续按当前状态分发，供应链与敏感数据泄露风险偏高。

最严重的问题是自动更新链路：默认没有内置签名公钥，签名校验只在环境变量配置了公钥时才启用。对随客户端分发的 `ai-engine.exe` 来说，这相当于把远程更新源/CDN/网关变成高权限代码发布者，sha256 只证明“下载内容和 manifest 一致”，不能证明内容可信。

## P0

### P0-1：引擎自动更新默认不强制签名校验，存在供应链 RCE 风险

证据：
- `apps/desktop/src/app/DesktopConfig.ts:66` 到 `apps/desktop/src/app/DesktopConfig.ts:70` 默认配置了远程 `engineManifestUrl`，但 `engineSignaturePublicKey` 只从 `MYIDE_ENGINE_SIGNATURE_PUBLIC_KEY` 读取，没有内置信任根。
- `apps/desktop/src/engine/DesktopEngineUpdater.ts:350` 到 `apps/desktop/src/engine/DesktopEngineUpdater.ts:359` 只校验下载内容的 sha256。
- `apps/desktop/src/engine/DesktopEngineUpdater.ts:360` 到 `apps/desktop/src/engine/DesktopEngineUpdater.ts:380` 只有在 `signaturePublicKey !== undefined` 时才要求并校验签名。
- `apps/desktop/src/engine/DesktopEngineUpdater.ts:382` 到 `apps/desktop/src/engine/DesktopEngineUpdater.ts:402` 随后将二进制落盘、chmod、切换当前版本。

影响：
- 如果 manifest 服务、CDN、DNS、上游网关或发布账号被攻破，攻击者可以同时替换二进制和 sha256，客户端会接受并运行恶意 `ai-engine.exe`。
- 这是桌面端本地代码执行，不是普通远程接口漏洞。影响级别应按供应链远程代码执行处理。

修复方向：
- 客户端内置生产 Ed25519 公钥或证书 pinning，发布版必须强制签名校验；缺签名、签名无效、公钥缺失都必须拒绝更新。
- manifest 也应签名，不能只签 binary；binary hash、版本、平台、协议版本都应进入签名覆盖范围。
- 开发环境可以显式允许无签名，但必须由构建类型或受控 dev flag 控制，不能和生产路径混用。

## P1

### P1-1：更新 manifest 的 `version` 直接参与路径拼接，存在路径穿越和任意落盘面

证据：
- `apps/desktop/src/engine/DesktopEngineUpdater.ts:36` 到 `apps/desktop/src/engine/DesktopEngineUpdater.ts:45` 中 `version` 只是 `Schema.String`。
- `apps/desktop/src/engine/DesktopEngineUpdater.ts:382` 到 `apps/desktop/src/engine/DesktopEngineUpdater.ts:387` 将 `manifest.version` 直接拼进 `versionDir`、`tmpPath`、`finalPath`。
- `apps/desktop/src/engine/DesktopEngineUpdater.ts:402` 将未校验的版本字符串写入 `current_version`。
- `apps/desktop/src/engine/DesktopEngineUpdater.ts:299` 到 `apps/desktop/src/engine/DesktopEngineUpdater.ts:302` 后续读取该版本后继续拼接成 active engine path。

影响：
- 被污染的 manifest 可以使用 `../`、绝对路径、Windows 特殊路径片段等影响写入位置或当前版本解析。
- 结合 P0 的签名缺失，这条链路可以扩大为更稳定的落盘/覆盖攻击面。

修复方向：
- 对 `version` 做严格白名单，例如 semver 或固定 slug：`^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$`，并拒绝 `.`、`..`、路径分隔符、盘符、UNC。
- 所有 `join` 后路径必须 `resolve`，并校验仍位于 `engineVersionsPath` 内。
- `current_version` 读取后也必须复用同一校验函数，不能只校验下载时的 manifest。

### P1-2：Provider 事件日志会持久化完整 native/canonical 事件，泄露 prompt、代码和工具参数

证据：
- `apps/server/src/provider/Layers/EventNdjsonLogger.ts:87` 到 `apps/server/src/provider/Layers/EventNdjsonLogger.ts:110` 对事件直接 `JSON.stringify(event)`，没有字段级脱敏。
- `apps/server/src/provider/Layers/ProviderEventLoggers.ts:70` 到 `apps/server/src/provider/Layers/ProviderEventLoggers.ts:86` 在 `localFileLogsEnabled` 开启时创建 native 和 canonical 日志。
- `apps/server/src/provider/Drivers/CodexDriver.ts:108`、`ClaudeDriver.ts:115`、`OpenCodeDriver.ts:112`、`CursorDriver.ts:100` 会把 native logger 注入 adapter。
- `apps/server/src/provider/Layers/ProviderService.ts:225` 到 `apps/server/src/provider/Layers/ProviderService.ts:240` 会写 canonical event。

影响：
- Provider 原始事件通常包含用户 prompt、文件内容片段、命令输出、工具参数、路径、模型响应甚至上游 SDK 错误详情。
- 这直接违反项目要求“日志和 trace 只记录 metadata，不记录 prompt、用户代码内容、密钥或完整文件内容”。
- 日志落在本地持久目录，远程诊断、崩溃收集、用户误传日志时会造成二次泄露。

修复方向：
- 建立统一的 provider event redaction 层，只允许写入事件类型、threadId、turnId、providerInstanceId、耗时、状态、错误类别等低敏 metadata。
- native 事件默认禁止落盘；需要调试时使用短时、显式、带红色警告的开发开关。
- 为 Codex/Claude/OpenCode/Cursor 分别写脱敏测试，覆盖 prompt、tool args、文件内容、环境变量、Authorization 等字段。

### P1-3：非 bundled Codex app-server 路径仍可能把完整 `process.env` 传给子进程

证据：
- `packages/effect-codex-app-server/src/client.ts:269` 到 `packages/effect-codex-app-server/src/client.ts:285` 中 `layerCommand` 使用 `env: { ...process.env, ...options.env }`。
- `apps/server/src/provider/BundledEngineConfig.ts:168` 到 `apps/server/src/provider/BundledEngineConfig.ts:173` 中非 bundled 情况直接 `{ ...input.baseEnv, ...patch }`。
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts:157` 到 `apps/server/src/provider/Layers/CodexSessionRuntime.ts:163` 支持外部传入 runtime environment。

影响：
- 系统 Codex、探测路径、开发/非商业路径可能拿到 dev2 JWT、API key、CI secret、内部桥接 token、更新配置等。
- 子进程、第三方 CLI、插件式 provider 不应默认继承父进程全部环境变量。当前实现和项目安全要求冲突。

修复方向：
- 子进程环境必须统一走显式白名单构造，禁止底层库再隐式合并 `process.env`。
- 把 `PATH`、HOME、代理、证书、必要 provider env 分开建模；敏感值通过 secret store 或专门注入点传递。
- 增加测试断言 `MYIDE_IDE_JWT`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等默认不会进入非目标 provider 子进程。

### P1-4：Provider 基础环境按 `MYIDE_`、`T3CODE_` 前缀批量继承，白名单过宽

证据：
- `apps/server/src/provider/ProviderInstanceEnvironment.ts:3` 到 `apps/server/src/provider/ProviderInstanceEnvironment.ts:44` 有基础 key 白名单。
- `apps/server/src/provider/ProviderInstanceEnvironment.ts:46` 将 `MYIDE_`、`T3CODE_` 作为继承前缀。
- `apps/server/src/provider/ProviderInstanceEnvironment.ts:55` 到 `apps/server/src/provider/ProviderInstanceEnvironment.ts:64` 根据该规则复制环境变量。

影响：
- `MYIDE_` 和 `T3CODE_` 前缀里可能包含 IDE JWT、更新配置、内部服务 URL、Browser/Computer 工具 token、调试开关等。
- 这不是白名单，而是把一整类未来变量默认暴露给 provider 子进程；后续新增敏感变量会自动泄露。

修复方向：
- 删除前缀继承，改成逐项显式允许。
- 把商业网关、自动更新、桌面桥接、provider runtime 的环境变量命名空间拆开，避免一个前缀承载所有安全域。
- 对每个 provider instance 的 env 做“可回传/不可回传、可落日志/不可落日志、可传子进程/不可传子进程”分类。

### P1-5：第三方 SkillHub ZIP 缺少强制信任根，`securityStatus = unknown` 仍可安装

证据：
- `apps/server/src/skills/SkillHubCatalogProvider.ts:15` 固定使用 `https://api.skillhub.cn`。
- `apps/server/src/skills/SkillsService.ts:416` 到 `apps/server/src/skills/SkillsService.ts:438` 只有 manifest 文件带 sha256 时才校验，并把状态置为 `verified`。
- `apps/server/src/skills/SkillsService.ts:440` 到 `apps/server/src/skills/SkillsService.ts:442` 即使没有哈希也返回 `securityStatus: "unknown"`。
- `apps/server/src/skills/SkillsService.ts:664` 到 `apps/server/src/skills/SkillsService.ts:740` 会继续安装该 ZIP。

影响：
- 技能是影响模型行为和工具使用的执行入口。当前虽然有 ZIP path、大小、文件数、危险扩展限制，但没有证明内容来自可信发布者。
- 如果 SkillHub 服务、账号或传输链路被污染，用户可能安装恶意技能，进而诱导模型读取敏感文件、执行高风险操作或绕过计费/策略。

修复方向：
- 对第三方技能建立签名信任根或透明日志；至少要求 catalog 元数据和 ZIP 内容都由可信 key 签名。
- `unknown` 状态默认不得一键安装；必须有明确风险确认和最小权限沙箱。
- 安装后技能权限应显式声明和审批，不能仅依赖文件扩展过滤。

## P2

### P2-1：项目 favicon 接口接受任意 `cwd`，可越权读取固定候选图标文件

证据：
- `apps/server/src/http.ts:457` 到 `apps/server/src/http.ts:474` 从 query 读取 `cwd` 后直接传入 `ProjectFaviconResolver.resolvePath`。
- `apps/server/src/project/Layers/ProjectFaviconResolver.ts:96` 到 `apps/server/src/project/Layers/ProjectFaviconResolver.ts:119` 在传入 cwd 下查找固定候选图标和 HTML 中的 icon href。
- `apps/server/src/project/Layers/ProjectFaviconResolver.ts:70` 到 `apps/server/src/project/Layers/ProjectFaviconResolver.ts:73` 只校验候选文件在传入的 cwd 内，没有校验 cwd 是否属于已授权项目/工作区。

影响：
- 已认证客户端可以构造任意本机目录作为 cwd，读取该目录下固定候选路径的 svg/png/ico 文件，或通过 HTML 中的 icon 引用探测文件存在性。
- 单次泄露范围有限，但在远程配对、多客户端、共享环境中属于权限边界不完整。

修复方向：
- `cwd` 必须先经过项目/工作区注册表校验，或只允许使用已知 project id，再由服务端解析到 cwd。
- resolver 只负责图标定位，不应承担授权判断。

### P2-2：远程环境 bearer token 持久化在浏览器 localStorage 风险过高

证据：
- `apps/web/src/clientPersistenceStorage.ts:12` 到 `apps/web/src/clientPersistenceStorage.ts:13` 使用 localStorage key 保存客户端设置和环境 registry。
- `apps/web/src/clientPersistenceStorage.ts:15` 到 `apps/web/src/clientPersistenceStorage.ts:31` schema 中包含 `bearerToken`。
- `apps/web/src/clientPersistenceStorage.ts:155` 到 `apps/web/src/clientPersistenceStorage.ts:188` 直接读写 `bearerToken`。

影响：
- 一旦前端出现 XSS、第三方脚本污染、恶意浏览器扩展或本机其他进程读取浏览器 profile，远程 IDE bearer token 会被直接拿走。
- 该 token 可用于远程 server auth/session、ws-token 等链路，影响远程项目和会话。

修复方向：
- 浏览器端只持有短期、可轮换、scope 限制的 session token；长期 secret 应由 httpOnly secure cookie 或桌面安全存储/系统凭据托管。
- saved environment registry 中不要混放普通配置和 secret。
- 增加 token 过期、设备绑定、撤销、异常使用审计。

### P2-3：Windows 打开外部编辑器使用 `shell: true` 且仅简单包裹参数，存在命令注入面

证据：
- `packages/contracts/src/editor.ts:47` 到 `packages/contracts/src/editor.ts:50` 中 `cwd` 只是非空字符串。
- `apps/server/src/ws.ts:1663` 到 `apps/server/src/ws.ts:1666` WebSocket RPC 直接调用 `externalLauncher.launchEditor(input)`。
- `apps/server/src/process/externalLauncher.ts:80` 到 `apps/server/src/process/externalLauncher.ts:112` 把 target path 作为 editor 参数。
- `apps/server/src/process/externalLauncher.ts:373` 到 `apps/server/src/process/externalLauncher.ts:382` Windows 非文件管理器命令走 `shell: true`，参数只做 `\"${arg}\"` 包裹。

影响：
- 如果 `cwd` 或文件路径里包含双引号、`&`、`|` 等 shell 元字符，简单双引号包装不足以构成可靠转义。
- 路径可能来自 markdown/terminal link/open-in-editor 等用户可控入口。即使需要用户点击，仍属于本地命令执行风险面。

修复方向：
- 不使用 `shell: true` 启动编辑器；直接 spawn 可执行文件并传 argv。
- 如果必须经 shell，必须使用平台级转义函数或 PowerShell `-EncodedCommand` 且参数进入安全数组。
- `LaunchEditorInput.cwd` 应先规范化为本机绝对路径，并限制在当前 workspace 或已登记路径内。

### P2-4：Bitbucket API 错误把远端响应 body 原样拼进错误 detail

证据：
- `apps/server/src/sourceControl/BitbucketApi.ts:357` 到 `apps/server/src/sourceControl/BitbucketApi.ts:375` 读取 `response.text` 并把 `body.trim()` 拼进 `BitbucketApiError.detail`。
- `apps/server/src/sourceControl/BitbucketApi.ts:387` 到 `apps/server/src/sourceControl/BitbucketApi.ts:393` 同一 API 请求可携带 bearer token 或 basic auth。

影响：
- 上游错误响应可能包含请求片段、账号信息、token 诊断、仓库私有信息；这些 detail 可能被日志、trace 或 UI 展示。
- 源码管理是敏感边界，错误 body 不应默认进入可观测和前端链路。

修复方向：
- 错误 detail 只保留 HTTP 状态、错误类型、request id、provider kind。
- 如果必须保留 body，用集中脱敏器过滤 token、Authorization、URL query、email、仓库私有路径，并限制长度。

### P2-5：附件按 id 读取时返回目录中的第一个普通文件，文件选择规则不确定

证据：
- `apps/server/src/http.ts:419` 到 `apps/server/src/http.ts:425` 对不含 `/` 和 `.` 的路径走 id lookup。
- `apps/server/src/attachmentStore.ts:150` 到 `apps/server/src/attachmentStore.ts:164` 在新结构目录中 `readdirSync` 后返回 `entries.find((entry) => entry.isFile())`。

影响：
- 如果附件目录被污染、迁移失败或未来写入多文件，同一个 attachment id 可能返回非预期文件。
- 当前上传写入路径有根目录保护，所以不是高危任意文件读；但“目录第一个文件”作为协议规则不可维护，也难以审计。

修复方向：
- 存储时写 manifest 或固定安全文件名，GET 时按 manifest/元数据读取。
- 目录中出现多文件或未知文件名时返回 409/500，不要静默选择第一个。

### P2-6：日志和错误处理没有统一脱敏策略，多个边界会把原始 cause/message 暴露到日志或前端

证据：
- `apps/server/src/http.ts:161` 到 `apps/server/src/http.ts:164` 记录 browser OTLP decode cause。
- `apps/desktop/src/updates/DesktopUpdates.ts:512` 到 `apps/desktop/src/updates/DesktopUpdates.ts:521` 使用 `Cause.pretty(cause)` 记录更新失败。
- `apps/server/src/remoteControl/http.ts:180` 到 `apps/server/src/remoteControl/http.ts:188` 会把 QQ access token 请求失败的响应 JSON 拼入错误 message。
- `apps/server/src/remoteControl/http.ts:219` 到 `apps/server/src/remoteControl/http.ts:225` 会把 QQ 发消息失败响应 text 拼入错误 message。

影响：
- 原始 cause/message 来自外部 SDK、HTTP 响应、系统进程，内容不可控，可能包含 token、URL、内部路径、用户输入。
- 当前问题不是某一处日志过多，而是缺少统一的“可返回给用户”和“可写日志”错误模型。

修复方向：
- 建立统一 `safeErrorDetail`/`redactErrorCause`，日志、trace、RPC 错误响应都必须经过它。
- 外部 HTTP 响应 body 默认不写日志；只记录状态码、provider、request id、错误分类。

## P3

### P3-1：多处中文注释/文档出现编码损坏，降低维护和审计可靠性

证据：
- `apps/server/src/provider/Layers/ProviderEventLoggers.ts:2` 到 `apps/server/src/provider/Layers/ProviderEventLoggers.ts:18` 中中文注释出现乱码。
- `apps/server/src/skills/SkillsService.ts:2` 到 `apps/server/src/skills/SkillsService.ts:8` 头部说明乱码。
- `apps/server/src/remoteControl/RemoteControlLayer.ts:286`、`apps/server/src/remoteControl/http.ts:74` 等用户可见错误文本也出现乱码迹象。

影响：
- 注释和错误文本是安全审计、排障和用户反馈的一部分。乱码会让开发者误读边界，用户也无法正确理解失败原因。

修复方向：
- 统一以 UTF-8 读写，增加编码检查或 lint。
- 对用户可见中文文案做快照测试，避免再次引入 mojibake。

### P3-2：前端 `dangerouslySetInnerHTML` 当前依赖常量 SVG，未来接入 marketplace/plugin 图标时容易变成 XSS

证据：
- `apps/web/src/components/ComposerPromptEditor.tsx:146` 和 `apps/web/src/components/ComposerPromptEditor.tsx:289` 使用 `dangerouslySetInnerHTML`。
- `apps/web/src/components/chat/SkillInlineText.tsx:118` 使用 `dangerouslySetInnerHTML`。
- `apps/web/src/components/chat/ComposerCommandMenu.tsx:286` 渲染 plugin icon SVG。

影响：
- 当前审查未发现这些路径直接渲染远程 SVG；大多来自内置常量，因此不是现成高危漏洞。
- 但项目已经有 marketplace/plugin/skill 体系，后续若把第三方 iconSvg 接入这条渲染路径，会立即形成 XSS。

修复方向：
- 组件 API 层禁止传入任意 SVG 字符串，改为受控 icon id 或经过严格 sanitizer 的 SVG AST。
- 对所有 marketplace/plugin/skill 图标统一使用 URL 图片或受控图标注册表。

### P3-3：`CodexSessionRuntime` 存在协议 schema 临时兼容 TODO，协议边界容易漂移

证据：
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts:131` 到 `apps/server/src/provider/Layers/CodexSessionRuntime.ts:137` 手动给生成 schema 补 `collaborationMode`。

影响：
- 项目明确要求对接真实 Codex app-server 协议，不做伪功能。手动补 schema 容易导致 contracts、生成协议和运行时行为不一致。

修复方向：
- 从 `D:\workspace\codexdev\codex-rs` 与生成链路根治协议 schema，重新生成 `packages/effect-codex-app-server`，删除运行时临时补丁。

## 已确认但未列为问题的点

- 附件上传落盘有临时文件、大小限制、根目录 realpath 校验；本次没有发现上传路径穿越。
- `/api/skills/asset` 和 `/api/skills/installed-asset` 走 HTTP 认证，并有目录内路径检查；主要问题是第三方技能来源信任，而不是 asset 路由裸露。
- QQ webhook HTTP 入口有官方签名校验；风险主要在错误脱敏和 WebSocket 内部 RPC 权限面，不是未认证公网 webhook。
- Composer 当前 SVG 注入主要来自内置常量；因此只列 P3 维护性风险。
