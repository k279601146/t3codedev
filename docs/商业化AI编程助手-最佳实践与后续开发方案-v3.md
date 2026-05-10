# 商业化 AI 编程助手 IDE 客户端
## 最佳实践 · 后续开发方案

> **适用阶段**：已完成 codex-app-server 捆绑集成的基础版本，进入商业化迭代阶段  
> **文档版本**：3.0  
> **更新日期**：2025 年 5 月  
> **技术栈参考**：[openai/codex app-server](https://github.com/openai/codex) · [pingdotgg/t3code](https://github.com/pingdotgg/t3code) · [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)

---

## 目录

1. [商业化集成最佳实践](#一商业化集成最佳实践)
   - 1.1 [安全架构：客户端永远不持有 AI 密钥](#11-安全架构客户端永远不持有-ai-密钥)
   - 1.2 [性能优化](#12-性能优化)
   - 1.3 [稳定性与容错](#13-稳定性与容错)
   - 1.4 [合规与隐私](#14-合规与隐私)
   - 1.5 [可观测性](#15-可观测性)
2. [后续开发任务与方案](#二后续开发任务与方案)
   - Task 1：[多模型支持与模型路由（依托 sub2api）](#task-1多模型支持与模型路由依托-sub2api)
   - Task 2：[计费与订阅系统（直接使用 sub2api）](#task-2计费与订阅系统直接使用-sub2api)
   - Task 3：[工作区与项目管理（t3code 已具备）](#task-3工作区与项目管理t3code-已具备)
   - Task 4：[对话历史与持久化（t3code 已具备）](#task-4对话历史与持久化t3code-已具备)
   - Task 5：[沙箱安全升级](#task-5沙箱安全升级)
   - Task 6：[自动更新机制（应用 + 引擎独立更新）](#task-6自动更新机制应用--引擎独立更新)
   - Task 7：[性能监控与 APM](#task-7性能监控与-apm)
   - Task 8：[移动端 / Web 端延伸](#task-8移动端--web-端延伸)

---

# 一、商业化集成最佳实践

## 1.1 安全架构：客户端永远不持有 AI 密钥

### ❗ 核心问题澄清

原方案中 `base_url = "http://127.0.0.1:8317/v1"` 和 `env_key = "MYIDE_API_KEY"` 硬编码在客户端中，**这个设计本身是错误的**，会带来以下严重问题：

1. **base_url 泄露**：即使是内网 URL，攻击者抓包即可拿到你的反代服务地址，进而尝试绕过认证直接访问。
2. **API Key 泄露**：如果客户端持有真实的 AI 服务 API Key（不论是厂商 Key 还是你的反代 Key），攻击者通过抓包、内存 dump、反编译都可以拿走，之后可以无限消耗你的配额。
3. **抓包有多容易**：Charles、Proxyman、Fiddler 都可以在 5 分钟内完成对 Electron 应用的 HTTPS 抓包，mitmproxy 甚至可以自动化。真实的 AI 编程助手用户群里有大量开发者，他们完全有能力这样做。

### ✅ 市面上主流方案：JWT 即访问凭证

Cursor、Windsurf、GitHub Copilot 等主流 AI 编程助手的共同做法是：

```
客户端                      你的后端网关                    AI 提供方
  │                              │                              │
  │  ① 用户登录，获取 JWT         │                              │
  │◄─────────────────────────────│                              │
  │                              │                              │
  │  ② 携带 JWT 请求 AI           │                              │
  │  POST /v1/chat/completions   │                              │
  │  Authorization: Bearer JWT   │                              │
  │─────────────────────────────►│                              │
  │                              │  ③ 验证 JWT，替换为真实 Key   │
  │                              │  Authorization: Bearer REAL_KEY
  │                              │─────────────────────────────►│
  │                              │                              │
  │  ④ 流式响应透传               │◄─────────────────────────────│
  │◄─────────────────────────────│                              │
```

**客户端只知道：**
- 你的网关地址（`https://api.yourservice.com`，这是正常的）
- 用户自己的 JWT（从登录接口获取，有有效期）

**客户端永远不知道：**
- 真实 AI 服务的 base_url
- 真实的 API Key（无论是你的 Key 还是上游的 Key）

用户就算抓包，只能看到：
```http
POST https://api.yourservice.com/v1/chat/completions
Authorization: Bearer eyJhbGc...（JWT，只属于他自己的账号）
```

JWT 过期或账号被封，对应的访问权限立即失效，不会影响其他用户。

### 🔐 整体架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                   你的系统全貌                                │
│                                                             │
│  ┌───────────────┐     JWT      ┌──────────────────────┐   │
│  │  IDE 客户端    │◄────────────►│   你的业务后端        │   │
│  │  (Electron)   │             │   (认证 / 用户管理)   │   │
│  │               │             └──────────┬───────────┘   │
│  │  只存：JWT     │                        │               │
│  │  不存：API Key │             ┌──────────▼───────────┐   │
│  │  不存：base_url│             │   sub2api（网关层）   │   │
│  └───────────────┘             │   多用户 / 多模型     │   │
│                                │   计费 / 配额管理     │   │
│                                └──────────┬───────────┘   │
│                                           │               │
│                                ┌──────────▼───────────┐   │
│                                │  第三方反代服务        │   │
│                                │  (你购买的 base_url   │   │
│                                │   + API Key)          │   │
│                                └──────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**各层职责：**

| 层 | 持有什么 | 暴露给谁 |
|---|---|---|
| IDE 客户端 | JWT（用户登录凭证） | 用户自己可见，正常 |
| 你的业务后端 | 用户数据、JWT 签发密钥 | 不对外暴露 |
| sub2api 网关 | 各模型的真实 Key + 反代 URL | 仅服务端持有，绝不下发 |
| 第三方反代服务 | 原始 API Key | 仅 sub2api 持有 |

### 🔐 客户端：只存 JWT，按需透传

```typescript
// apps/desktop/src/auth/authStore.ts

class AuthStore {
  // JWT 仅存内存，退出即清除
  // 如需持久登录，可用 Electron safeStorage 加密后写入磁盘
  private jwt: string | null = null;

  setJwt(token: string) {
    this.jwt = token;
    // 可选：持久化（加密存储，非明文）
    safeStorage.isEncryptionAvailable()
      && app.getPath('userData')
      && require('fs').writeFileSync(
          path.join(app.getPath('userData'), 'session.enc'),
          safeStorage.encryptString(token)
        );
  }

  getJwt(): string | null {
    return this.jwt;
  }

  clear() {
    this.jwt = null;
    // 清除持久化文件
    const encPath = path.join(app.getPath('userData'), 'session.enc');
    if (require('fs').existsSync(encPath)) require('fs').unlinkSync(encPath);
  }
}

export const authStore = new AuthStore();
```

```typescript
// 客户端发起 AI 请求时，只用 JWT
function buildAIRequestHeaders(): Record<string, string> {
  const jwt = authStore.getJwt();
  if (!jwt) throw new Error('Not authenticated');

  return {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  };
}

// codex-app-server 启动参数：base_url 指向你的网关，Key 就是 JWT
const child = spawn(enginePath, args, {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TERM: 'xterm-256color',
    // base_url 指向你的网关（公开的，不是秘密）
    OPENAI_BASE_URL: 'https://api.yourservice.com/v1',
    // API Key 就是 JWT，用户自己的登录凭证
    OPENAI_API_KEY: authStore.getJwt(),
  }
});
```

### 🔐 网关层：验证 JWT，替换为真实 Key

```typescript
// 后端网关中间件（Hono 示例）
// 这里是 sub2api 内部已经实现的逻辑，你只需要配置

app.use('/v1/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // 1. 验证 JWT（sub2api 内置）
  const jwt = authHeader.slice(7);
  const payload = await verifyJwt(jwt, JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);

  // 2. 检查账户状态与配额（sub2api 内置）
  const user = await db.getUserById(payload.sub);
  if (user.status !== 'active') return c.json({ error: 'Account suspended' }, 403);
  if (await isQuotaExceeded(user.id)) return c.json({ error: 'Quota exceeded' }, 429);

  // 3. 将请求转发给上游时，替换为真实的 API Key
  // 客户端发来的是 JWT，网关转发时换成真实 Key
  // 整个替换过程在服务端完成，客户端永远看不到真实 Key
  c.set('userId', user.id);
  c.set('upstreamKey', process.env.UPSTREAM_API_KEY); // 真实 Key 只存服务端环境变量
  c.set('upstreamBaseUrl', process.env.UPSTREAM_BASE_URL); // 你购买的反代地址
  await next();
});
```

### 🔐 进程隔离与最小权限

```typescript
// ❌ 错误做法 — 所有环境变量泄漏给子进程
const child = spawn(enginePath, args, {
  env: { ...process.env }
});

// ✅ 正确做法 — 最小化白名单
const child = spawn(enginePath, args, {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TERM: 'xterm-256color',
    OPENAI_BASE_URL: 'https://api.yourservice.com/v1',
    OPENAI_API_KEY: authStore.getJwt(), // JWT，不是真实 Key
  }
});
```

```typescript
// 同时配置 shell_environment_policy，防止 AI 执行的 shell 命令读到任何 Key
'--config', `shell_environment_policy.include_only=["PATH","HOME","LANG","TERM"]`,
```

### 🔐 二进制完整性校验

防止捆绑的二进制被篡改（供应链攻击）：

```typescript
// apps/desktop/src/security/integrityCheck.ts
import crypto from 'node:crypto';
import fs from 'node:fs';

interface BinaryManifest {
  version: string;
  binaries: Record<string, string>; // filename -> sha256
}

export async function verifyBinaryIntegrity(
  binaryPath: string,
  expectedHash: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(binaryPath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex') === expectedHash));
    stream.on('error', reject);
  });
}

export async function ensureBinaryIntegrity(enginePath: string) {
  const manifest: BinaryManifest = JSON.parse(
    fs.readFileSync(path.join(process.resourcesPath, 'manifest.json'), 'utf-8')
  );
  const binaryName = path.basename(enginePath);
  const expectedHash = manifest.binaries[binaryName];
  if (!expectedHash) throw new Error(`No hash found for ${binaryName}`);
  const valid = await verifyBinaryIntegrity(enginePath, expectedHash);
  if (!valid) throw new Error(`Binary integrity check failed for ${binaryName}.`);
}
```

### 🔐 IPC 通信安全

```typescript
// preload.ts — 只暴露白名单 API
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('myideAPI', {
  auth: {
    login: (credentials: LoginCredentials) =>
      ipcRenderer.invoke('auth:login', credentials),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getUsage: () => ipcRenderer.invoke('auth:getUsage'),
  },
  engine: {
    startSession: (projectPath: string) =>
      ipcRenderer.invoke('engine:startSession', projectPath),
    stopSession: (sessionId: string) =>
      ipcRenderer.invoke('engine:stopSession', sessionId),
  },
});

// main.ts — 输入参数严格验证
ipcMain.handle('engine:startSession', (_event, projectPath: unknown) => {
  if (typeof projectPath !== 'string') throw new Error('Invalid projectPath');
  if (!path.isAbsolute(projectPath)) throw new Error('Path must be absolute');
  const normalized = path.normalize(projectPath);
  if (normalized.includes('..')) throw new Error('Path traversal detected');
  return engineManager.startSession(normalized);
});
```

---

## 1.2 性能优化

### ⚡ 引擎进程预热（Warm Start）

用户点击"开始对话"时才 spawn app-server，冷启动需要 1-3 秒。应用登录完成后在后台提前预热一个待机进程：

```typescript
// apps/server/src/engine/enginePool.ts

class EnginePool {
  private standbyProcess: ChildProcess | null = null;
  private isWarming = false;

  async warmUp() {
    if (this.standbyProcess || this.isWarming) return;
    this.isWarming = true;
    try {
      this.standbyProcess = await this.spawnEngine();
      console.log('[Engine] Warm standby process ready');
    } finally {
      this.isWarming = false;
    }
  }

  acquire(): ChildProcess {
    const proc = this.standbyProcess;
    this.standbyProcess = null;
    this.warmUp(); // 立即再预热一个备用
    return proc ?? this.spawnEngine(); // fallback 冷启动
  }

  private spawnEngine(): ChildProcess {
    return spawn(engineUpdater.getActiveEnginePath(), ['serve'], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OPENAI_BASE_URL: 'https://api.yourservice.com/v1',
        OPENAI_API_KEY: authStore.getJwt(),
      }
    });
  }
}

export const enginePool = new EnginePool();
authStore.on('login', () => enginePool.warmUp());
```

### ⚡ 流式响应的背压控制

大量 JSON-RPC Item 事件涌入时，前端渲染慢会导致内存暴涨：

```typescript
class BackpressureController {
  private buffer: string[] = [];
  private readonly maxBufferSize = 500;
  private isPaused = false;

  onData(chunk: string, engineProcess: ChildProcess) {
    if (this.buffer.length >= this.maxBufferSize && !this.isPaused) {
      engineProcess.stdout?.pause();
      this.isPaused = true;
    }
    this.buffer.push(chunk);
  }

  drain(engineProcess: ChildProcess): string[] {
    const batch = this.buffer.splice(0, 50);
    if (this.isPaused && this.buffer.length < this.maxBufferSize / 2) {
      engineProcess.stdout?.resume();
      this.isPaused = false;
    }
    return batch;
  }
}
```

### ⚡ 大文件代码的分片处理

向 AI 发送大型代码文件时，直接全量发送会超出 context window 并增加 Token 消耗：

```typescript
class ContextBuilder {
  private readonly MAX_TOKENS = 80_000;

  async buildContext(projectPath: string, userQuery: string, focusedFile?: string) {
    const candidates = await this.gatherCandidateFiles(projectPath, focusedFile);
    const scored = await this.scoreRelevance(candidates, userQuery);
    const selected: FileChunk[] = [];
    let totalTokens = 0;

    for (const chunk of scored.sort((a, b) => b.relevanceScore - a.relevanceScore)) {
      const chunkTokens = Math.ceil(chunk.content.length / 3.5);
      if (totalTokens + chunkTokens > this.MAX_TOKENS) break;
      selected.push(chunk);
      totalTokens += chunkTokens;
    }
    return selected;
  }
}
```

---

## 1.3 稳定性与容错

### 🛡️ 引擎进程崩溃自动恢复

```typescript
class EngineManager {
  private restartCount = 0;
  private readonly MAX_RESTARTS = 5;
  private readonly RESTART_WINDOW_MS = 60_000;

  private attachCrashHandler() {
    this.process?.on('exit', (code) => {
      if (code === 0) return;
      this.restartCount++;
      const delay = Math.min(1000 * Math.pow(2, this.restartCount), 30_000);
      if (this.restartCount >= this.MAX_RESTARTS) {
        this.notifyFrontend({ type: 'engine:fatal', message: '引擎反复崩溃，请重启应用' });
        return;
      }
      setTimeout(() => this.start(), delay);
    });
  }
}
```

### 🛡️ 网络请求超时与重试

```typescript
async function resilientFetch(
  url: string,
  options: RequestInit,
  retryOpts = { maxRetries: 3, timeoutMs: 30_000, retryOn: [429, 502, 503, 504] }
): Promise<Response> {
  for (let attempt = 0; attempt <= retryOpts.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), retryOpts.timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (retryOpts.retryOn.includes(resp.status) && attempt < retryOpts.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 16_000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return resp;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === retryOpts.maxRetries) throw err;
      await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 16_000)));
    }
  }
  throw new Error('Request failed after all retries');
}
```

### 🛡️ 优雅关闭

```typescript
export function setupGracefulShutdown() {
  app.on('before-quit', async (event) => {
    event.preventDefault();
    engineManager.setAcceptingNewSessions(false);
    await engineManager.waitForActiveSessions(10_000);
    engineManager.stopAll();
    authStore.clear(); // 清除内存中的 JWT
    await db.close();
    app.quit();
  });
}
```

---

## 1.4 合规与隐私

### 📋 代码隐私保护

```typescript
// 在网关里只记录 metadata，永远不记录代码内容
interface RequestLog {
  userId: string;
  sessionId: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  // ❌ 不记录 messages 内容
  // ❌ 不记录文件路径
}
```

### 📋 GDPR / 数据删除

```typescript
app.delete('/api/account', authenticate, async (c) => {
  const userId = c.get('userId');
  await db.revokeAllApiKeys(userId);
  await db.deleteUsageRecords(userId);
  await db.deleteUser(userId);
  await redis.del(`user:${userId}`);
  await auditLog.record({ action: 'account_deleted', userId, timestamp: new Date() });
  return c.json({ success: true });
});
```

### 📋 遥测与用户同意

```typescript
interface TelemetryConsent {
  crashReporting: boolean;
  usageAnalytics: boolean;
  improveProduct: boolean;
}

function shouldSendTelemetry(type: keyof TelemetryConsent): boolean {
  const consent = store.get('telemetryConsent') as TelemetryConsent | null;
  return consent?.[type] ?? false;
}
```

---

## 1.5 可观测性

### 📊 结构化日志

```typescript
import { createLogger, format, transports } from 'winston';

export const logger = createLogger({
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [
    ...(isDev ? [new transports.Console({ format: format.prettyPrint() })] : []),
    new transports.File({
      filename: path.join(app.getPath('logs'), 'myide.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

logger.info('engine.session.started', {
  sessionId,
  projectPath: path.basename(projectPath), // 不记录完整路径
  model: userConfig.model,
  engineVersion: engineUpdater.getCurrentEngineVersion(),
});
```

---

# 二、后续开发任务与方案

---

## Task 1：多模型支持与模型路由（依托 sub2api）

### 目标

让用户可以选择不同的 AI 模型（Claude、GPT-4o、Gemini 等）。多模型路由**不需要自研**，直接由 sub2api 承担。

### sub2api 已经做好的事

[sub2api（Wei-Shaw/sub2api）](https://github.com/Wei-Shaw/sub2api) 是一个一站式开源中转服务，核心能力：

- **多模型统一接入**：Claude、OpenAI、Gemini、Antigravity 订阅统一接入，兼容 OpenAI API 格式
- **多用户管理**：用户 token 分发、权限控制
- **计费系统**：内置用量追踪和计费逻辑
- **拼车/共享**：适合你的 SaaS 场景，多用户共享你购买的订阅

你需要做的只是：在 sub2api 的管理后台配置好上游模型，然后让你的 IDE 客户端通过 sub2api 的统一接口访问。

### 你需要做的：前端模型选择器

```typescript
// 模型列表从 sub2api 动态拉取，不硬编码
async function fetchAvailableModels(): Promise<ModelConfig[]> {
  // sub2api 提供模型列表接口
  const resp = await fetch('https://api.yourservice.com/v1/models', {
    headers: { Authorization: `Bearer ${authStore.getJwt()}` },
  });
  const data = await resp.json();
  return data.data; // OpenAI 兼容格式
}

// apps/ui/src/components/ModelSelector.tsx
function ModelSelector() {
  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: fetchAvailableModels,
  });

  return (
    <select onChange={e => switchModel(e.target.value)}>
      {models?.map(m => (
        <option key={m.id} value={m.id}>{m.id}</option>
      ))}
    </select>
  );
}
```

### 切换模型无需重启引擎

```typescript
function switchModel(modelId: string) {
  const rpcMessage = JSON.stringify({
    method: 'config/update',
    params: { model: modelId },
    id: nextId(),
  }) + '\n';
  engineProcess.stdin?.write(rpcMessage);
}
```

### 交付物
- sub2api 部署与配置（上游模型接入）
- 模型选择器 UI 组件（前端）
- 动态拉取模型列表逻辑

---

## Task 2：计费与订阅系统（直接使用 sub2api）

### 目标

实现多用户 SaaS 的用量追踪、配额管理、计费。**无需从头开发**，直接使用 sub2api。

### 为什么 sub2api 适合你

你的场景：
- 有一个第三方反代服务（base_url + API Key）
- 需要支持多用户，每个用户有独立的配额
- 需要计费功能

sub2api 完全覆盖这个场景：

```
你的第三方反代服务
        │
        ▼
   sub2api 部署
   ├── 用户管理（注册/登录/JWT 签发）
   ├── Token 分发（每个用户一个访问 key）
   ├── 配额管理（每个用户/套餐的用量上限）
   ├── 用量记录（按 token 精确计费）
   ├── 计费面板（管理员查看所有用户用量）
   └── OpenAI 兼容 API（client 侧无感切换）
        │
        ▼
   IDE 客户端
   └── 用 JWT 请求 sub2api，sub2api 转发到你的反代服务
```

### 集成方式

sub2api 部署后你获得：

1. **管理员后台**：添加用户、设置配额、查看用量
2. **用户 API**：`/v1/chat/completions` 等兼容 OpenAI 的接口
3. **计费数据**：per-user token 用量统计

你的 IDE 客户端：
- 登录接口对接 sub2api 的认证（或在 sub2api 前加你自己的业务 API 层处理注册/登录）
- 请求 AI 接口时，JWT 发给 sub2api
- sub2api 验证后，用真实 Key 转发到你的反代服务

### 业务 API 层（薄薄的一层）

如果 sub2api 的用户管理 UI 不够满足你的业务需求（比如你有自己的注册/付款页面），可以在 sub2api 前加一个薄薄的业务层：

```typescript
// 你自己的业务后端（只做用户认证和套餐管理）
// AI 请求完全由 sub2api 处理，不经过这里

// 用户注册/登录
app.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json();
  const user = await authenticateUser(email, password);

  // 在 sub2api 中为用户创建/获取 token
  const sub2apiToken = await sub2api.getUserToken(user.id);

  // 给客户端返回 JWT（客户端后续直接用这个 token 访问 sub2api）
  return c.json({ token: sub2apiToken });
});

// 套餐升级（你自己处理付款，然后在 sub2api 调整配额）
app.post('/subscription/upgrade', authenticate, async (c) => {
  const { planId } = await c.req.json();
  await processPayment(c.get('userId'), planId);
  await sub2api.updateUserQuota(c.get('userId'), PLAN_QUOTAS[planId]);
  return c.json({ success: true });
});
```

### 交付物
- sub2api 部署与配置
- 可选：薄业务层（注册/付款/套餐管理）
- 用量展示 UI（可直接使用 sub2api 管理面板，或在客户端调用 sub2api 的用量 API 自定义显示）

---

## Task 3：工作区与项目管理（t3code 已具备）

### 目标

用户可以管理多个项目工作区，每个项目有独立的配置。

### t3code 的现有能力

t3code 已内置工作区管理，你只需要扩展 `.myide/config.toml` 工作区配置规范：

```toml
# .myide/config.toml（纳入 .gitignore）

[project]
name = "My Backend API"
default_model = "claude-3-7-sonnet"

[context]
always_include = [
  "README.md",
  "docs/architecture.md",
  "src/types/index.ts",
]
ignore = ["dist/", "*.min.js", "*.lock"]

[rules]
custom_instructions = """
这个项目使用 Hono 框架，数据库是 PostgreSQL + Drizzle ORM。
"""
```

### 交付物
- `.myide/config.toml` 规范与解析器（在 t3code 基础上扩展）
- 项目配置与引擎启动参数的映射逻辑

---

## Task 4：对话历史与持久化（t3code 已具备）

### 目标

保存每次 AI 对话历史，用户可以查看、搜索、恢复历史对话。

### t3code 的现有能力

t3code 已内置对话历史管理（本地 SQLite + 历史侧边栏 + 全文搜索）。如果 t3code 的实现不满足需求，参考以下方案扩展：

**全文搜索扩展：**

```typescript
// 在 t3code 现有 SQLite 上添加 FTS 虚拟表
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts
    USING fts5(content, session_id UNINDEXED, tokenize='unicode61');
`);

export function searchHistory(query: string, limit = 20) {
  return db.prepare(`
    SELECT s.id, s.title, s.project_path, s.created_at,
           snippet(turns_fts, 0, '<mark>', '</mark>', '...', 20) as excerpt
    FROM turns_fts
    JOIN sessions s ON turns_fts.session_id = s.id
    WHERE turns_fts MATCH ?
    ORDER BY rank LIMIT ?
  `).all(query, limit);
}
```

**云端同步（可选）：**

```typescript
async function syncToCloud(lastSyncAt: number) {
  const newSessions = db.prepare('SELECT * FROM sessions WHERE updated_at > ?').all(lastSyncAt);
  for (const session of newSessions) {
    const turns = db.prepare('SELECT * FROM turns WHERE session_id = ?').all(session.id);
    await api.post('/sync/sessions', { session, turns });
  }
  return Date.now();
}
```

### 交付物
- 确认 t3code 的对话历史功能满足需求（可能零开发量）
- 可选：全文检索扩展
- 可选：云端同步 API

---

## Task 5：沙箱安全升级

### 目标

从 unelevated 沙箱升级到 elevated 沙箱，安装阶段完成初始化，用户使用期间零感知。

### 安装阶段初始化（NSIS 脚本，Windows）

```nsis
Section "Core Engine Setup" SecEngine
  SetOutPath "$INSTDIR\resources"
  File "bin\ai-engine.exe"
  File "bin\sandbox-setup.exe"
  
  DetailPrint "正在初始化安全沙箱..."
  ExecWait '"$INSTDIR\resources\sandbox-setup.exe"' $0
  
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "安全沙箱初始化失败，将使用基础隔离模式。"
    WriteRegStr HKCU "Software\MyIDE" "SandboxMode" "unelevated"
  ${Else}
    WriteRegStr HKCU "Software\MyIDE" "SandboxMode" "elevated"
  ${EndIf}
SectionEnd
```

### 运行时沙箱选择

```typescript
function getSandboxMode(): 'elevated' | 'unelevated' {
  if (process.platform !== 'win32') return 'unelevated';
  try {
    const result = execSync('reg query "HKCU\\Software\\MyIDE" /v SandboxMode', { encoding: 'utf-8' });
    if (result.includes('elevated')) return 'elevated';
  } catch { /* 降级 */ }
  return 'unelevated';
}

export function getSandboxArgs(): string[] {
  return ['--config', `windows.sandbox="${getSandboxMode()}"`];
}
```

### 交付物
- NSIS / WiX 安装脚本（沙箱初始化段）
- 运行时沙箱模式检测逻辑
- macOS / Linux 等价隔离方案

---

## Task 6：自动更新机制（应用 + 引擎独立更新）

### 目标

应用本体和引擎二进制**分别独立更新**，哪个部分有新版本就更新哪个，互不依赖。

### 更新时序（用户无感知）

```
应用启动
  → 10秒后：检查应用更新（electron-updater）
  → 5分钟后：后台静默检查引擎更新
  → 如有引擎新版本：后台下载到临时文件
  → 下载完成，SHA256 校验
  → 当前没有活跃 AI 会话时：原子替换二进制文件
  → 下次会话启动时自动使用新版本
  → 无需重启应用
```

### 应用本体更新（electron-updater）

```typescript
// apps/desktop/src/updater/appUpdater.ts
import { autoUpdater } from 'electron-updater';

// 应用更新：有感知，需要用户确认重启
autoUpdater.autoDownload = false;

autoUpdater.on('update-available', (info) => {
  mainWindow.webContents.send('update:app:available', {
    version: info.version,
    releaseNotes: info.releaseNotes,
  });
});

autoUpdater.on('update-downloaded', () => {
  mainWindow.webContents.send('update:app:ready');
  // 显示弹窗：立即重启 / 下次启动更新
});

// 启动 10 秒后检查，之后每 4 小时一次
app.whenReady().then(() => {
  setTimeout(() => autoUpdater.checkForUpdates(), 10_000);
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
});
```

### 引擎二进制热更新（独立于应用，用户无感知）

```typescript
// apps/desktop/src/updater/engineUpdater.ts

interface EngineManifest {
  version: string;
  binaries: {
    [platform: string]: {  // 'win32-x64' | 'darwin-arm64' | 'linux-x64'
      url: string;
      sha256: string;
      size: number;
    };
  };
  minAppVersion: string; // 该引擎版本需要的最低应用版本
}

class EngineUpdater {
  private readonly MANIFEST_URL = 'https://releases.yourservice.com/engine/manifest.json';
  private readonly ENGINES_DIR = path.join(app.getPath('userData'), 'engines');
  private isUpdating = false;

  async checkAndUpdate(): Promise<void> {
    if (this.isUpdating) return;
    
    const manifest = await this.fetchManifest();
    const currentVersion = this.getCurrentEngineVersion();
    if (manifest.version === currentVersion) return;

    // 检查是否有活跃会话，有的话等待
    if (engineManager.hasActiveSessions()) {
      console.log('[EngineUpdater] Active sessions detected, will update when idle');
      engineManager.once('sessionsIdle', () => this.applyUpdate(manifest));
      return;
    }

    await this.applyUpdate(manifest);
  }

  private async applyUpdate(manifest: EngineManifest): Promise<void> {
    this.isUpdating = true;
    try {
      const platformKey = `${process.platform}-${process.arch}`;
      const binary = manifest.binaries[platformKey];
      if (!binary) return;

      console.log(`[EngineUpdater] Downloading engine ${manifest.version}`);
      
      // 下载到临时文件
      const tmpPath = path.join(this.ENGINES_DIR, `${manifest.version}.tmp`);
      await this.downloadWithVerification(binary.url, tmpPath, binary.sha256);

      // 原子替换：tmp → 正式路径（无需停止任何进程）
      const finalPath = path.join(this.ENGINES_DIR, manifest.version, this.getBinaryName());
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.renameSync(tmpPath, finalPath);
      fs.chmodSync(finalPath, 0o755);

      // 更新版本记录
      fs.writeFileSync(path.join(this.ENGINES_DIR, 'current_version'), manifest.version);

      // 清理旧版本（保留上一个，用于回滚）
      this.cleanupOldVersions(manifest.version);

      console.log(`[EngineUpdater] Engine updated to ${manifest.version} (无需重启应用)`);
      mainWindow.webContents.send('update:engine:done', { version: manifest.version });
    } finally {
      this.isUpdating = false;
    }
  }

  private async downloadWithVerification(url: string, dest: string, expectedSha256: string) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    const actualHash = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
    if (actualHash !== expectedSha256) {
      throw new Error(`Engine integrity check failed: expected ${expectedSha256}, got ${actualHash}`);
    }

    fs.writeFileSync(dest, Buffer.from(buffer), { mode: 0o755 });
  }

  private cleanupOldVersions(keepVersion: string) {
    const versions = fs.readdirSync(this.ENGINES_DIR)
      .filter(f => f !== 'current_version' && f !== keepVersion)
      .sort();
    // 最多保留一个旧版本（用于紧急回滚）
    while (versions.length > 1) {
      fs.rmSync(path.join(this.ENGINES_DIR, versions.shift()!), { recursive: true });
    }
  }

  // 版本回滚（紧急情况）
  rollback(): boolean {
    const versions = fs.readdirSync(this.ENGINES_DIR)
      .filter(f => f !== 'current_version')
      .sort();
    if (versions.length < 2) return false;
    const previousVersion = versions[versions.length - 2];
    fs.writeFileSync(path.join(this.ENGINES_DIR, 'current_version'), previousVersion);
    console.log(`[EngineUpdater] Rolled back to ${previousVersion}`);
    return true;
  }

  getCurrentEngineVersion(): string {
    const versionFile = path.join(this.ENGINES_DIR, 'current_version');
    return fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf-8').trim() : 'bundled';
  }

  getActiveEnginePath(): string {
    const version = this.getCurrentEngineVersion();
    if (version === 'bundled') return getBundledEnginePath();
    const binaryPath = path.join(this.ENGINES_DIR, version, this.getBinaryName());
    return fs.existsSync(binaryPath) ? binaryPath : getBundledEnginePath();
  }
}

export const engineUpdater = new EngineUpdater();

// 启动后 5 分钟检查引擎更新，之后每天检查一次
app.whenReady().then(() => {
  setTimeout(() => engineUpdater.checkAndUpdate(), 5 * 60 * 1000);
  setInterval(() => engineUpdater.checkAndUpdate(), 24 * 60 * 60 * 1000);
});
```

### CDN 上的 manifest.json 发布流程

```json
// https://releases.yourservice.com/engine/manifest.json
{
  "version": "0.5.2",
  "minAppVersion": "1.2.0",
  "binaries": {
    "win32-x64": {
      "url": "https://releases.yourservice.com/engine/0.5.2/codex-engine-win32-x64.exe",
      "sha256": "a3f2b1c4d5e6...",
      "size": 15728640
    },
    "darwin-arm64": {
      "url": "https://releases.yourservice.com/engine/0.5.2/codex-engine-darwin-arm64",
      "sha256": "b4e5c6d7e8f9...",
      "size": 14680064
    },
    "linux-x64": {
      "url": "https://releases.yourservice.com/engine/0.5.2/codex-engine-linux-x64",
      "sha256": "c5d6e7f8a9b0...",
      "size": 13631488
    }
  }
}
```

在 CI/CD 中，codex-rs 构建完成后自动更新这个文件并推到 CDN。

### 交付物
- `AppUpdater`：electron-updater 集成（有感知，用户确认重启）
- `EngineUpdater`：引擎热更新模块（无感知，原子替换）
- CI/CD 自动发布 `manifest.json` 到 CDN 的流水线
- 版本回滚机制（保留上一个版本引擎）
- 更新状态 UI（引擎更新完成的低调通知）

---

## Task 7：性能监控与 APM

### 目标

建立完整的应用性能监控体系，实时了解 TTFT、错误率、引擎崩溃率等关键指标。

### 客户端 APM（轻量自研）

```typescript
interface APMEvent {
  type: 'session_start' | 'session_end' | 'ttft' | 'error' | 'engine_crash' | 'update';
  timestamp: number;
  data: Record<string, unknown>;
  appVersion: string;
  platform: string;
  engineVersion: string;
}

class APMClient {
  private queue: APMEvent[] = [];
  private readonly FLUSH_INTERVAL = 30_000;

  track(type: APMEvent['type'], data: Record<string, unknown>) {
    if (!shouldSendTelemetry('usageAnalytics')) return;
    this.queue.push({
      type, timestamp: Date.now(), data,
      appVersion: app.getVersion(),
      platform: process.platform,
      engineVersion: engineUpdater.getCurrentEngineVersion(),
    });
    if (this.queue.length >= 50) this.flush();
  }

  private async flush() {
    if (!this.queue.length) return;
    const events = this.queue.splice(0);
    try {
      await fetch('https://apm.yourservice.com/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
    } catch { /* APM 上报失败不影响主流程 */ }
  }
}

export const apm = new APMClient();
apm.track('ttft', { ttftMs: 342, model: 'claude-3-7-sonnet', sessionId });
apm.track('engine_crash', { exitCode: 1, restartAttempt: 1 });
```

### 后端监控（Grafana + Prometheus）

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const register = new Registry();

export const metrics = {
  requestTotal: new Counter({
    name: 'myide_requests_total',
    help: 'Total API requests',
    labelNames: ['model', 'status'],
    registers: [register],
  }),
  ttftHistogram: new Histogram({
    name: 'myide_ttft_seconds',
    help: 'Time to First Token distribution',
    labelNames: ['model'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [register],
  }),
  activeEngines: new Gauge({
    name: 'myide_active_engines',
    help: 'Currently running engine processes',
    registers: [register],
  }),
};

app.get('/metrics', async (c) =>
  c.text(await register.metrics(), 200, { 'Content-Type': register.contentType })
);
```

### 交付物
- 客户端 APM 模块（批量上报、用户同意控制）
- APM 事件接收后端
- Grafana 仪表盘配置（TTFT、错误率、活跃用户、引擎崩溃率）
- 告警规则（崩溃率 > 5% 时通知）

---

## Task 8：移动端 / Web 端延伸

### 目标

提供 Web 版本（查看历史对话、简单问答）和移动端 App（iOS/Android）。

### Web 版架构

Web 版不能直接调用 codex-app-server（二进制无法在浏览器运行），改为服务端执行：

```typescript
// 后端：为 Web 版提供 SSE 接口
app.post('/api/web/chat', authenticate, async (c) => {
  const { messages, projectContext } = await c.req.json();
  const stream = await serverSideEngine.execute({
    userId: c.get('userId'),
    messages,
    projectContext,
    sandboxType: 'docker',
  });

  return streamSSE(c, async (send) => {
    for await (const chunk of stream) {
      await send({ data: JSON.stringify(chunk) });
    }
  });
});
```

### 交付物
- 服务端引擎执行器（Docker 沙箱）
- Web 版 SSE 流式接口
- Web 前端（Next.js，复用 t3code 的 React 组件）
- React Native 移动端 App（iOS + Android）

---

## 开发优先级推荐

| 优先级 | 任务 | 预计工作量 | 说明 |
|--------|------|-----------|------|
| **P0 - 立即** | 安全架构重构（1.1） | 1周 | 客户端不持有真实 Key，这是商业产品底线 |
| **P0 - 立即** | sub2api 部署（Task 2） | 2-3天 | 部署即获得多用户 + 计费能力，不需要自研 |
| **P1 - 1个月内** | 自动更新 - 应用+引擎独立（Task 6） | 1周 | 用户体验和快速迭代的基础 |
| **P1 - 1个月内** | 多模型选择器 UI（Task 1） | 3天 | 模型路由已由 sub2api 处理，只需前端 UI |
| **P1 - 1个月内** | 确认 t3code 对话历史覆盖（Task 4） | 0-3天 | 大概率零开发量 |
| **P2 - 2个月内** | 工作区配置扩展（Task 3） | 1周 | 面向专业开发者的必备功能 |
| **P2 - 2个月内** | 沙箱升级（Task 5） | 1周 | 安全升级 |
| **P2 - 2个月内** | 性能监控（Task 7） | 1周 | 规模增长后的必需品 |
| **P3 - 3个月+** | Web / 移动端（Task 8） | 3-4周 | 覆盖更多场景，投入较大 |

> **已移除的任务说明：**
> - **本地 SQLite 索引优化、RAG/代码库索引、多工作区与会话管理、插件/扩展系统**：t3code 已内置，无需重复开发
> - **网关层缓存策略**：codex-rs 和 t3code 已有处理
> - **完整计费与订阅（自研）**：直接使用 sub2api，不需要从头开发
> - **用户 Dashboard 与用量可视化（自研）**：sub2api 管理后台已覆盖，客户端可调用 sub2api API 补充展示
> - **团队协作功能**：暂不开发
> - **License 与激活系统**：暂不需要
> - **客服与工单系统**：暂不需要

---

*文档持续更新中。如有技术问题或方案调整，请以最新讨论内容为准。*
