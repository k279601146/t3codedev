# AGENTS.md - T3 Code 开发导航

> 本文件是给后续 AI/人工开发者的快速入口。遇到乱码通常是中文注释的编码问题，请统一使用 UTF-8。

## 0. 基本要求

- 所有代码注释、提交说明草稿、评审意见和对用户回复必须使用中文。
- 修改前先阅读相关模块的现有实现和测试，优先沿用本仓库已有模式。
- 只改与任务相关的文件；工作区可能已有别人未提交的改动，严禁回滚或格式化无关文件。
- 新增功能必须优先考虑共享抽象，避免在多个文件复制相同逻辑。
- `packages/contracts` 只放协议和 Schema，不放运行时业务逻辑。
- `packages/shared` 通过显式 subpath exports 暴露工具，不新增总入口 barrel。

## 1. 当前项目快照

T3 Code 已经不只是早期 Web GUI，而是一个面向商业化的 AI 编程助手 IDE 客户端：

- **运行形态**：CLI/本地 server、React Web、Electron Desktop、营销站、Chrome 扩展。
- **核心后端**：`apps/server` 提供 HTTP/WebSocket、本地数据、认证、provider 编排、checkpoint、git/source control、终端和可观测性。
- **Provider 体系**：通过统一 Provider 抽象接入 Codex、Claude、OpenCode、Cursor/ACP 等运行时；Codex app-server 仍是重点，但不是唯一后端。
- **核心大脑**：当前主要依赖 Codex 的 app-server 协议和运行时能力，但 T3 Code 的产品目标是脱离 Codex 品牌的商业化独立客户端。
- **核心引擎**：桌面商业化分发使用 `ai-engine.exe`，它来自 `D:\workspace\codexdev\codex-rs` 中执行 `cargo build -p codex-app-server --release` 后产出的 `codex-app-server.exe`，再改名为 `ai-engine.exe`。
- **SaaS 业务后端**：登录、账号、JWT 签发和商业化用户体系来自 `D:\workspace\dev2_OpenHarness_SaaS`，本地开发默认访问 `http://localhost:3001/`。
- **模型网关**：模型路由和真实上游密钥转换由 fork 后的 `sub2api` 提供，源码目录为 `D:\workspace\sub2api-fork`。
- **前端形态**：`apps/web` 是三栏 IDE 体验，包含项目/会话侧栏、对话流、Diff、编辑器、终端、设置、插件/技能、自动化等页面。
- **桌面端**：`apps/desktop` 负责 Electron 容器、后端进程管理、IPC、安全存储、更新、Tailscale/SSH/远程暴露和系统能力桥接。
- **商业化方向**：客户端只持有 SaaS 后端签发的 IDE JWT；真实模型密钥不得进入客户端，模型调用通过 sub2api 网关转发。

## 2. 技术栈与命令

- 包管理器：Bun `1.3.x`，根包声明为 `bun@1.3.11`。
- Monorepo：Turbo + workspaces，包位于 `apps/*`、`packages/*`、`scripts`、`oxlint-plugin-t3code`。
- TypeScript：`moduleResolution: NodeNext`，严格模式，开启 Effect language service 规则。
- 后端：Node/Effect，服务以 Layer/Service 组织。
- 前端：React 19、Vite 8、TanStack Router、Zustand、Tailwind v4、Monaco、Lexical、lucide-react。
- 桌面端：Electron + tsdown。

常用命令：

```bash
bun install .
bun run dev
bun run dev:server
bun run dev:web
bun run dev:desktop
bun run typecheck
bun run test
bun run lint
bun run fmt
```

开发端口由 `scripts/dev-runner.ts` 统一分配：

- 默认 server 端口：`13773`
- 默认 web 端口：`5733`
- 可用 `T3CODE_PORT_OFFSET` 或 `T3CODE_DEV_INSTANCE` 跑多实例。
- 默认数据目录为 `BAHEW_HOME`，未设置时走 `~/.bahew`；开发时可显式指定隔离目录。

## 3. 包职责

### apps

- `apps/server`：发布 CLI `t3`，本地 HTTP/WS server，provider session 管理，编排引擎，认证，checkpoint，git/source control，终端，自动化，观测数据。
- `apps/web`：React/Vite UI，路由、会话体验、对话流、模型选择、Diff/编辑器、设置、自动化、插件/技能、状态管理。
- `apps/desktop`：Electron 主进程和 preload，启动/管理内置后端，IPC，安全存储，更新，窗口/菜单，SSH/Tailscale，Windows 沙箱相关能力。
- `apps/marketing`：Astro 营销站。
- `apps/chrome-extension`：浏览器扩展构建入口。

