**商业 AI 编程助手 IDE 客户端**

技术架构与实现方案

基于 openai/codex app-server + pingdotgg/t3code

第三方反代 API · 自有账号系统 · 跨平台桌面客户端

文档版本：1.0

生成日期：2026/5/9

# **一、项目目标与需求**

## **1.1 核心目标**

构建一个商业化 AI 编程助手 IDE 客户端，核心要求如下：

- 不使用 OpenAI 官方账号系统，不使用 OpenAI 官方 API Key
- 使用第三方反代 API 服务（如 OpenRouter 或自建 LiteLLM）
- 用户无需手动安装 Codex CLI，无需手动配置 config.toml
- 有自己的商业账号系统和计费体系
- 前端基于 pingdotgg/t3code 开源项目改造
- AI Agent 引擎基于 openai/codex 的 app-server 二进制捆绑集成

## **1.2 技术选型**

| **模块**       | **选型方案**                                            |
| -------------- | ------------------------------------------------------- |
| 桌面框架       | Tauri（Rust + Webview）或 Electron，推荐 Tauri 体积更小 |
| 前端 UI        | fork pingdotgg/t3code 改造                              |
| AI Agent 引擎  | codex-app-server 独立二进制（捆绑打包）                 |
| 账号后端       | Next.js / Hono + PostgreSQL + Redis                     |
| API 反代层     | Hono 或 Nginx + JWT 验证中间件                          |
| 计费/用量统计  | 解析 AI 响应中的 token 用量写库                         |
| 第三方 AI 反代 | OpenRouter（支持几乎所有模型）或自建 LiteLLM            |

# **二、整体系统架构**

## **2.1 架构分层**

整个系统分为四个层次：

┌─────────────────────────────────────────────────────────┐

│ 用户桌面（客户端） │

│ │

│ ┌───────────────────────┐ ┌─────────────────────────┐│

│ │ t3code 改造前端 UI │ │ codex-app-server ││

│ │ (WebView/React) │◄─│ (捆绑的二进制) ││

│ └───────────────────────┘ │ AI Agent 核心引擎 ││

│ JSON-RPC └─────────────────────────┘│

│ WebSocket ↑ 环境变量注入 │

│ ┌────────────────────────────────────────────────────┐ │

│ │ Electron/Tauri 主进程 │ │

│ │ - 计算捆绑二进制路径 │ │

│ │ - spawn app-server 子进程 │ │

│ │ - 注入 API 地址 + 用户长期 Key │ │

│ │ - 管理登录状态（内存级 JWT） │ │

│ └────────────────────────────────────────────────────┘ │

└──────────────────────────────┬──────────────────────────┘

│ HTTPS

┌───────────────▼──────────────────┐

│ 你的后端服务 │

│ ┌──────────┐ ┌──────────────┐ │

│ │ 账号系统 │ │ API 中转层 │ │

│ │ JWT 认证 │ │ JWT 验证 │ │

│ │ 用量计费 │ │ 转发请求 │ │

│ └──────────┘ └──────┬───────┘ │

└─────────────────────── │──────────┘

│

┌────────────────────────▼──────────┐

│ 第三方反代 AI 服务 │

│ OpenRouter / LiteLLM / 自建代理 │

└────────────────────────────────────┘

## **2.2 通信协议**

前端 UI 与 codex-app-server 之间通过 JSON-RPC 2.0 协议通信（wire 层省略 jsonrpc:2.0 头），支持两种传输方式：

- stdio（JSONL 换行分隔）：默认方式，t3code server 层用此方式
- WebSocket（本地 ws://127.0.0.1:PORT）：适合直接从前端 WebView 连接

核心三个协议原语：

- Thread：会话（一个项目一个 Thread）
- Turn：一轮对话（用户发一条消息 = 一个 Turn）
- Item：每条消息/工具调用/文件编辑/AI 回复的最小单元（流式接收）

# **三、codex 二进制文件说明**

## **3.1 Release 中各文件的作用**

