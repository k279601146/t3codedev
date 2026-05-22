# AGENTS.md - T3 Code 开发准则与架构指南


- 所有代码注释及回复必须使用 **中文**。

## 2. 项目愿景与快照 (Project Snapshot)

T3 Code 正在从一个简单的 Web GUI 演进为一款 **商业化 AI 编程助手 IDE 客户端**。

- **核心引擎**：基于 `openai/codex` 的 `app-server` 模式，通过捆绑二进制文件实现免安装运行。
- **后端架构**：Fork `sub2api` 作为业务后端与网关层，负责多模型路由、JWT 认证及计费。
- **UI 目标**：实现 Cursor 风格的三栏布局（文件树、Monaco 编辑器、AI 对话面板）。

## 3. 核心优先级 (Core Priorities)

1. **安全第一 (Security First)**：客户端严禁存储或泄露任何真实的 AI 提供方密钥。
2. **极致性能 (Performance)**：追求首屏秒开、AI 响应零延迟感。
3. **高可靠性 (Reliability)**：具备进程崩溃自动恢复、网络抖动重试机制。
4. **易维护性 (Maintainability)**：坚持高内聚低耦合，严禁在 `codex-core` 等核心库堆砌零散业务逻辑。

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## 4. 安全与认证准则 (Security & Auth)

- **JWT 访问凭证**：客户端唯一持有的凭证是用户登录后签发的 JWT。
- **密钥转换**：客户端请求 AI 时，将 JWT 作为 `Authorization: Bearer <JWT>` 发送至自建网关（sub2api）。由网关验证身份后，在服务端替换为真实密钥转发至上游。
- **最小环境变量白名单**：
  - 在 `spawn` AI 引擎子进程时，严禁透传 `process.env` 的全量副本。
  - 必须使用白名单：`PATH`, `HOME`, `LANG`, `TERM`, `OPENAI_BASE_URL` (指向网关), `OPENAI_API_KEY` (填入 JWT)。
- **Shell 隔离**：启动参数必须包含 `--config shell_environment_policy.include_only=["PATH","HOME","LANG"]`，防止 AI 执行 shell 命令时读取敏感环境变量。

## 5. AI 引擎与沙箱 (AI Engine & Sandbox)

- **二进制捆绑**：使用 Release 版本的 `codex-app-server` 并重命名为 `ai-engine` (Windows 下为 `ai-engine.exe`)。
- **免配置运行**：启动时必须携带 `--no-load-config` 参数，所有配置通过 `--config` 命令行参数动态注入，严禁修改用户系统的 `~/.codex/config.toml`。
- **隔离 CODEX_HOME**：将 `CODEX_HOME` 环境变量重定向到应用的 `userData/agent-data` 目录，实现数据隔离。
- **Windows 沙箱策略**：
  - 默认使用 `windows.sandbox="unelevated"` (无感隔离，无需管理员权限)。
  - 生产环境安装阶段可通过 `sandbox-setup.exe` 初始化 `elevated` 强隔离环境。

## 6. 架构与 UI 规范 (Architecture & UI)

- **三栏布局 (Cursor Mode)**：
  - **左栏**：文件树 (react-arborist) + 会话列表。
  - **中栏**：Monaco Editor (完整读写能力，支持 Diff 预览)。
  - **右栏**：AI 对话面板。
- **文件读写 (WS RPC)**：前端通过 WebSocket 调用服务端的 `file.readFile` / `file.writeFile` 实现编辑器读写，确保路径在工作区 Root 内（防止路径穿越）。
- **组件复用**：复杂逻辑优先提取至 `packages/shared`，UI 组件严格遵循 HeroUI (Tailwind v4) 规范。

## 7. 性能与可观测性 (Optimization & Observability)

- **进程预热 (Warm Start)**：用户登录后后台预热 `ai-engine` 待机进程，消除会话启动时的冷启动延迟。
- **背压控制 (Backpressure)**：针对流式响应 Item 事件，使用有界队列处理，防止前端渲染拥塞导致内存溢出。
- **结构化日志**：使用 Winston 记录结构化 JSON 日志。严禁记录用户代码内容，仅记录 Metadata（如 token 用量、耗时、错误堆栈）。
- **遥测控制**：遥测上报必须基于用户授权，且支持批量异步上报至 `sub2api` 提供的 telemetry 接口。

## 8. 包角色定义 (Package Roles)

- `apps/desktop`: Electron 主进程，负责进程管理、安全存储、更新检查及窗口编排。
- `apps/server`: Node.js 业务服务器。连接 Electron 与前端，协调 `ai-engine` 状态。
- `apps/web`: React 视图层。负责三栏布局渲染、编辑器状态管理 (Zustand)。
- `packages/contracts`: 协议定义。新增 `file.*` 及 `layout.*` 相关 RPC 契约。

## 9. 参考仓库与文档 (References)

- **核心参考**：`openai/codex`, `Wei-Shaw/sub2api` (后端核心), `Dimillian/CodexMonitor`。
- **技术文档**：见 `docs/` 目录下的技术方案、适配方案及最佳实践系列文档。