### packages

- `packages/contracts`：Effect Schema 和 TypeScript 协议定义，包括 auth、rpc、provider、orchestration、filesystem、editor、layout、terminal、settings、sourceControl 等。
- `packages/shared`：跨 server/web/desktop 的运行时工具，例如 git、sourceControl、logging、observability、shell、path、commercialUsage、workspaceConfig、workers 等；必须使用显式子路径导入。
- `packages/client-runtime`：Web 客户端运行时封装，连接 contracts/shared 和 UI。
- `packages/effect-codex-app-server`：Codex app-server 的 Effect 客户端、Schema、RPC、protocol、errors。
- `packages/effect-acp`：ACP 协议 client/agent/schema/rpc/protocol/terminal/errors。
- `packages/ssh`：SSH 认证、命令、配置和 tunnel 能力。
- `packages/tailscale`：Tailscale 集成能力。

## 4. 关键目录速查

### Server

- `apps/server/src/bin.ts`、`server.ts`、`http.ts`、`ws.ts`：启动、HTTP 和 WebSocket 入口。
- `apps/server/src/auth/**`：服务端认证、bootstrap credential、session credential、secret store。
- `apps/server/src/provider/**`：provider 抽象、驱动、适配器和会话运行时。
- `apps/server/src/provider/Layers/CodexAdapter.ts`：Codex app-server 适配核心。
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`：Claude Code 适配核心。
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`：OpenCode 适配核心。
- `apps/server/src/provider/acp/**`：Cursor/ACP 相关协议支持。
- `apps/server/src/orchestration/**`：命令决策、投影、domain event、runtime ingestion、reactor。
- `apps/server/src/checkpointing/**`：checkpoint 存储、diff 查询、Shadow Git checkpoint。
- `apps/server/src/git/**`：本地 git 操作和工作流服务。
- `apps/server/src/observability/**`：本地 trace、OTLP、metrics、RPC instrumentation。

### Web

- `apps/web/src/routes/**`：TanStack Router 页面，包括 chat、settings、automations、plugins、skills、pair。
- `apps/web/src/components/chat/**`：对话、composer、模型选择、provider 状态、计划卡片、上下文、消息 timeline。
- `apps/web/src/components/DiffPanel.tsx` 和 `DiffPanelShell.tsx`：Diff 体验。
- `apps/web/src/store.ts`、`storeSelectors.ts`、`session-logic.ts`：核心会话状态与派生逻辑。
- `apps/web/src/localApi.ts`、`environmentApi.ts`：客户端与本地/宿主 API 的连接层。
- `apps/web/src/editorStore.ts`、`cursorLayoutStore.ts`、`rightPanelStore.ts`：IDE 布局和编辑器相关状态。
- `apps/web/src/index.css`：全局样式和 Tailwind 入口。

### Desktop

- `apps/desktop/src/main.ts`、`preload.ts`：Electron 入口。
- `apps/desktop/src/app/**`：应用生命周期、环境、状态、资产、观测。
- `apps/desktop/src/backend/**`：内置 server 配置、启动、远程暴露。
- `apps/desktop/src/ipc/**`：IPC channel、handler 和具体方法。
- `apps/desktop/src/settings/**`：桌面端持久设置、商业登录状态、环境配置。
- `apps/desktop/src/security/DesktopWindowsSandbox.ts`：Windows 沙箱能力。
- `apps/desktop/src/updates/**`：更新检查和状态机。

## 5. 数据流与架构主线

1. Desktop 或 CLI 启动 `apps/server`。
2. Web 通过 HTTP/WS 连接 server，协议类型来自 `packages/contracts`。
3. 用户发送消息后，server 的 orchestration 层创建/处理命令，写入 domain event，并投影出前端可消费状态。
4. Provider 层根据 provider instance 选择 Codex/Claude/OpenCode/Cursor 等适配器，启动或复用 session runtime。
5. 运行时事件被标准化后进入 orchestration ingestion，再通过 WebSocket 推送到 Web。
6. Web 根据 domain event 更新会话、消息流、Diff、终端、审批/输入面板等 UI。
7. checkpoint、git、source control、terminal、automation 等能力在 server 侧集中执行，Web 只发协议请求和渲染结果。

## 6. Provider 开发准则

