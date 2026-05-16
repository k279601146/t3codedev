# codex app-server 多模型支持方案
## 用单一引擎二进制文件驱动 Claude、Gemini、GPT 全系列模型

> **文档版本**：1.2  
> **更新日期**：2025 年 5 月  
> **适用项目**：T3 Code IDE 客户端  
> **关联文档**：AGENTS.md · 商业化AI编程助手-最佳实践v3 · sub2api二次开发方案  
> **sub2api 本地仓库**：`D:\workspace\sub2api-fork`  
> **核心结论**：codex app-server 二进制文件本身已支持多模型，所有配置通过启动参数注入，不需要多个二进制文件

---

## 目录

1. [问题根因分析](#一问题根因分析)
2. [核心机制：codex 的 model_providers 体系](#二核心机制codex-的-model_providers-体系)
3. [关键约束：tool_call 兼容性](#三关键约束tool_call-兼容性)
4. [整体架构：sub2api 作为统一协议转换层](#四整体架构sub2api-作为统一协议转换层)
5. [实现方案：T3 Code 端的改造](#五实现方案t3-code-端的改造)
6. [sub2api 侧的配合](#六sub2api-侧的配合)
7. [模型切换的完整数据流](#七模型切换的完整数据流)
8. [前端模型选择器](#八前端模型选择器)
9. [测试验证](#九测试验证)
10. [开发优先级与工作量](#十开发优先级与工作量)

---

# 一、问题根因分析

## 当前状态

你目前的 T3 Code 使用「不同的 CLI 文件来达到使用不同模型的效果」，这意味着可能在做类似这样的事情：

```
引擎选择逻辑（伪代码）：
├── 用户选 GPT   → 启动 codex-app-server（可以用）
├── 用户选 Claude → 启动 claude-cli 二进制（另一个程序）
└── 用户选 Gemini → 启动 gemini-cli 二进制（又一个程序）
```

这个方案的问题：
- 三套二进制，三套进程生命周期管理，三套协议适配
- Claude CLI、Gemini CLI 的通信协议与 codex app-server 的 JSON-RPC 协议完全不同，在 apps/server 里需要分别适配
- 更新维护成本是三倍
- 用户体验不一致（不同引擎的响应格式、错误处理、重试行为都不同）

## 正确理解

codex app-server **本身就是一个模型无关的 agentic 执行引擎**。它使用的模型、连接的端点，全部通过**启动时注入的配置参数**决定。原厂文档明确支持 `model_providers` 自定义：

```toml
# 这就是 codex 的完整多模型支持机制
model = "claude-sonnet-4-5"
model_provider = "mygateway"

[model_providers.mygateway]
name = "My Gateway"
base_url = "https://api.yourservice.com/v1"
env_key = "MYIDE_API_KEY"      # 指向环境变量名，填 JWT
wire_api = "responses"          # 统一使用 Responses API；sub2api 后端会自动选择 /v1/responses 或 /v1/chat/completions
requires_openai_auth = true    # 不走 ChatGPT OAuth，直接用 API Key
```

**结论：一个 ai-engine 二进制 + 不同的启动参数 = 支持所有模型。**

---

# 二、核心机制：codex 的 model_providers 体系

## 2.1 官方支持的配置结构

codex 有两种内置 wire_api（通信协议）：

| wire_api | 说明 | 适用场景 |
|----------|------|---------|
| `"responses"` | OpenAI Responses API（`/v1/responses`，有状态） | **本项目统一使用此模式** |
| `"chat"` | OpenAI Chat Completions API（`/v1/chat/completions`，无状态） | 备用，不使用 |

**本项目策略：全部使用 `wire_api = "responses"`，`requires_openai_auth = true`。**

sub2api 原生支持 `/v1/responses` 端点，并且后端会自动根据上游能力选择实际使用 `/v1/responses` 还是 `/v1/chat/completions`。因此 codex 侧无需针对不同模型（OpenAI / Claude / Gemini）做任何区分配置，统一交给 sub2api 处理即可。

## 2.2 profile 机制：每个模型一个 profile

codex 的 profile 机制允许把「模型 + 提供商 + 其他配置」打包成一个命名集合，启动时用 `--profile` 选择：

```toml
# 理想的 config.toml 结构
# (在你的场景里，这个文件是动态生成并通过 --config 注入的，不是用户的 ~/.codex/config.toml)

# 公共提供商定义（所有 profile 共用）
[model_providers.mygateway]
name = "MyIDE Gateway"
base_url = "https://api.yourservice.com/v1"
env_key = "MYIDE_JWT"
wire_api = "responses"          # 统一使用 responses；sub2api 后端自动适配上游
requires_openai_auth = true

# GPT 系列 profile
[profiles.gpt-4o]
model = "gpt-4o"
model_provider = "mygateway"

[profiles.gpt-4o-mini]
model = "gpt-4o-mini"
model_provider = "mygateway"

# Claude 系列 profile
[profiles.claude-sonnet]
model = "claude-sonnet-4-5"
model_provider = "mygateway"

[profiles.claude-opus]
model = "claude-opus-4"
model_provider = "mygateway"

# Gemini 系列 profile
[profiles.gemini-pro]
model = "gemini-2.5-pro"
model_provider = "mygateway"

[profiles.gemini-flash]
model = "gemini-2.5-flash"
model_provider = "mygateway"
```

## 2.3 --no-load-config 与 --config 的配合

根据 AGENTS.md 的要求，你已经使用了 `--no-load-config`。这意味着你完全控制引擎的配置，可以动态生成任意配置。

```bash
# 实际的启动命令示例（Claude 模型）
ai-engine serve \
  --no-load-config \
  --config model="claude-sonnet-4-5" \
  --config model_provider="mygateway" \
  --config 'model_providers.mygateway.name="MyIDE Gateway"' \
  --config 'model_providers.mygateway.base_url="https://api.yourservice.com/v1"' \
  --config 'model_providers.mygateway.env_key="MYIDE_JWT"' \
  --config 'model_providers.mygateway.wire_api="responses"' \
  --config 'model_providers.mygateway.requires_openai_auth=true' \
  --config 'shell_environment_policy.include_only=["PATH","HOME","LANG","TERM"]' \
  --config 'windows.sandbox="unelevated"'
```

---

# 三、关键约束：tool_call 兼容性

这是多模型支持中**最容易踩坑的地方**。

## 3.1 为什么 tool_call 是核心问题

codex app-server 作为 agentic 引擎，其核心工作方式是：

```
codex 发出请求 → 模型返回 tool_call（调用文件读写/bash等工具）
              → codex 执行工具 → 返回结果给模型
              → 模型再次思考 → 再次调用工具或输出最终结果
```

整个 agent loop 依赖模型正确输出 `tool_calls` 字段（OpenAI Chat Completions 格式的 function calling）。**如果模型不支持 tool_call，或者返回格式不对，整个 agent 就无法工作**。

## 3.2 各模型的 tool_call 兼容性

| 模型 | tool_call 支持 | 通过 OpenAI 兼容接口的可用性 |
|------|--------------|--------------------------|
| GPT-4o / GPT-4o-mini | ✅ 原生支持 | ✅ 直接可用 |
| GPT-4.1 系列 | ✅ 原生支持 | ✅ 直接可用 |
| Claude Sonnet 4.5 | ✅ 原生支持 | ⚠️ 需要兼容层转换 Anthropic 格式 → OpenAI 格式 |
| Claude Opus 4 | ✅ 原生支持 | ⚠️ 需要兼容层转换 |
| Gemini 2.5 Pro | ✅ 原生支持 | ⚠️ 需要兼容层转换 Google 格式 → OpenAI 格式 |
| Gemini 2.5 Flash | ✅ 原生支持 | ⚠️ 需要兼容层转换 |

**结论**：Claude 和 Gemini 本身都支持 tool_call，但它们的 API 格式与 OpenAI 不同。你的 sub2api 网关需要承担**格式转换**的职责——将 codex 发出的 OpenAI Chat Completions 格式请求，转换为 Claude/Gemini 各自的 API 格式，并将响应转换回来。这正是 sub2api 已经在做的事情。

## 3.3 需要特别注意的格式差异

### Claude 的差异点

```json
// codex 发出的（OpenAI 格式）
{
  "model": "claude-sonnet-4-5",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "bash",
        "description": "Run a bash command",
        "parameters": { ... }
      }
    }
  ]
}

// 需要转换成的（Anthropic 格式）
{
  "model": "claude-sonnet-4-5-20251001",
  "messages": [...],
  "tools": [
    {
      "name": "bash",
      "description": "Run a bash command",
      "input_schema": { ... }    // ← 字段名不同！
    }
  ]
}
```

sub2api 对 Anthropic 的兼容层需要处理：
- `tools[].function.parameters` → `tools[].input_schema`
- `tool_calls` → `tool_use` 内容块
- `tool` 角色消息 → Anthropic 的 `tool_result` 格式

### Gemini 的差异点

```json
// codex 发出的（OpenAI 格式）
{
  "model": "gemini-2.5-pro",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "tools": [...]
}

// 需要转换成的（Google 格式）
{
  "model": "gemini-2.5-pro",
  "system_instruction": { "parts": [{ "text": "..." }] },  // ← system 消息分离
  "contents": [
    { "role": "user", "parts": [{ "text": "..." }] }
  ],
  "tools": [{ "functionDeclarations": [...] }]  // ← tools 格式不同
}
```

**关键结论**：这些格式转换的工作，sub2api 已经内置处理了（它就是做这个的）。你不需要在客户端或引擎层面处理这些差异——只需要确保 sub2api 正确配置了上游渠道。

---

# 四、整体架构：sub2api 作为统一协议转换层

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           T3 Code IDE 客户端                              │
│                                                                         │
│  ┌──────────────┐   JSON-RPC   ┌─────────────────────────────────────┐  │
│  │  apps/web    │◄────────────►│  apps/server (Node.js)              │  │
│  │  (React UI)  │             │                                     │  │
│  │              │             │  ┌─────────────────────────────┐    │  │
│  │  模型选择器   │             │  │  EngineManager              │    │  │
│  │  (用户选模型) │             │  │  根据用户选择的模型          │    │  │
│  └──────────────┘             │  │  动态生成 --config 参数      │    │  │
│                               │  │  启动 ai-engine              │    │  │
│                               │  └──────────┬──────────────────┘    │  │
│                               └─────────────┼───────────────────────┘  │
└─────────────────────────────────────────────┼───────────────────────────┘
                                              │
                                              │ 单一 ai-engine 二进制
                                              │ 携带不同的 --config 参数
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ai-engine (codex app-server 二进制)                                     │
│                                                                         │
│  根据启动参数决定：                                                       │
│  - model = "claude-sonnet-4-5"  (或 gemini-2.5-pro / gpt-4o)           │
│  - base_url = "https://api.yourservice.com/v1"                          │
│  - wire_api = "responses"  (统一使用 Responses API)                     │
│                                                                         │
│  发出的请求统一是 OpenAI Responses 格式（含 tool_calls）                  │
└─────────────────────────────────────────────┬───────────────────────────┘
                                              │ HTTPS
                                              │ POST /v1/responses
                                              │ Authorization: Bearer JWT
                                              │ model: "claude-sonnet-4-5"
                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  sub2api 网关                                                             │
│                                                                         │
│  1. 验证 JWT → 识别用户身份                                               │
│  2. 根据 model 字段路由到对应渠道                                          │
│     "claude-*"  → Anthropic 渠道（格式转换 Responses→Anthropic）        │
│     "gemini-*"  → Google 渠道（格式转换 Responses→Gemini）              │
│     "gpt-*"     → OpenAI 渠道（直接透传或自动降级为 chat）               │
│  3. 收到上游响应 → 转换回 Responses 格式 → 返回给 ai-engine              │
└─────────────────────────────────────────────┬───────────────────────────┘
                          ┌──────────────────┬┴────────────────┐
                          ▼                  ▼                  ▼
              ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
              │  你的 Claude 反代 │ │  你的 Gemini 反代 │ │  你的 OpenAI 反代 │
              │  (base_url+Key)  │ │  (base_url+Key)  │ │  (base_url+Key)  │
              └──────────────────┘ └──────────────────┘ └──────────────────┘
```

**这个架构的优点**：
- ai-engine 统一使用 `wire_api = "responses"`，无需针对模型做任何区分
- sub2api 后端自动判断上游能力，选择实际调用 `/v1/responses` 还是 `/v1/chat/completions`，对 codex 侧完全透明
- 新增模型只需要在 sub2api 管理后台加一个渠道，IDE 客户端和引擎无需任何改动

---

# 五、实现方案：T3 Code 端的改造

## 5.1 核心改造：EngineManager 支持模型参数

当前 EngineManager 启动 ai-engine 时，模型是硬编码或固定的。需要改造为接受 `modelId` 参数，动态生成配置：

```typescript
// apps/server/src/engine/engineManager.ts

interface EngineSessionOptions {
  projectPath: string;
  modelId: string;        // 用户选择的模型，如 "claude-sonnet-4-5"
  jwt: string;            // 用户的 JWT（作为 API Key）
  sessionId?: string;     // 可选，恢复历史会话
}

// sub2api /v1/models 返回的模型结构
// 注意：sub2api 只返回该 JWT（API Key）所属分组下已配置账号的平台对应模型
// 示例响应：{"data":[{"id":"gpt-5.4","type":"model","display_name":"gpt-5.4","created_at":"..."}],"object":"list"}
interface Sub2APIModel {
  id: string;           // 模型 ID，直接用于请求，如 "gpt-5.4"
  type: string;         // 固定为 "model"
  display_name: string; // 显示名称
  created_at: string;
}

// IDE 内部使用的模型描述（在 sub2api 返回的基础上补充 context_window 等信息）
interface ModelConfig {
  modelId: string;
  displayName: string;
  provider: 'openai' | 'anthropic' | 'google' | 'unknown';
  contextWindow: number;
}

// 根据模型 ID 前缀推断 provider 和 context_window
// sub2api 不返回这些信息，需要客户端自行推断（或由你在 sub2api 二次开发中扩展接口）
function inferModelMeta(modelId: string): Omit<ModelConfig, 'modelId' | 'displayName'> {
  if (modelId.startsWith('claude-')) {
    return { provider: 'anthropic', contextWindow: 200_000 };
  }
  if (modelId.startsWith('gemini-')) {
    return { provider: 'google', contextWindow: 1_000_000 };
  }
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    return { provider: 'openai', contextWindow: 128_000 };
  }
  return { provider: 'unknown', contextWindow: 128_000 };
}

// 运行时缓存，避免每次启动都重新请求
let cachedModels: ModelConfig[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

async function fetchAvailableModels(jwt: string, gatewayUrl: string): Promise<ModelConfig[]> {
  // 缓存命中，直接返回
  if (cachedModels && Date.now() < cacheExpiry) {
    return cachedModels;
  }

  const resp = await fetch(`${gatewayUrl}/models`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch models: ${resp.status}`);
  }

  const data: { data: Sub2APIModel[]; object: string } = await resp.json();

  cachedModels = data.data.map((m) => ({
    modelId: m.id,
    displayName: m.display_name || m.id,
    ...inferModelMeta(m.id),
  }));
  cacheExpiry = Date.now() + CACHE_TTL_MS;

  return cachedModels;
}

// 验证模型 ID 是否在可用列表中（启动引擎前校验）
async function isModelAvailable(modelId: string, jwt: string, gatewayUrl: string): Promise<boolean> {
  try {
    const models = await fetchAvailableModels(jwt, gatewayUrl);
    return models.some((m) => m.modelId === modelId);
  } catch {
    // 网络错误时，乐观放行（引擎启动后自然会报错）
    return true;
  }
}

class EngineManager {
  private readonly GATEWAY_URL = 'https://api.yourservice.com/v1';
  private readonly JWT_ENV_KEY = 'MYIDE_JWT'; // codex 从这个环境变量读取 JWT

  private buildEngineArgs(options: EngineSessionOptions, modelMeta: ModelConfig): string[] {
    const { modelId, sessionId } = options;

    // 基础配置参数
    const args: string[] = [
      'serve',
      '--no-load-config',
      // 核心模型配置
      '--config', `model="${modelId}"`,
      '--config', `model_provider="mygateway"`,
      // 自定义 provider 配置（所有模型都用同一个 mygateway，统一走 sub2api）
      '--config', `model_providers.mygateway.name="MyIDE Gateway"`,
      '--config', `model_providers.mygateway.base_url="${this.GATEWAY_URL}"`,
      '--config', `model_providers.mygateway.env_key="${this.JWT_ENV_KEY}"`,
      '--config', `model_providers.mygateway.wire_api="responses"`,
      // ↑ 统一使用 responses；sub2api 后端自动适配上游（/v1/responses 或 /v1/chat/completions）
      '--config', `model_providers.mygateway.requires_openai_auth=true`,
      // 安全配置
      '--config', `shell_environment_policy.include_only=["PATH","HOME","LANG","TERM"]`,
      '--config', `windows.sandbox="unelevated"`,
      '--config', `approval_policy="on-request"`,
    ];

    // 注入模型上下文窗口大小（避免 codex 使用错误的默认值）
    args.push('--config', `model_context_window=${modelMeta.contextWindow}`);

    // 如果是恢复历史会话
    if (sessionId) {
      args.push('--session', sessionId);
    }

    return args;
  }

  async startSession(options: EngineSessionOptions): Promise<SessionHandle> {
    const { projectPath, jwt, modelId } = options;

    // 从 sub2api 拉取模型列表，验证模型可用性并获取 meta 信息
    const models = await fetchAvailableModels(jwt, this.GATEWAY_URL);
    const modelMeta = models.find((m) => m.modelId === modelId);
    if (!modelMeta) {
      throw new Error(`Model "${modelId}" is not available for your account. Available: ${models.map(m => m.modelId).join(', ')}`);
    }

    const enginePath = engineUpdater.getActiveEnginePath();
    await ensureBinaryIntegrity(enginePath);

    const args = this.buildEngineArgs(options, modelMeta);

    const child = spawn(enginePath, args, {
      cwd: projectPath,
      env: {
        // 白名单环境变量
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        TERM: 'xterm-256color',
        // CODEX_HOME 隔离：每个用户一个独立目录
        CODEX_HOME: path.join(app.getPath('userData'), 'agent-data'),
        // JWT 作为 API Key（sub2api 凭此识别用户和分组）
        [this.JWT_ENV_KEY]: jwt,
        // 不传 OPENAI_API_KEY 和 OPENAI_BASE_URL！
        // 这些都通过 --config 参数注入，更安全
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new SessionHandle(child, options);
  }
}

export const engineManager = new EngineManager();
```

## 5.2 模型切换：无需重启引擎

用户在 UI 中切换模型时，有两种处理方式：

### 方式 A：当前会话结束后下一个会话使用新模型（简单，推荐）

```typescript
// apps/server/src/engine/sessionManager.ts

class SessionManager {
  private pendingModelId: string | null = null;

  // 用户选择新模型，记录下来
  setNextModel(modelId: string) {
    this.pendingModelId = modelId;
    // 通知前端
    notifyFrontend({ type: 'model:queued', modelId });
  }

  // 新建会话时使用 pendingModelId
  async createSession(projectPath: string, jwt: string): Promise<SessionHandle> {
    const modelId = this.pendingModelId ?? userPrefs.get('defaultModelId') ?? 'claude-sonnet-4-5';
    this.pendingModelId = null;

    return engineManager.startSession({ projectPath, modelId, jwt });
  }
}
```

### 方式 B：运行时通过 JSON-RPC 更新配置（高级，需验证 codex 是否支持）

```typescript
// 尝试向运行中的引擎发送配置更新
async function switchModelLive(newModelId: string, engineProcess: ChildProcess): Promise<boolean> {
  // 注意：这依赖 codex app-server 支持运行时配置更新
  // 如果不支持，会报错，需要回退到方式 A
  try {
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      method: 'config/update',
      params: { model: newModelId },
      id: nextId(),
    }) + '\n';
    engineProcess.stdin?.write(msg);
    return true;
  } catch {
    return false; // 降级到方式 A
  }
}
```

**推荐使用方式 A**，更稳定。在新建对话时启动新的引擎进程并传入新的模型参数。

## 5.3 IPC 接口扩展

在 `apps/server` 的 IPC handler 中增加模型相关接口：

```typescript
// apps/server/src/ipc/handlers.ts

// 获取可用模型列表
// 直接调用 sub2api 标准接口 GET /v1/models
// sub2api 根据 JWT 所属分组的平台配置，返回该分组下有效账号所支持的模型
ipcMain.handle('models:list', async (_event) => {
  const jwt = authStore.getJwt();
  if (!jwt) throw new Error('Not authenticated');

  try {
    const models = await fetchAvailableModels(jwt, GATEWAY_URL);
    return models;
  } catch (err) {
    logger.error('models:list failed', { error: err });
    throw new Error('无法获取模型列表，请检查网络连接');
  }
});

// 创建新会话（带模型选择）
ipcMain.handle('session:create', async (_event, { projectPath, modelId }: { projectPath: string; modelId: string }) => {
  // 路径安全校验
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
    throw new Error('Invalid projectPath');
  }
  const normalized = path.normalize(projectPath);
  if (normalized.includes('..')) throw new Error('Path traversal detected');

  // modelId 格式校验（防止注入 --config 参数）
  if (typeof modelId !== 'string' || !/^[\w.-]+$/.test(modelId)) {
    throw new Error('Invalid modelId format');
  }

  const jwt = authStore.getJwt();
  if (!jwt) throw new Error('Not authenticated');

  // 注意：模型可用性验证在 engineManager.startSession 内部完成
  // （内部会调用 fetchAvailableModels 对比列表）
  const session = await engineManager.startSession({
    projectPath: normalized,
    modelId,
    jwt,
  });

  // 持久化用户的模型选择
  userPrefs.set('lastUsedModelId', modelId);

  return { sessionId: session.id, modelId };
});

// 获取用户上次使用的模型（用于默认选中）
ipcMain.handle('models:getLastUsed', async (_event) => {
  const saved = userPrefs.get('lastUsedModelId') as string | undefined;

  // 验证保存的模型是否仍然可用（分组/账号状态可能已变化）
  if (saved) {
    const jwt = authStore.getJwt();
    if (jwt) {
      const available = await isModelAvailable(saved, jwt, GATEWAY_URL);
      if (available) return saved;
    }
  }

  // 降级：返回第一个可用模型
  const jwt = authStore.getJwt();
  if (jwt) {
    try {
      const models = await fetchAvailableModels(jwt, GATEWAY_URL);
      return models[0]?.modelId ?? null;
    } catch { /* 忽略 */ }
  }
  return null;
});
```

---

# 六、sub2api 侧的配合

> **本地仓库路径**：`D:\workspace\sub2api-fork`  
> AI 编程助手在修改 sub2api 相关代码时，请在此目录下进行操作。

sub2api 需要正确配置各模型的上游渠道，并处理格式转换。这部分主要是**管理员在后台配置**，不需要二次开发（sub2api 已内置）：

## 6.1 渠道配置（管理后台操作）

在 sub2api 管理后台，为每个模型系列配置渠道：

```yaml
# sub2api 的渠道配置示意（实际在管理后台 UI 中操作）

# 渠道 1：Claude 系列（Anthropic 格式）
channel_anthropic:
  name: "我的 Claude 反代"
  type: anthropic              # sub2api 会自动处理 OpenAI→Anthropic 格式转换
  base_url: "https://your-claude-proxy.com"
  api_key: "${CLAUDE_API_KEY}"
  models:
    - claude-sonnet-4-5
    - claude-sonnet-4-5-20251001  # model 别名映射
    - claude-opus-4
    - claude-haiku-4-5

# 渠道 2：Gemini 系列（Google 格式）
channel_gemini:
  name: "我的 Gemini 反代"
  type: gemini                 # sub2api 会自动处理 OpenAI→Gemini 格式转换
  base_url: "https://your-gemini-proxy.com"
  api_key: "${GEMINI_API_KEY}"
  models:
    - gemini-2.5-pro
    - gemini-2.5-flash
    - gemini-2.0-flash

# 渠道 3：OpenAI 系列（直接透传）
channel_openai:
  name: "我的 OpenAI 反代"
  type: openai                 # 直接透传，无需格式转换
  base_url: "https://your-openai-proxy.com"
  api_key: "${OPENAI_API_KEY}"
  models:
    - gpt-4o
    - gpt-4o-mini
    - gpt-4.1
```

## 6.2 模型名称映射（重要！）

codex 发出的模型名（如 `claude-sonnet-4-5`）可能与上游期望的模型名（如 `claude-sonnet-4-5-20251001`）不同。在 sub2api 的渠道配置中设置模型映射：

```
# 在 sub2api 管理后台的渠道设置中：
claude-sonnet-4-5  →  claude-sonnet-4-5-20251001   (Anthropic 实际 API 需要带日期)
claude-opus-4      →  claude-opus-4-20250514
gemini-2.5-pro     →  gemini-2.5-pro-preview-05-06  (Google 的实验模型 ID)
```

## 6.3 验证 sub2api 格式转换是否正常

在配置好渠道后，用以下 curl 命令直接测试 sub2api 的转换是否正常（**不通过 IDE，直接测接口**）：

```bash
# 测试 Claude 的 tool_call 是否正常转换
curl -X POST https://api.yourservice.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [
      { "role": "user", "content": "列出当前目录的文件" }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "bash",
          "description": "执行 bash 命令",
          "parameters": {
            "type": "object",
            "properties": {
              "command": { "type": "string" }
            },
            "required": ["command"]
          }
        }
      }
    ],
    "stream": true
  }'

# 正常响应应该包含 tool_calls 字段，类似：
# data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"bash","arguments":"{\"command\":\"ls -la\"}"}}]}}]}
```

如果响应中出现 `tool_calls`，说明格式转换正常，ai-engine 可以正常使用。

---

# 七、模型切换的完整数据流

以用户从「GPT-4o」切换到「Claude Sonnet 4.5」为例：

```
用户操作: 点击模型选择器 → 选择 "Claude Sonnet 4.5"
    │
    ▼
apps/web (React)
    发送 IPC: session:create
    { projectPath: "/workspace/my-app", modelId: "claude-sonnet-4-5" }
    │
    ▼
apps/server (Node.js)
    ipcMain.handle('session:create') 被触发
    从 authStore 取出 JWT
    调用 engineManager.startSession()
    │
    ▼
EngineManager.buildEngineArgs()
    生成启动参数:
    [
      "serve", "--no-load-config",
      "--config", "model=\"claude-sonnet-4-5\"",
      "--config", "model_provider=\"mygateway\"",
      "--config", "model_providers.mygateway.base_url=\"https://api.yourservice.com/v1\"",
      "--config", "model_providers.mygateway.env_key=\"MYIDE_JWT\"",
      "--config", "model_providers.mygateway.wire_api=\"responses\"",
      "--config", "model_providers.mygateway.requires_openai_auth=false",
      "--config", "model_context_window=200000",
      ...
    ]
    │
    ▼
spawn(ai-engine, args, { env: { MYIDE_JWT: "eyJhbGc...", PATH: ..., ... } })
    │
    ▼
ai-engine 启动
    读取 --config 参数，配置:
    - model: claude-sonnet-4-5
    - provider: mygateway（base_url=https://api.yourservice.com/v1）
    - 从环境变量 MYIDE_JWT 读取 JWT 作为 API Key
    │
    ▼
用户在 UI 发送消息: "帮我重构这个函数"
    │
    ▼
ai-engine 构造 Responses 请求:
    POST https://api.yourservice.com/v1/responses
    Authorization: Bearer eyJhbGc...（JWT）
    {
      "model": "claude-sonnet-4-5",
      "input": [...],
      "tools": [{ "type": "function", "function": { "name": "bash", ... } }],
      "stream": true
    }
    │
    ▼
sub2api 接收请求
    1. 验证 JWT → 用户 ID: user_123，套餐: pro ✓
    2. 检查配额 → 未超出 ✓
    3. 识别模型 "claude-sonnet-4-5" → 路由到 Anthropic 渠道
    4. 格式转换（Responses → Anthropic Messages API）
    5. 替换 Authorization 为真实 Anthropic API Key
    6. 转发到你的 Claude 反代服务
    │
    ▼
Claude 反代服务 → Anthropic API
    返回流式响应（Anthropic 格式）
    │
    ▼
sub2api 接收响应
    格式转换（Anthropic → OpenAI Responses 格式）
    返回给 ai-engine（流式）
    │
    ▼
ai-engine 处理 tool_call
    解析响应，发现 Claude 想执行 bash 命令
    执行工具，返回结果给 Claude
    Claude 再次思考...最终输出结果
    │
    ▼
apps/web 收到流式响应，渲染给用户
```

---

# 八、前端模型选择器

## 8.1 模型选择器组件

```typescript
// apps/web/src/components/ModelSelector.tsx

import { useState, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';

interface ModelInfo {
  id: string;
  display_name: string;
  provider: string;
  context_window: number;
  is_default: boolean;
}

interface ModelGroup {
  provider: string;
  label: string;
  models: ModelInfo[];
}

export function ModelSelector() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentModelId, setCurrentModel } = useSessionStore();

  useEffect(() => {
    // 从后端拉取用户有权限使用的模型列表
    window.myideAPI.models.list().then((list) => {
      setModels(list);
      setLoading(false);
    });
  }, []);

  // 按 provider 分组显示
  const groups: ModelGroup[] = [
    {
      provider: 'anthropic',
      label: 'Claude',
      models: models.filter(m => m.provider === 'anthropic'),
    },
    {
      provider: 'openai',
      label: 'GPT',
      models: models.filter(m => m.provider === 'openai'),
    },
    {
      provider: 'google',
      label: 'Gemini',
      models: models.filter(m => m.provider === 'google'),
    },
  ].filter(g => g.models.length > 0);

  if (loading) {
    return <div className="model-selector loading">加载模型列表...</div>;
  }

  return (
    <div className="model-selector">
      <select
        value={currentModelId}
        onChange={(e) => setCurrentModel(e.target.value)}
        className="model-select"
        title="选择 AI 模型"
      >
        {groups.map(group => (
          <optgroup key={group.provider} label={group.label}>
            {group.models.map(model => (
              <option key={model.id} value={model.id}>
                {model.display_name}
                {model.context_window >= 200_000 ? ' (200K)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
```

## 8.2 新建对话时携带模型参数

```typescript
// apps/web/src/stores/sessionStore.ts
import { create } from 'zustand';

interface SessionStore {
  currentModelId: string;
  setCurrentModel: (modelId: string) => void;
  createSession: (projectPath: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  currentModelId: 'claude-sonnet-4-5', // 默认模型

  setCurrentModel: (modelId: string) => {
    set({ currentModelId: modelId });
    // 持久化选择
    window.myideAPI.models.setDefault(modelId);
  },

  createSession: async (projectPath: string) => {
    const { currentModelId } = get();
    // 创建会话时携带用户选择的模型
    await window.myideAPI.session.create({ projectPath, modelId: currentModelId });
  },
}));
```

## 8.3 用量展示（配合模型显示）

不同模型消耗的 token 成本不同，在 UI 中展示当前模型的用量更有意义：

```typescript
// apps/web/src/components/UsageBar.tsx

export function UsageBar() {
  const { currentModelId } = useSessionStore();
  const { data: usage } = useQuery({
    queryKey: ['usage'],
    queryFn: () => window.myideAPI.auth.getUsage(),
    refetchInterval: 30_000,
  });

  if (!usage) return null;

  const percentage = usage.tokens.percentage;
  const isNearLimit = percentage !== null && percentage > 80;

  return (
    <div className={`usage-bar ${isNearLimit ? 'near-limit' : ''}`}>
      <span className="model-badge">{currentModelId}</span>
      {percentage !== null ? (
        <span className="usage-text">
          {usage.tokens.total.toLocaleString()} / {usage.tokens.limit.toLocaleString()} tokens
          ({percentage.toFixed(1)}%)
        </span>
      ) : (
        <span className="usage-text">
          {usage.tokens.total.toLocaleString()} tokens (无限制)
        </span>
      )}
    </div>
  );
}
```

---

# 九、测试验证

## 9.1 验证清单

在实现完成后，按以下顺序逐一验证：

### 阶段 1：sub2api 格式转换验证（不涉及 IDE）

```bash
# 1.1 验证 Claude tool_call 转换
curl -X POST https://api.yourservice.com/v1/chat/completions \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "model": "claude-sonnet-4-5", "messages": [{"role":"user","content":"hello"}], "tools": [{"type":"function","function":{"name":"bash","parameters":{"type":"object","properties":{"cmd":{"type":"string"}}}}}] }' \
  | jq '.choices[0].message'
# 期望：包含 tool_calls 字段

# 1.2 验证 Gemini tool_call 转换
curl -X POST https://api.yourservice.com/v1/chat/completions \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "model": "gemini-2.5-flash", "messages": [{"role":"user","content":"hello"}], "tools": [{"type":"function","function":{"name":"bash","parameters":{"type":"object","properties":{"cmd":{"type":"string"}}}}}] }' \
  | jq '.choices[0].message'
# 期望：包含 tool_calls 字段

# 1.3 验证流式响应
curl -N -X POST https://api.yourservice.com/v1/chat/completions \
  -H "Authorization: Bearer $TEST_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "model": "claude-sonnet-4-5", "messages": [{"role":"user","content":"say hi"}], "stream": true }'
# 期望：返回 data: {...} 格式的 SSE 流
```

### 阶段 2：ai-engine 直接启动验证

```bash
# 2.1 用 Claude 模型直接启动 ai-engine（命令行测试，不通过 IDE）
MYIDE_JWT="your-jwt-here" \
./ai-engine exec \
  --no-load-config \
  -c 'model="claude-sonnet-4-5"' \
  -c 'model_provider="mygateway"' \
  -c 'model_providers.mygateway.base_url="https://api.yourservice.com/v1"' \
  -c 'model_providers.mygateway.env_key="MYIDE_JWT"' \
  -c 'model_providers.mygateway.wire_api="responses"' \
  -c 'model_providers.mygateway.requires_openai_auth=true' \
  "列出当前目录下的所有 .ts 文件"
# 期望：ai-engine 调用 bash tool 执行 find 命令，返回结果

# 2.2 用 Gemini 模型重复上述测试
MYIDE_JWT="your-jwt-here" \
./ai-engine exec \
  --no-load-config \
  -c 'model="gemini-2.5-flash"' \
  -c 'model_provider="mygateway"' \
  ... (其他参数同上) \
  "列出当前目录下的所有 .ts 文件"
```

### 阶段 3：IDE 集成验证

```
□ 打开 IDE，登录
□ 模型选择器显示所有可用模型（按 Claude / GPT / Gemini 分组）
□ 选择 Claude Sonnet 4.5，新建对话，发送简单请求 → 收到正确响应
□ 结束会话，选择 GPT-4o，新建对话 → 收到正确响应
□ 结束会话，选择 Gemini 2.5 Flash，新建对话 → 收到正确响应
□ 每次切换模型后，会话标题/状态栏显示正确的模型名
□ 用量统计正确增加（不同模型的 token 消耗都被记录）
□ 套餐限制正确生效（如免费用户不能使用 Claude Opus）
```

## 9.2 常见问题排查

| 现象 | 可能原因 | 排查方向 |
|------|---------|---------|
| Claude 响应正常但没有 tool_call | sub2api 的 Anthropic 格式转换有问题 | 直接用 curl 测试 sub2api 接口，检查 `choices[0].message.tool_calls` |
| Gemini 返回 400 错误 | 模型名不对，或 sub2api 的 Gemini 渠道未配置 | 检查 sub2api 管理后台，确认 gemini 渠道存在且模型名映射正确 |
| ai-engine 启动后立即退出 | --config 参数格式错误，或 JWT 读取失败 | 检查环境变量 MYIDE_JWT 是否传入，检查 --config 引号是否正确 |
| 模型选择器为空 | sub2api 的 /ide/api/plan 接口报错 | 检查 JWT 是否有效，检查 sub2api 的套餐配置 |
| 切换模型后还是用旧模型 | 会话没有重新创建，还在复用旧的 ai-engine 进程 | 确认切换模型后触发了新会话创建而不是复用旧进程 |

---

# 十、开发优先级与工作量

## 工作量估算

| 任务 | 位置 | 预计工时 | 说明 |
|------|------|---------|------|
| EngineManager 增加 modelId 参数 | apps/server | 0.5天 | 主要是重构现有的 spawn 调用 |
| buildEngineArgs() 函数实现 | apps/server | 0.5天 | 生成多模型 --config 参数 |
| IPC 接口扩展（models:list / session:create） | apps/server | 0.5天 | 新增 handler |
| preload.ts 暴露新接口 | apps/desktop | 0.5天 | 白名单更新 |
| 前端模型选择器组件 | apps/web | 1天 | 含分组、持久化、用量显示 |
| sub2api 管理后台配置各渠道 | sub2api 后台 | 0.5天 | 纯配置操作，无代码 |
| 验证测试（三套模型全部验证） | 全栈 | 1天 | 按验证清单逐项测试 |
| **合计** | | **约 5 个工作日** | |

## 实施顺序

```
Day 1 上午：sub2api 管理后台配置 Claude + Gemini 渠道
             用 curl 验证 tool_call 格式转换正常

Day 1 下午：EngineManager 重构，实现 buildEngineArgs()
             用命令行直接启动 ai-engine 验证 Claude 模型可用

Day 2 上午：Gemini 模型命令行验证
             IPC 接口扩展

Day 2 下午：preload.ts 更新
             前端模型选择器基础版（含 select，不含复杂 UI）

Day 3 全天：集成测试（按验证清单）
             修复发现的问题
             模型选择器 UI 完善（分组、用量显示）
```

---

## 附录：codex model_providers 完整配置参考

```toml
# 通过 --config 参数注入（不写入文件）的等效 TOML 结构
# 供参考，实际使用时每行转成 --config key=value 格式

model = "claude-sonnet-4-5"           # 当前使用的模型
model_provider = "mygateway"          # 使用哪个 provider 定义
model_context_window = 200000         # 模型上下文窗口（手动指定，避免 codex 猜测错误）

[model_providers.mygateway]
name = "MyIDE Gateway"                         # 显示名称（调试用）
base_url = "https://api.yourservice.com/v1"    # sub2api 的地址
env_key = "MYIDE_JWT"                          # 从哪个环境变量读取 API Key
wire_api = "responses"                         # 统一使用 Responses API；sub2api 后端自动适配上游
requires_openai_auth = true                   # 不需要 ChatGPT OAuth

[shell_environment_policy]
include_only = ["PATH", "HOME", "LANG", "TERM"]  # 白名单，防止 shell 读到敏感变量

[windows]
sandbox = "unelevated"                         # Windows 沙箱策略

# approval_policy = "on-request"               # 执行 shell 命令前询问用户
```

---

*本文档覆盖了从原理到实现的完整路径。核心要点：一个 ai-engine 二进制，通过 `--config` 动态注入模型参数，sub2api 承担所有协议转换。整个改动约 5 个工作日可完成。*