openai/codex 的 GitHub Releases 中包含多个可执行文件，以 Windows x64 为例：

| **文件名**                                             | **大小** | **是否捆绑 / 说明**                                    |
| ------------------------------------------------------ | -------- | ------------------------------------------------------ |
| codex-app-server-x86_64-pc-windows-msvc.exe            | 185 MB   | ✅ 必须捆绑 - AI Agent 核心引擎                        |
| codex-command-runner-x86_64-pc-windows-msvc.exe        | 765 KB   | ✅ 必须捆绑 - 沙箱命令执行器（需与 app-server 同目录） |
| codex-windows-sandbox-setup-x86_64-pc-windows-msvc.exe | 2.5 MB   | ⚠ 按需捆绑 - elevated 沙箱一次性初始化工具             |
| codex-responses-api-proxy-x86_64-pc-windows-msvc.exe   | -        | ❌ 不需要 - CI/CD 特权分离场景专用，与此项目无关       |

## **3.2 与普通 codex 二进制的区别**

Release 中实际有两类主二进制：

- **codex（完整版）**：带 TUI 交互界面，支持 codex app-server 子命令，适合 CLI 用户
- **codex-app-server（专用版）**：去掉 TUI，专为客户端集成设计，直接以 app-server 模式启动，体积基本相同但更纯粹

你应该捆绑 codex-app-server，而不是 codex。两者 JSON-RPC 协议完全一致，t3code 无需修改协议层。

## **3.3 可以改名吗**

**✅ 完全可以改名**

codex-app-server 是纯 Rust 静态编译二进制，没有内置名称检查。

可以改成任意名称，如 ai-engine.exe、myide-core.exe 等，功能完全不受影响。

建议统一改名，避免用户在任务管理器/进程列表中看到 codex 字样。

## **3.4 各平台捆绑清单**

| **平台**            | **需要捆绑的文件（原名）**                                                                  | **建议改名为**                   |
| ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| Windows x64         | codex-app-server-x86_64-pc-windows-msvc.exe codex-command-runner-x86_64-pc-windows-msvc.exe | ai-engine.exe command-runner.exe |
| macOS Apple Silicon | codex-app-server-aarch64-apple-darwin codex-command-runner-aarch64-apple-darwin             | ai-engine command-runner         |
| macOS Intel         | codex-app-server-x86_64-apple-darwin codex-command-runner-x86_64-apple-darwin               | ai-engine command-runner         |
| Linux x64           | codex-app-server-x86_64-unknown-linux-musl codex-command-runner-x86_64-unknown-linux-musl   | ai-engine command-runner         |

# **四、Windows 沙箱方案**

## **4.1 两种沙箱模式对比**

| **沙箱模式**           | **说明**                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| elevated（强隔离）     | 创建专用低权限沙箱用户（CodexSandboxOnline/Offline）、配置防火墙规则和 ACL 权限边界。首次运行需要管理员权限（UAC），一次性设置，后续复用。 |
| unelevated（基础隔离） | 使用当前用户的受限 Windows Token，应用 ACL 文件系统边界，无需管理员权限，无需 sandbox-setup.exe。                                          |

## **4.2 三条实施路线**

### **路线 A：捆绑 sandbox-setup.exe，支持 elevated 沙箱（完整功能）**

安装包中包含 sandbox-setup.exe（2.5 MB）。首次使用时，Electron 主进程检测沙箱是否已初始化，未初始化则弹出自定义引导对话框（非突然 UAC），用户同意后以管理员权限静默运行 sandbox-setup.exe，此后不再需要。

// 检测沙箱是否已初始化（检查沙箱用户是否存在）

function isSandboxInitialized(): boolean {

try {

execFileSync('powershell', \[

'-NoProfile', '-Command',

'Get-LocalUser -Name CodexSandboxOnline -ErrorAction Stop'

\], { stdio: 'pipe' });

return true;

} catch { return false; }

}

### **路线 B：不捆绑 sandbox-setup.exe，强制使用 unelevated 沙箱（推荐早期版本）**