- 新 provider 或新运行时能力应先从 `ProviderDriver`、`ProviderAdapter`、`ProviderService`、`ProviderInstanceRegistry` 的现有抽象开始。
- Provider 原始事件不要直接泄漏到 Web；先转成 contracts/orchestration 能表达的事件。
- Codex app-server 相关协议优先放在 `packages/effect-codex-app-server`，server 只做业务编排。
- ACP 协议相关内容优先放在 `packages/effect-acp` 或 `apps/server/src/provider/acp/**`。
- provider 环境变量必须走 provider instance 配置和 secret store；敏感值保存后不能再回传给前端。
- 多账号/多 home 的兼容规则参考 `docs/providers/codex.md` 和 `docs/providers/claude.md`。

## 7. 安全与认证

- 客户端唯一应该长期持有的是 `dev2_OpenHarness_SaaS` 签发的 IDE JWT 或桌面端安全存储中的用户登录状态。
- 真实 AI 提供方密钥不得写入前端状态、localStorage、日志、trace、错误消息或普通配置文件。
- 登录、账号、JWT 签发、订阅状态等 SaaS 用户体系不在本仓库实现，开发时查看 `D:\workspace\dev2_OpenHarness_SaaS`，本地入口通常是 `http://localhost:3001/`。
- 发往模型网关/sub2api 的请求使用 `Authorization: Bearer <JWT>`，由网关按业务后端认可的身份和策略路由模型，并在服务端替换真实上游密钥。
- 启动 provider 子进程时不要无脑透传 `process.env`；只传必要白名单和用户显式配置的 provider env。
- 敏感 provider env 必须通过 server secret store 保存，返回给 Web 时只返回占位/metadata。
- 文件系统、git、terminal、checkpoint 这类能力必须校验 workspace/root 边界，避免路径穿越。
- 日志和 trace 只记录 metadata、ID、耗时、错误类型；不要记录 prompt、用户代码内容、密钥或完整文件内容。

## 8. AI 引擎、沙箱与商业化约束

- `ai-engine.exe` 不是在本仓库直接构建的产物；来源是 `D:\workspace\codexdev\codex-rs` 的 `codex-app-server` release 构建产物。
- 构建流程：在 `D:\workspace\codexdev\codex-rs` 执行 `cargo build -p codex-app-server --release`，将生成的 `codex-app-server.exe` 按发布约定重命名为 `ai-engine.exe` 后随桌面端或安装包分发。
- 修改 app-server 协议、引擎能力或 Rust 侧行为时，应先到 `D:\workspace\codexdev\codex-rs` 修改并重新构建，再回到本仓库适配 contracts/provider/web 展示。
- `D:\workspace\dev2_OpenHarness_SaaS` 是商业化 SaaS 后端，负责登录页面、账号体系、JWT 签发、订阅/套餐/用户侧商业闭环；T3 Code 只消费它提供的身份和商业状态。
- `D:\workspace\sub2api-fork` 是模型网关，负责多模型路由、上游 API 适配、真实 provider key 管理和服务端转发；它不应该承担 T3 Code 客户端 UI 或本地 IDE 编排职责。
- T3 Code 本仓库负责 IDE 客户端、本地 server、provider 编排、桌面壳、Web UI、协议 contracts、本地文件/git/terminal/checkpoint 能力，以及把 SaaS JWT 带入模型网关调用链。
- T3 Code 可以复用 Codex app-server 的能力，但产品、品牌、登录、计费、模型网关、桌面体验和用户数据闭环都应按独立商业客户端设计，避免在 UI/文案/架构上把 T3 Code 做成 Codex 的简单外壳。
- 商业化内置引擎配置位于 `@t3tools/shared/commercialEngine` 和 server/desktop provider 相关模块。
- Windows 沙箱和 artifact 相关共享逻辑在 `@t3tools/shared/windowsSandboxArtifacts`，桌面端系统能力在 `apps/desktop/src/security/**`。
- Codex 类运行时需要注意 `CODEX_HOME`/shadow home 隔离，避免污染用户全局配置。
- 若需要注入 Codex 配置，优先通过启动参数或 provider 配置，不修改用户系统级 `~/.codex/config.toml`。
- 用量展示使用 `packages/contracts/src/model.ts` 和 `packages/shared/src/commercialUsage.ts` 的模型；扣量只能由网关服务端决定。

## 9. UI 与前端开发规范