在 spawn app-server 时通过 --config 传入配置，无需任何额外文件，对用户完全无感知。

"--config", \`windows.sandbox="unelevated"\`,

### **路线 C：在安装阶段（NSIS/WiX）以管理员权限完成 elevated 沙箱设置（最流畅体验）**

安装包本身就以管理员身份运行，在安装阶段调用 sandbox-setup.exe，用户使用期间永远不会遇到 UAC 弹窗。

; NSIS 安装脚本片段

Section "Sandbox Setup"

ExecWait '"\$INSTDIR\\resources\\sandbox-setup.exe"' \$0

SectionEnd

**ℹ 推荐策略**

产品早期：使用路线 B（unelevated），最简单，无需 UAC，立即上线。

产品成熟后：升级为路线 C（安装阶段初始化 elevated 沙箱），最佳用户体验。

路线 A 适合需要立即提供强沙箱但又不想改安装包的过渡阶段。

# **五、t3code 改造方案**

## **5.1 改造背景**

t3code 当前默认通过 PATH 查找系统安装的 codex CLI（类似 which codex），找不到就在 UI 上报错。需要改造为使用捆绑的 codex-app-server 二进制，无需用户单独安装任何工具。

## **5.2 需要修改的文件**

| **文件路径**                                          | **改动内容**                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| apps/desktop/src/main.ts                              | 新增：计算捆绑二进制路径 + 通过环境变量传给 Server 层                     |
| apps/server/src/codexAppServerManager.ts              | 核心：改 spawn 命令路径、参数；注入 API 配置和用户 Key                    |
| apps/server/src/provider/codex/codexProviderStatus.ts | 改：健康检查由检测 PATH 改为检测捆绑文件是否存在                          |
| apps/desktop/electron-builder.json5                   | 新增：声明 extraResources 打包二进制文件                                  |
| CI 脚本（.github/workflows/build.yml）                | 新增：构建前自动下载各平台二进制                                          |
| 前端 UI（可选）                                       | 去掉「请安装 codex CLI」的错误提示；去掉 OpenAI 登录入口；加入自有账号 UI |

## **5.3 Electron 主进程改造（apps/desktop/src/main.ts）**

import { app } from 'electron';

import path from 'node:path';

import fs from 'node:fs';

// 获取捆绑的 app-server 二进制路径

export function getBundledEnginePath(): string {

const ext = process.platform === 'win32' ? '.exe' : '';

const binaryName = \`ai-engine\${ext}\`;

if (app.isPackaged) {

// 生产：从安装包 resources/ 目录读取

return path.join(process.resourcesPath, binaryName);

} else {

// 开发：从项目本地路径读取

return path.join(\_\_dirname, '..', '..', 'bin', binaryName);

}

}

export function setEnginePath(): void {

const enginePath = getBundledEnginePath();

if (!fs.existsSync(enginePath)) {

console.error(\`\[Engine\] Binary not found at: \${enginePath}\`);

return;

}

// 通过环境变量传给 t3code server 子进程

process.env.MYIDE_ENGINE_PATH = enginePath;

process.env.MYIDE_ENGINE_HOME = path.join(app.getPath('userData'), 'agent-data');

}

// macOS/Linux 需要给二进制加执行权限

app.whenReady().then(() => {

if (process.platform !== 'win32') {

fs.chmodSync(getBundledEnginePath(), 0o755);

fs.chmodSync(path.join(process.resourcesPath, 'command-runner'), 0o755);

}

setEnginePath();

});

## **5.4 codexAppServerManager.ts 核心改造**

import { spawn, type ChildProcess } from 'node:child_process';

import path from 'node:path';

import os from 'node:os';

function getEngineBinaryPath(): string {

// 优先使用 Electron 主进程注入的捆绑路径

if (process.env.MYIDE_ENGINE_PATH) return process.env.MYIDE_ENGINE_PATH;

// 开发环境 fallback

const ext = process.platform === 'win32' ? '.exe' : '';

return \`codex-app-server\${ext}\`;

}

export class CodexAppServerManager {

private process: ChildProcess | null = null;

start(userApiToken: string): ChildProcess {

const binaryPath = getEngineBinaryPath();

const engineHome = process.env.MYIDE_ENGINE_HOME

|| path.join(os.homedir(), '.myide', 'agent-data');

this.process = spawn(binaryPath, \[

'--no-load-config',

'--config', \`model_provider="myservice"\`,

'--config', \`model_providers.myservice.name="MyService"\`,

'--config', \`model_providers.myservice.base_url="<https://api.yourservice.com/v1"\`>,

'--config', \`model_providers.myservice.wire_api="chat"\`,

'--config', \`model_providers.myservice.env_key="MYIDE_API_KEY"\`,

'--config', \`shell_environment_policy.include_only=\["PATH","HOME","LANG"\]\`,

'--config', \`disable_telemetry=true\`,

// Windows 使用 unelevated 沙箱（早期版本）

...(process.platform === 'win32'

? \['--config', \`windows.sandbox="unelevated"\`\]

: \[\]),

\], {

stdio: \['pipe', 'pipe', 'pipe'\],

env: {

PATH: process.env.PATH,

HOME: process.env.HOME ?? os.homedir(),

LANG: process.env.LANG,

// 用户长期 API Key（你后端颁发的，非 JWT）

MYIDE_API_KEY: userApiToken,

// 隔离 CODEX_HOME，与用户系统的 ~/.codex 完全分开

CODEX_HOME: engineHome,

},

});

return this.process;

}

stop(): void {

this.process?.kill('SIGTERM');

this.process = null;

}

}

## **5.5 健康检查改造（codexProviderStatus.ts）**

将原来的 PATH 检测改为检测捆绑文件是否存在：

// ❌ 原来的逻辑（废弃）

// execSync('which codex', { stdio: 'ignore' });

// ✅ 改后的逻辑

import fs from 'node:fs';

function isEngineAvailable(): boolean {

const enginePath = process.env.MYIDE_ENGINE_PATH;

if (!enginePath) return false;

try {

fs.accessSync(enginePath, fs.constants.X_OK);

return true;

} catch { return false; }

}

## **5.6 打包配置（electron-builder.json5）**

{

"build": {

"mac": {

"extraResources": \[

{ "from": "bin/ai-engine-mac", "to": "ai-engine" },

{ "from": "bin/command-runner-mac", "to": "command-runner" }

\]

},

"win": {

"extraResources": \[

{ "from": "bin/ai-engine-win.exe", "to": "ai-engine.exe" },

{ "from": "bin/command-runner-win.exe", "to": "command-runner.exe" }

\]

},

"linux": {

"extraResources": \[

{ "from": "bin/ai-engine-linux", "to": "ai-engine" },

{ "from": "bin/command-runner-linux", "to": "command-runner" }

\]

}

}

}

## **5.7 CI 自动下载二进制脚本**

\# .github/workflows/build.yml 片段

\- name: Download engine binaries

run: |

VERSION="0.101.0" # 锁定版本，测试稳定后再升级

BASE="<https://github.com/openai/codex/releases/download/rust-v\${VERSION}>"

mkdir -p apps/desktop/bin

\# macOS Apple Silicon

curl -L "\${BASE}/codex-app-server-aarch64-apple-darwin.tar.gz" |\\

tar xz -C apps/desktop/bin/

mv apps/desktop/bin/codex-app-server-aarch64-apple-darwin \\

apps/desktop/bin/ai-engine-mac-arm64

\# Windows x64

curl -L "\${BASE}/codex-app-server-x86_64-pc-windows-msvc.exe" \\

\-o apps/desktop/bin/ai-engine-win.exe

\# 同理下载 command-runner...

# **六、API Key 与账号系统集成**

## **6.1 Token 架构设计**

商业产品推荐使用「双 Token」架构，彻底解耦用户认证和 AI 请求：

用户 ←→ 你的前端 ←→ 你的账号后端

JWT（短期，2小时）

用于：登录状态维持、用量查询、计费管理

你的后端 → 颁发长期 API Key（类似 sk-xxx）→ 存储在用户记录

codex-app-server 使用的是：长期 API Key

codex-app-server 打到的是：你的反代网关

你的反代网关：验证长期 Key → 查用量 → 转发给真实 AI 服务

结果：JWT 刷新问题与 codex-app-server 完全解耦

## **6.2 Token 流转链路**

| **步骤**          | **说明**                                                          |
| ----------------- | ----------------------------------------------------------------- |
| ① 用户登录        | 前端调用你的账号后端，返回短期 JWT                                |
| ② 获取长期 Key    | Electron 主进程用 JWT 调后端接口，获取该用户的长期 API Key        |
| ③ 存入内存        | 长期 Key 仅存在 Electron 主进程内存变量，不写磁盘                 |
| ④ 传给 Server 层  | 通过 IPC message 或环境变量传给 t3code server 子进程              |
| ⑤ 注入 app-server | 每次 spawn codex-app-server 时通过 MYIDE_API_KEY 环境变量注入     |
| ⑥ 打到反代网关    | app-server 将 Key 作为 Bearer Token 调用你的 /v1/chat/completions |
| ⑦ 网关验证转发    | 网关验证 Key 有效性、检查余额、记录用量，转发给真实 AI 服务       |

## **6.3 Electron 主进程 Token 管理**

// apps/desktop/src/auth.ts

import { ipcMain } from 'electron';

let currentUserToken: string | null = null; // 内存级，不写磁盘

export function setupAuthIPC() {

// 前端登录成功后通过 IPC 上报 Token

ipcMain.handle('auth:setToken', async (\_event, jwt: string) => {

// 用 JWT 换取长期 API Key

const resp = await fetch('<https://api.yourservice.com/auth/api-key>', {

headers: { Authorization: \`Bearer \${jwt}\` }

});

const { apiKey } = await resp.json();

currentUserToken = apiKey; // 存长期 Key，不存 JWT

notifyServerNewToken(apiKey);

return { success: true };

});

ipcMain.handle('auth:logout', () => {

currentUserToken = null;

notifyServerNewToken(null);

});

}

function notifyServerNewToken(token: string | null) {

serverProcess?.send({ type: 'auth:tokenUpdate', token });

}

## **6.4 Server 层 Token 存储与使用**

// apps/server/src/auth/tokenStore.ts

let activeToken: string | null = null;

// 接收 Electron 主进程的 Token 更新

process.on('message', (msg: any) => {

if (msg?.type === 'auth:tokenUpdate') {

activeToken = msg.token;

}

});

export function getActiveToken(): string {

if (!activeToken) throw new Error('User not logged in');

return activeToken;

}

# **七、config.toml 安全处理方案**

## **7.1 安全威胁分析**

默认情况下 codex 会把配置写入 ~/.codex/config.toml，可能包含 API Key 明文。商业产品必须完全避免这种情况。

## **7.2 四层防护措施**

### **① --no-load-config 跳过配置文件**

所有配置通过 --config key=value 命令行参数传入，完全绕过 config.toml 文件。用户机器上不会因为你的 IDE 产生任何配置文件。

### **② CODEX_HOME 重定向到隔离目录**

通过设置 CODEX_HOME 环境变量，把 codex 的所有本地状态（config、凭据、history、SQLite 数据库）从 ~/.codex 移到你应用的私有目录，与用户可能已安装的 codex CLI 完全隔离：

- macOS：~/Library/Application Support/MyIDE/agent-data/
- Windows：%APPDATA%\\MyIDE\\agent-data\\
- Linux：~/.config/MyIDE/agent-data/

### **③ API Key 只通过环境变量注入，不写文件**

通过 env_key 配置告诉 app-server 从环境变量读取 Key，环境变量只存在于进程内存，进程退出即消失：

'--config', \`model_providers.myservice.env_key="MYIDE_API_KEY"\`,

// 然后在 spawn 的 env 对象里传入：

env: { MYIDE_API_KEY: userLongTermApiKey }

### **④ shell_environment_policy 防止 Key 泄漏给子进程**

防止注入的 API Key 被 codex 内部 shell 命令（如 echo \$MYIDE_API_KEY）读取：

'--config', \`shell_environment_policy.include_only=\["PATH","HOME","LANG","TERM"\]\`,

## **7.3 完整安全启动示例**

const child = spawn(engineBinaryPath, \[

'--no-load-config',

'--config', \`model_provider="myservice"\`,

'--config', \`model_providers.myservice.base_url="\${YOUR_API_URL}"\`,

'--config', \`model_providers.myservice.wire_api="chat"\`,

'--config', \`model_providers.myservice.env_key="MYIDE_API_KEY"\`,

'--config', \`shell_environment_policy.include_only=\["PATH","HOME","LANG"\]\`,

'--config', \`disable_telemetry=true\`,

'--config', \`windows.sandbox="unelevated"\`, // Windows only

\], {

env: {

PATH: process.env.PATH,

HOME: process.env.HOME,

LANG: process.env.LANG,

MYIDE_API_KEY: currentUserLongTermKey, // 核心：内存级，进程退出即消失

CODEX_HOME: path.join(app.getPath('userData'), 'agent-data'),

},

});

# **八、后端系统设计**

## **8.1 账号系统**

你的后端需要实现以下核心功能：

- 用户注册/登录 → 下发短期 JWT（2小时有效）
- Refresh Token 机制（30天），用于静默续期
- 颁发长期用户 API Key（类似 sk-xxx，存在数据库），此 Key 传给 codex-app-server
- 用量统计：解析 AI 响应中的 token 用量，写库记录
- 用量限制：按套餐设置 token/月 上限
- 用户 Dashboard：查看用量、订阅状态、Key 管理

## **8.2 API 中转层（反代网关）**

你的反代网关暴露 OpenAI 兼容接口，接收 codex-app-server 的请求：

POST <https://api.yourservice.com/v1/chat/completions>

Authorization: Bearer sk-xxx（用户长期 API Key）

Body: { model, messages, stream: true, ... }

网关处理流程：

1\. 验证 Bearer Token 是否是有效的长期 Key

2\. 检查该用户是否还有余额/配额

3\. 记录请求开始

4\. 替换成第三方反代 Key 转发给 OpenRouter/LiteLLM

5\. 流式透传响应给 codex-app-server

6\. 响应完成后解析 usage 字段，记录用量

## **8.3 推荐技术栈**

| **组件**     | **推荐方案**                                                          |
| ------------ | --------------------------------------------------------------------- |
| 账号后端框架 | Hono（轻量，适合 Edge）或 Next.js API Routes                          |
| 数据库       | PostgreSQL（用户数据、用量记录）+ Redis（速率限制、Session）          |
| 认证         | jose（JWT 生成/验证），bcrypt（密码哈希）                             |
| API 中转     | Hono + http-proxy-middleware，或 Nginx + Lua 脚本                     |
| 第三方 AI    | OpenRouter（最简单，支持 100+ 模型）或自建 LiteLLM Proxy              |
| 部署         | Vercel / Railway / Fly.io（账号后端）+ Cloudflare Workers（反代网关） |

# **九、开发与发布路线图**

## **9.1 建议的开发顺序**

| **阶段**                 | **任务**                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 阶段 1：验证引擎         | 手动下载 codex-app-server，用 --no-load-config 和 --config 参数手动测试反代 API 是否能正常工作，验证 JSON-RPC 通信 |
| 阶段 2：搭建反代网关     | 搭建你的 API 中转层，验证 codex-app-server → 你的网关 → OpenRouter 链路畅通，记录 token 用量                       |
| 阶段 3：账号后端         | 实现注册/登录/长期 Key 颁发，完成 JWT 认证流程                                                                     |
| 阶段 4：改造 t3code      | 按第五章改造，使用捆绑二进制；去掉 OpenAI 登录；接入你的账号后端                                                   |
| 阶段 5：Electron 封装    | 写桌面 Wrapper：路径计算、Binary spawn、Token 管理；打包测试                                                       |
| 阶段 6：CI/CD            | 配置 GitHub Actions 自动下载二进制、构建安装包、多平台发布                                                         |
| 阶段 7：沙箱升级（可选） | 从 unelevated 升级到路线 C，在安装包阶段初始化 elevated 沙箱                                                       |

## **9.2 关键注意事项**

**⚠ 二进制版本管理**

在 CI 里锁定 codex-app-server 的版本号（如 VERSION="0.101.0"），不要总是拉最新版。

新版本发布后先在测试环境验证兼容性，稳定后再更新版本号并发布新安装包。

可以在客户端启动时检测引擎版本，有新版本时从你的 CDN 静默后台更新。

**⚠ macOS 签名与公证**

捆绑的 ai-engine 二进制必须经过 Apple 公证（Notarization），否则 Gatekeeper 会阻止运行。

在打包时对 resources/ 下的所有二进制签名：codesign --sign "Developer ID" --deep resources/ai-engine

提交 App 公证：xcrun altool --notarize-app ...

**ℹ 体积优化建议**

Windows：安装包压缩后约 200-250 MB（185 MB 引擎 + Electron 框架），属于正常范围。

可采用"首次启动后台静默下载"策略，安装包本身不含二进制，启动后从你的 CDN 下载（校验 SHA256）。

这样安装包可以控制在 80-100 MB，但首次启动需要下载时间。

# **十、快速参考：关键配置清单**

## **10.1 spawn app-server 的完整参数**

spawn(engineBinaryPath, \[

// 1. 不读配置文件

'--no-load-config',

// 2. 指定 AI Provider

'--config', 'model_provider="myservice"',

'--config', 'model_providers.myservice.name="MyService"',

'--config', 'model_providers.myservice.base_url="<https://api.yourservice.com/v1>"',

'--config', 'model_providers.myservice.wire_api="chat"', // 必须是 chat，不是 responses

'--config', 'model_providers.myservice.env_key="MYIDE_API_KEY"',

// 3. 安全：最小化子进程环境变量

'--config', 'shell_environment_policy.include_only=\["PATH","HOME","LANG"\]',

// 4. 关闭遥测

'--config', 'disable_telemetry=true',

// 5. Windows 沙箱（早期使用 unelevated）

'--config', 'windows.sandbox="unelevated"',

\])

## **10.2 环境变量清单**

| **环境变量**      | **说明**                                      |
| ----------------- | --------------------------------------------- |
| MYIDE_ENGINE_PATH | 捆绑二进制的绝对路径（Electron 主进程注入）   |
| MYIDE_ENGINE_HOME | 隔离的 CODEX_HOME 目录路径                    |
| MYIDE_API_KEY     | 用户长期 API Key（传给 app-server 使用）      |
| MYIDE_API_URL     | 你的反代 API 地址（可硬编码也可环境变量注入） |
| CODEX_HOME        | 重定向到隔离目录，等同于 MYIDE_ENGINE_HOME    |

## **10.3 各平台 Release 文件对照**

| **平台**            | **app-server 文件名**                                 | **大小（压缩前）** |
| ------------------- | ----------------------------------------------------- | ------------------ |
| Windows x64         | codex-app-server-x86_64-pc-windows-msvc.exe           | 185 MB             |
| macOS Apple Silicon | codex-app-server-aarch64-apple-darwin.tar.gz          | ~65 MB             |
| macOS Intel x64     | codex-app-server-x86_64-apple-darwin.tar.gz           | ~65 MB             |
| macOS Universal     | codex-app-server-aarch64-apple-darwin.zst（更快解压） | ~47 MB             |
| Linux x64           | codex-app-server-x86_64-unknown-linux-musl.tar.gz     | ~待查              |

文档结束 · 如有更新请以最新对话内容为准