- UI 目标是高密度、可重复使用的 IDE 工作界面，不做营销页式大卡片堆叠。
- 三栏 IDE、右侧对话、Diff、编辑器、终端和设置页要保持一致的信息密度和键盘友好体验。
- 图标按钮优先使用 `lucide-react` 或项目既有图标组件；不手写重复 SVG。
- 复杂组件要拆出纯逻辑文件并配套测试，例如现有 `*.logic.ts` / `*.test.ts` 模式。
- 避免组件里堆大型条件分支；可复用状态放 store/selector，协议数据转换放独立纯函数。
- 修改 UI 后尽量运行相关 Vitest；显著视觉改动应使用浏览器截图核对桌面和移动尺寸。
- 不要在应用界面写“这是某某功能说明/快捷键说明”的大段帮助文案，除非该页面本来就是设置或文档入口。

## 10. Effect、Schema 与类型规范

- 运行时边界使用 Effect Schema 解码，不用随意的 `as` 或手写不完整校验。
- Effect 服务遵循 `Services/**` 定义接口、`Layers/**` 提供实现的模式。
- 新增异步/外部 IO 优先建清晰的 Effect 边界，错误类型要可诊断。
- 遵守根 `tsconfig.base.json` 的 Effect language service 规则：避免全局 `Date`、`Random`、`console`、timer 等不可控副作用进入 Effect 流。
- 共享协议先改 `packages/contracts`，再改 server/web/desktop 调用侧。
- 不要把 React 组件、Node IO 或业务副作用放进 `packages/contracts`。

## 11. 可观测性与日志

- 当前服务端观测模型见 `docs/observability.md`。
- 人类可读日志输出到 stdout；持久化事实以本地 NDJSON trace 为准。
- 默认 trace 文件在 `serverTracePath`，开发时通常在 `./dev/logs/server.trace.ndjson` 或 `BAHEW_HOME/userdata/logs/server.trace.ndjson`。
- OTLP trace/metrics 通过 `T3CODE_OTLP_TRACES_URL`、`T3CODE_OTLP_METRICS_URL`、`T3CODE_OTLP_SERVICE_NAME` 开启。
- 新增观测优先选择 RPC、orchestration、provider、外部进程、持久化、队列交接等边界，不要给每个小 helper 打 span。
- metric label 必须低基数；路径、threadId、commandId 等高基数字段放 span attributes。

## 12. Checkpoint、Git 与 Source Control

- checkpoint 当前实现集中在 `apps/server/src/checkpointing/**`，设计背景见 `docs/checkpoint-design_V2.md`。
- git/source control 能力集中在 `apps/server/src/git/**`、`packages/shared/sourceControl` 和 contracts 的 source control/vcs 协议。
- 支持 GitHub、GitLab、Bitbucket、Azure DevOps 的用户文档见 `docs/source-control-providers.md`。
- Git 操作需要考虑 hook 耗时、失败、认证缺失、非 git 工作区和 shadow git 场景。
- 还原、清理、删除类操作要特别谨慎，必须明确目标目录并限制在预期 workspace 内。

## 13. 测试与验证

- 优先运行受影响包的测试：`bun run test --filter=<包名>` 或直接在对应包跑 `vitest run <测试文件>`。
- 跨协议/共享类型改动后运行 `bun run typecheck`。
- 修改 formatter/lint 相关内容后运行 `bun run lint` 或至少 `bun run fmt:check`。
- server 编排、provider、checkpoint、认证、git、用量、安全相关改动必须有针对性单元测试。
- Web 纯逻辑优先写普通 Vitest；需要 DOM/交互时使用现有 React/Vitest browser 测试模式。
- 如果没有运行测试，最终说明必须明确原因和剩余风险。

## 14. 文档入口

- 总览：`README.md`
- 贡献约束：`CONTRIBUTING.md`
- 可观测性：`docs/observability.md`
- Codex provider 多账号：`docs/providers/codex.md`
- Claude provider 多账号和路由：`docs/providers/claude.md`
- 用量计费模型：`docs/usage-billing-system.md`
- Source Control：`docs/source-control-providers.md`
- Checkpoint 设计：`docs/checkpoint-design_V2.md`
- Codex app-server JSON-RPC：`docs/CodexAppServer_json-RPC.md`
- 多模型/Codex app-server 方案：`docs/codex-app-server多模型支持方案.md`

## 15. 开发者工作流建议

1. 先定位所属包和边界：contracts、shared、server、web、desktop 不要混放职责。
2. 用 `rg` 搜现有相似实现，沿用已有 Service/Layer/store/component/test 命名风格。
3. 先改协议和共享纯逻辑，再接 server runtime，最后接 UI。
4. 对高风险路径加测试：认证、密钥、文件系统、进程、git、provider event、计费展示。
5. 保持改动小而完整，避免顺手重构无关区域。
6. 最后运行能覆盖本次改动的最小命令，并在回复中说明结果。
