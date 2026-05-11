# Checkpoint 方案设计文档

> 基于 Conductor 真实实现（`checkpointer.sh` gist），适配 t3code / Codex app-server 技术栈

---

## 一、背景与方案对比

### 为什么不能直接用"commit 到 private ref"

这是最常被误传的实现方式，但 Conductor 官方博客明确指出它**行不通**：

> "Commit to a private ref. Unfortunately, this misses uncommitted and untracked changes."

一个普通 `git commit` 只能捕获**已暂存（staged）的变更**，无法覆盖：

- 工作区中未 staged 的文件修改
- 未被追踪的新文件（untracked）
- 已暂存但与 commit 不同的 index 状态

### Conductor 的真实方案

Conductor 捕获**三层状态**，并将它们编码进一个私有 commit 的 message 中，存储到 `.git/refs/conductor-checkpoints/<id>`：

| 层级     | 内容                         | 捕获方式                                            |
| -------- | ---------------------------- | --------------------------------------------------- |
| HEAD     | 当前 commit OID              | `git rev-parse HEAD`                                |
| index    | staged 快照                  | `git write-tree`（直接写当前 index）                |
| worktree | 全量文件快照（含 untracked） | `GIT_INDEX_FILE=<tmp> git add -A && git write-tree` |

还原时按反向顺序恢复三层：

1. `git reset --hard <head_oid>` — 恢复 commit 历史
2. `git read-tree --reset -u <worktree_tree>` + `git clean -fd` — 恢复工作区文件
3. `git read-tree --reset <index_tree>` — 恢复 staged 状态

---

## 二、核心 API 设计

```
checkpointId = capture()           // 保存当前完整状态
revert(checkpointId)               // 还原到指定 checkpoint
diff(id1, id2 | "current")        // 对比两个 checkpoint，或 checkpoint 与当前状态
list()                             // 列出所有 checkpoint
delete(checkpointId)               // 删除单个 checkpoint
```

---

## 三、完整实现（Node.js）

适配 t3code 的 Node.js + Effect 后端技术栈。以下为独立的 `CheckpointService`，可直接注入到 t3code 的 Effect Layer 体系中。

### 3.1 依赖

```bash
# t3code 已有 simple-git，直接使用即可
# 若无，安装：
bun add simple-git
```

### 3.2 `CheckpointService.ts`

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckpointMeta {
  id: string;
  headOid: string; // HEAD commit OID（40位hex，或 zeros 表示 unborn）
  indexTree: string; // staged 状态的 tree OID
  worktreeTree: string; // 全量工作区的 tree OID（含 untracked）
  createdAt: string; // ISO8601 UTC
  messageIndex?: number; // 对应的对话消息序号（可选，由调用方传入）
}

export interface CheckpointDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  rawDiff: string; // git diff 原始输出
}

const ZEROS = "0".repeat(40);
const REF_PREFIX = "refs/conductor-checkpoints";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 在指定 workdir 运行 git 命令
 */
async function git(workdir: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await exec("git", ["-C", workdir, ...args], {
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

/**
 * 获取 repo 根目录
 */
async function getRepoRoot(workdir: string): Promise<string> {
  return git(workdir, ["rev-parse", "--show-toplevel"]);
}

/**
 * 从 checkpoint commit 的 message 中解析 metadata
 */
function parseMeta(commitMessage: string, id: string): CheckpointMeta {
  const lines = commitMessage.split("\n");
  const get = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`${key} `));
    return line ? line.slice(key.length + 1).trim() : "";
  };
  return {
    id,
    headOid: get("head"),
    indexTree: get("index-tree"),
    worktreeTree: get("worktree-tree"),
    createdAt: get("created"),
    messageIndex: get("message-index") ? parseInt(get("message-index")) : undefined,
  };
}

// ─── Core Operations ──────────────────────────────────────────────────────────

/**
 * 捕获当前完整状态（HEAD + index + worktree）
 * 不修改任何磁盘文件，不移动 HEAD
 *
 * @param workdir  项目根目录（或其子目录）
 * @param options  可选：自定义 id、关联的消息序号
 */
export async function capture(
  workdir: string,
  options?: { id?: string; messageIndex?: number },
): Promise<CheckpointMeta> {
  const root = await getRepoRoot(workdir);
  const id = options?.id ?? `cp-${new Date().toISOString().replace(/[:.]/g, "")}`;
  const ref = `${REF_PREFIX}/${id}`;

  // 检查是否已存在
  const existing = await git(root, ["rev-parse", "-q", "--verify", ref]).catch(() => "");
  if (existing) {
    throw new Error(`Checkpoint '${id}' already exists`);
  }

  // 1. HEAD OID（处理 unborn HEAD）
  const headOid = await git(root, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => ZEROS);

  // 2. Index tree（当前 staged 状态）
  let indexTree: string;
  try {
    indexTree = await git(root, ["write-tree"]);
  } catch {
    throw new Error("Cannot save checkpoint: index has unresolved merge conflicts");
  }

  // 3. Worktree tree（全量快照，含 untracked，借助临时 index）
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chkpt-"));
  const tmpIndex = path.join(tmpDir, "index");
  let worktreeTree: string;
  try {
    // 将所有文件（含 untracked）写入临时 index
    await git(root, ["add", "-A", "--", "."], { GIT_INDEX_FILE: tmpIndex });
    worktreeTree = await git(root, ["write-tree"], {
      GIT_INDEX_FILE: tmpIndex,
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // 4. 将三层状态编码进 commit message，写入私有 ref
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const messageLines = [
    `checkpoint:${id}`,
    `head ${headOid}`,
    `index-tree ${indexTree}`,
    `worktree-tree ${worktreeTree}`,
    `created ${now}`,
    options?.messageIndex !== undefined ? `message-index ${options.messageIndex}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const commitOid = await git(root, ["commit-tree", worktreeTree, "-m", messageLines], {
    GIT_AUTHOR_NAME: "Checkpointer",
    GIT_AUTHOR_EMAIL: "checkpointer@noreply",
    GIT_AUTHOR_DATE: now,
    GIT_COMMITTER_NAME: "Checkpointer",
    GIT_COMMITTER_EMAIL: "checkpointer@noreply",
    GIT_COMMITTER_DATE: now,
  });

  // 更新私有 ref（不影响 HEAD，不影响任何分支）
  await git(root, ["update-ref", ref, commitOid]);

  return {
    id,
    headOid,
    indexTree,
    worktreeTree,
    createdAt: now,
    messageIndex: options?.messageIndex,
  };
}

/**
 * 还原到指定 checkpoint
 * 完整恢复：HEAD commit + staged 状态 + 工作区文件（含 untracked）
 *
 * @param workdir       项目根目录（或其子目录）
 * @param checkpointId  要还原的 checkpoint id
 */
export async function revert(workdir: string, checkpointId: string): Promise<void> {
  const root = await getRepoRoot(workdir);
  const ref = `${REF_PREFIX}/${checkpointId}`;

  const commitOid = await git(root, ["rev-parse", "-q", "--verify", ref]).catch(() => {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  });

  const message = await git(root, ["cat-file", "commit", commitOid]);
  const meta = parseMeta(message, checkpointId);

  if (!meta.worktreeTree || !meta.indexTree || !meta.headOid) {
    throw new Error(`Checkpoint metadata is incomplete: ${checkpointId}`);
  }
  if (meta.headOid === ZEROS) {
    throw new Error("Cannot restore: checkpoint was saved with unborn HEAD");
  }

  // 步骤 1：恢复 HEAD commit（--hard 同时重置 index 和 worktree 到该 commit）
  await git(root, ["reset", "--hard", meta.headOid]);

  // 步骤 2：将工作区文件恢复到 worktree 快照
  //         read-tree -u 会更新 index 和磁盘文件
  await git(root, ["read-tree", "--reset", "-u", meta.worktreeTree]);
  // 删除快照中不存在的 untracked 文件（保留 .gitignore 忽略的文件）
  await git(root, ["clean", "-fd"]);

  // 步骤 3：单独恢复 staged 状态（不改磁盘文件，只改 index）
  await git(root, ["read-tree", "--reset", meta.indexTree]);
}

/**
 * 对比两个 checkpoint 之间的差异
 * id2 可传 "current" 表示与当前工作区对比
 */
export async function diff(workdir: string, id1: string, id2: string): Promise<CheckpointDiff> {
  const root = await getRepoRoot(workdir);

  // 解析 id1 的 worktree tree
  const ref1 = `${REF_PREFIX}/${id1}`;
  const commit1 = await git(root, ["rev-parse", "-q", "--verify", ref1]).catch(() => {
    throw new Error(`Checkpoint not found: ${id1}`);
  });
  const msg1 = await git(root, ["cat-file", "commit", commit1]);
  const meta1 = parseMeta(msg1, id1);

  // 解析 id2 的 worktree tree，或构建当前工作区临时 tree
  let tree2: string;
  if (id2 === "current") {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chkpt-cur-"));
    const tmpIndex = path.join(tmpDir, "index");
    try {
      await git(root, ["add", "-A", "--", "."], { GIT_INDEX_FILE: tmpIndex });
      tree2 = await git(root, ["write-tree"], { GIT_INDEX_FILE: tmpIndex });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  } else {
    const ref2 = `${REF_PREFIX}/${id2}`;
    const commit2 = await git(root, ["rev-parse", "-q", "--verify", ref2]).catch(() => {
      throw new Error(`Checkpoint not found: ${id2}`);
    });
    const msg2 = await git(root, ["cat-file", "commit", commit2]);
    const meta2 = parseMeta(msg2, id2);
    tree2 = meta2.worktreeTree;
  }

  // 执行 diff
  const rawDiff = await git(root, ["diff", "--name-status", meta1.worktreeTree, tree2]).catch(
    () => "",
  );

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const line of rawDiff.split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    if (status === "A") added.push(file);
    else if (status === "M") modified.push(file);
    else if (status === "D") deleted.push(file);
  }

  return { added, modified, deleted, rawDiff };
}

/**
 * 列出当前 repo 的所有 checkpoint（按创建时间倒序）
 */
export async function list(workdir: string): Promise<CheckpointMeta[]> {
  const root = await getRepoRoot(workdir);

  const refsOutput = await git(root, [
    "for-each-ref",
    `refs/conductor-checkpoints/`,
    "--format=%(refname)",
  ]).catch(() => "");

  if (!refsOutput) return [];

  const refs = refsOutput.split("\n").filter(Boolean);
  const metas: CheckpointMeta[] = [];

  for (const ref of refs) {
    const id = ref.replace(`${REF_PREFIX}/`, "");
    try {
      const commitOid = await git(root, ["rev-parse", ref]);
      const message = await git(root, ["cat-file", "commit", commitOid]);
      metas.push(parseMeta(message, id));
    } catch {
      // 跳过损坏的 ref
    }
  }

  // 按创建时间倒序排列（最新的在前）
  return metas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * 删除指定 checkpoint（释放 ref，GC 后对象会被回收）
 */
export async function deleteCheckpoint(workdir: string, checkpointId: string): Promise<void> {
  const root = await getRepoRoot(workdir);
  const ref = `${REF_PREFIX}/${checkpointId}`;

  const exists = await git(root, ["rev-parse", "-q", "--verify", ref]).catch(() => "");
  if (!exists) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  await git(root, ["update-ref", "-d", ref]);
}
```

---

## 四、与 t3code / Codex app-server 的集成

### 4.1 触发时机

参考 Conductor 的实现：在 AI **响应开始前**创建 checkpoint（而不是在响应结束后）。这样无论 AI 做了什么，都能完整还原到 **用户发送消息那一刻** 的状态。

```
用户发送 prompt
    ↓
[后端] 收到消息，先调用 capture()，记录 checkpointId 与 messageIndex
    ↓
[后端] 转发给 Codex app-server / Claude Code 执行
    ↓
AI 修改文件、运行命令……
    ↓
[后端] 将 checkpointId 附加到响应事件，推送给前端
```

Codex app-server 支持 hook 机制，可在 `PreToolCall` 事件触发时自动执行 capture：

```typescript
// 在 Codex app-server 的 hook 配置中
hooks: {
  PreToolCall: async (event) => {
    if (isFileEditTool(event.tool)) {
      await capture(event.workdir, {
        messageIndex: event.messageIndex,
      });
    }
  },
}
```

### 4.2 WebSocket 事件扩展（t3code 合约层）

在 `packages/contracts/src/ws.ts` 中扩展：

```typescript
// WS_METHODS 新增
"checkpoint.list":    { input: { workdir: string }, output: CheckpointMeta[] }
"checkpoint.revert":  { input: { workdir: string; checkpointId: string }, output: void }
"checkpoint.diff":    { input: { workdir: string; id1: string; id2: string }, output: CheckpointDiff }
"checkpoint.delete":  { input: { workdir: string; checkpointId: string }, output: void }

// WS_CHANNELS 新增推送事件
"checkpoint.created": CheckpointMeta   // AI 响应前触发，通知前端新 checkpoint 已创建
```

### 4.3 后端路由（t3code server 层）

```typescript
// apps/server/src/routes/checkpoint.ts
import { capture, revert, diff, list, deleteCheckpoint } from "../checkpoint/CheckpointService";

router.on("checkpoint.list", async ({ workdir }) => list(workdir));
router.on("checkpoint.revert", async ({ workdir, checkpointId }) => revert(workdir, checkpointId));
router.on("checkpoint.diff", async ({ workdir, id1, id2 }) => diff(workdir, id1, id2));
router.on("checkpoint.delete", async ({ workdir, checkpointId }) =>
  deleteCheckpoint(workdir, checkpointId),
);
```

### 4.4 前端 UI（对话历史中的还原按钮）

每条 AI 消息渲染时，若该消息关联了 `checkpointId`，在消息 hover 时显示还原按钮：

```tsx
// apps/web/src/components/ChatMessage.tsx
function CheckpointRestoreButton({ checkpointId, workdir }: Props) {
  const [isPending, setIsPending] = useState(false);

  const handleRestore = async () => {
    if (!confirm("还原到此节点？当前所有文件变更将被覆盖。")) return;
    setIsPending(true);
    try {
      await wsClient.invoke("checkpoint.revert", { workdir, checkpointId });
      // 同时截断对话历史到此消息
      conversationStore.truncateTo(messageIndex);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button onClick={handleRestore} disabled={isPending}>
      {isPending ? "还原中…" : "还原到此节点"}
    </button>
  );
}
```

---

## 五、非 Git 项目 / 无 Git 环境的处理

前面的 Conductor 方案有两个前提：① 用户机器安装了 Git，② 项目本身是 git repo。这两个条件任意一个不满足，都需要额外处理。

---

### 情况 A：有 Git，但项目不是 git repo

这是最常见的情况。用户打开了一个普通文件夹，没有 `.git` 目录。

**方案：Shadow Git（Cline 的做法）**

Cline 使用"shadow git"方案：在用户项目**旁边**创建一个隔离的 git 仓库，专门用于 checkpoint，完全不污染用户的项目目录。

Shadow git 仓库存放在应用的数据目录下，以项目路径的 hash 命名，与项目通过 `git worktree` 关联：

```
~/.your-app/checkpoints/
  {cwdHash}/          ← 每个项目有独立的 shadow repo
    .git/
      refs/
        conductor-checkpoints/
          cp-xxx
          cp-yyy
```

每个工作区根据路径生成唯一 hash，作为 shadow repo 的目录名，确保不同项目的 checkpoint 互不干扰。

#### 实现代码

```typescript
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";

const APP_DATA_DIR = path.join(os.homedir(), ".your-app", "checkpoints");

/**
 * 根据项目路径计算 shadow repo 目录
 */
function getShadowGitDir(projectRoot: string): string {
  const hash = crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
  return path.join(APP_DATA_DIR, hash);
}

/**
 * 初始化 shadow git repo（如果还不存在）
 * 通过 --work-tree 指向用户项目，git 对象存在 shadow 目录中
 */
async function ensureShadowRepo(projectRoot: string): Promise<string> {
  const shadowDir = getShadowGitDir(projectRoot);
  await fs.mkdir(shadowDir, { recursive: true });

  const gitDir = path.join(shadowDir, ".git");
  const alreadyInit = await fs
    .access(gitDir)
    .then(() => true)
    .catch(() => false);

  if (!alreadyInit) {
    // 初始化裸 git 结构
    await exec("git", ["init", "--bare", gitDir]);

    // 写入 worktree 关联配置：告诉 git 工作区在哪里
    await fs.writeFile(
      path.join(gitDir, "config"),
      `[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tworktree = ${projectRoot}\n`,
      "utf8",
    );

    // 配置 git identity（避免依赖用户的全局 git config）
    await gitShadow(projectRoot, ["config", "user.name", "Checkpointer"]);
    await gitShadow(projectRoot, ["config", "user.email", "checkpointer@noreply"]);

    // 写入排除文件（不追踪 node_modules 等）
    const excludesPath = path.join(gitDir, "info", "exclude");
    await fs.mkdir(path.dirname(excludesPath), { recursive: true });
    await fs.writeFile(excludesPath, DEFAULT_EXCLUDES.join("\n"), "utf8");
  }

  return shadowDir;
}

/**
 * 在 shadow repo 上下文中执行 git 命令
 * --git-dir 指向 shadow repo，--work-tree 指向用户项目
 */
async function gitShadow(
  projectRoot: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  const shadowDir = getShadowGitDir(projectRoot);
  const gitDir = path.join(shadowDir, ".git");
  const { stdout } = await exec(
    "git",
    [`--git-dir=${gitDir}`, `--work-tree=${projectRoot}`, ...args],
    { env: { ...process.env, ...env } },
  );
  return stdout.trim();
}

/**
 * 捕获（shadow git 版本）
 * 与 Conductor 方案完全相同，区别只是用 gitShadow 替代 git
 */
export async function captureShadow(
  projectRoot: string,
  options?: { id?: string; messageIndex?: number },
): Promise<CheckpointMeta> {
  await ensureShadowRepo(projectRoot);

  const id = options?.id ?? `cp-${new Date().toISOString().replace(/[:.]/g, "")}`;
  const ref = `${REF_PREFIX}/${id}`;

  // HEAD OID（shadow repo 初始时没有 commit，用 zeros）
  const headOid = await gitShadow(projectRoot, ["rev-parse", "-q", "--verify", "HEAD"]).catch(
    () => ZEROS,
  );

  // Index tree（staged 状态）
  // 先 add -A 让 shadow index 反映当前工作区，再 write-tree
  await gitShadow(projectRoot, ["add", "-A", "--", "."]);
  const indexTree = await gitShadow(projectRoot, ["write-tree"]);

  // Worktree tree（用临时 index，与主方案完全一致）
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shadow-chkpt-"));
  const tmpIndex = path.join(tmpDir, "index");
  const shadowGitDir = path.join(getShadowGitDir(projectRoot), ".git");
  let worktreeTree: string;
  try {
    await gitShadow(projectRoot, ["add", "-A", "--", "."], {
      GIT_INDEX_FILE: tmpIndex,
      GIT_DIR: shadowGitDir,
    });
    worktreeTree = await gitShadow(projectRoot, ["write-tree"], {
      GIT_INDEX_FILE: tmpIndex,
      GIT_DIR: shadowGitDir,
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // 写入 checkpoint commit → private ref（与主方案完全一致）
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const messageLines = [
    `checkpoint:${id}`,
    `head ${headOid}`,
    `index-tree ${indexTree}`,
    `worktree-tree ${worktreeTree}`,
    `created ${now}`,
    options?.messageIndex !== undefined ? `message-index ${options.messageIndex}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const commitOid = await gitShadow(
    projectRoot,
    ["commit-tree", worktreeTree, "-m", messageLines],
    {
      GIT_AUTHOR_NAME: "Checkpointer",
      GIT_AUTHOR_EMAIL: "checkpointer@noreply",
      GIT_AUTHOR_DATE: now,
      GIT_COMMITTER_NAME: "Checkpointer",
      GIT_COMMITTER_EMAIL: "checkpointer@noreply",
      GIT_COMMITTER_DATE: now,
    },
  );

  await gitShadow(projectRoot, ["update-ref", ref, commitOid]);

  return {
    id,
    headOid,
    indexTree,
    worktreeTree,
    createdAt: now,
    messageIndex: options?.messageIndex,
  };
}

/**
 * 还原（shadow git 版本）
 * 步骤与主方案完全相同
 */
export async function revertShadow(projectRoot: string, checkpointId: string): Promise<void> {
  const ref = `${REF_PREFIX}/${checkpointId}`;
  const commitOid = await gitShadow(projectRoot, ["rev-parse", "-q", "--verify", ref]).catch(() => {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  });

  const message = await gitShadow(projectRoot, ["cat-file", "commit", commitOid]);
  const meta = parseMeta(message, checkpointId);

  // 步骤 1：还原工作区文件到 worktree 快照
  await gitShadow(projectRoot, ["read-tree", "--reset", "-u", meta.worktreeTree]);
  await gitShadow(projectRoot, ["clean", "-fd"]);

  // 步骤 2：还原 staged 状态
  await gitShadow(projectRoot, ["read-tree", "--reset", meta.indexTree]);

  // 注意：非 git repo 项目没有 HEAD commit 可恢复，跳过 reset --hard 步骤
}

// 默认排除规则（参考 Cline 的 CheckpointExclusions.ts）
const DEFAULT_EXCLUDES = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
  "*.log",
  ".DS_Store",
  "*.pyc",
  "__pycache__/",
  ".venv/",
  "target/", // Rust
  "*.lock",
];
```

#### 嵌套 git repo 的问题

Shadow git 面临的一个挑战是嵌套 git 仓库：用户项目里可能存在子目录本身也是 git repo（如 git submodule 或 monorepo 子包）。Git 默认不允许在一个 repo 内追踪另一个 repo 的文件。Cline 的解决方案是：在执行 checkpoint 操作前，临时将嵌套的 `.git` 目录重命名为 `.git_disabled`，操作完成后再恢复。

```typescript
/**
 * 临时禁用嵌套 .git 目录，操作完成后恢复
 */
async function withNestedGitDisabled(projectRoot: string, fn: () => Promise<void>): Promise<void> {
  // 查找所有嵌套的 .git（排除根目录自身）
  const nested = await findNestedGitDirs(projectRoot);

  // 重命名为 .git_disabled
  for (const gitDir of nested) {
    await fs.rename(gitDir, gitDir.replace(/\.git$/, ".git_disabled"));
  }

  try {
    await fn();
  } finally {
    // 无论成功失败，都要恢复
    for (const gitDir of nested) {
      const disabled = gitDir.replace(/\.git$/, ".git_disabled");
      await fs.rename(disabled, gitDir).catch(() => {});
    }
  }
}

async function findNestedGitDirs(root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      const sub = path.join(root, entry.name);
      const gitPath = path.join(sub, ".git");
      if (
        await fs
          .access(gitPath)
          .then(() => true)
          .catch(() => false)
      ) {
        results.push(gitPath);
      }
      results.push(...(await findNestedGitDirs(sub)));
    }
  }
  return results;
}

// 使用：
await withNestedGitDisabled(projectRoot, async () => {
  await captureShadow(projectRoot, options);
});
```

---

### 情况 B：没有安装 Git

**方案：使用 isomorphic-git**

Cline 在初始化时会先通过 `simpleGit().version()` 验证 Git 是否可用，如不可用则禁用 checkpoint 功能。 但你可以选择更好的方式：用 isomorphic-git 完整替换系统 Git，用户无感知：

```bash
bun add isomorphic-git
```

isomorphic-git 是纯 JS 实现，不需要系统安装 Git，并且可以和 shadow git 方案完全结合使用：

```typescript
import * as git from "isomorphic-git";
import { fs } from "node:fs"; // isomorphic-git 接受 node fs 模块

// 等价于：git --git-dir=shadowDir init --bare
await git.init({ fs, dir: projectRoot, gitdir: shadowGitDir, bare: false });

// 等价于：git write-tree
const treeOid = await git.writeTree({ fs, dir: projectRoot, gitdir: shadowGitDir });

// 等价于：git commit-tree
const commitOid = await git.commit({
  fs,
  dir: projectRoot,
  gitdir: shadowGitDir,
  message: messageLines,
  author: { name: "Checkpointer", email: "checkpointer@noreply" },
  tree: treeOid,
  noUpdateBranch: true, // 不移动 HEAD
});

// 等价于：git update-ref
await git.writeRef({
  fs,
  dir: projectRoot,
  gitdir: shadowGitDir,
  ref: `refs/conductor-checkpoints/${id}`,
  value: commitOid,
  force: true,
});
```

> **注意**：isomorphic-git 的 `git.add()` / `write-tree` 对大型项目（数万文件）性能不如原生 git，建议在文件数超过 10000 时优先检测并使用系统 Git。

---

### 统一入口：自动选择策略

建议将上述三种情况封装成一个统一的 `CheckpointManager`，根据运行环境自动选择最优策略：

```typescript
type Strategy = "conductor" | "shadow-git" | "isomorphic";

export class CheckpointManager {
  private strategy: Strategy;
  private projectRoot: string;

  static async create(projectRoot: string): Promise<CheckpointManager> {
    const manager = new CheckpointManager(projectRoot);
    manager.strategy = await manager.detectStrategy();
    return manager;
  }

  private async detectStrategy(): Promise<Strategy> {
    // 1. 检测系统 Git 是否可用
    const hasGit = await exec("git", ["--version"])
      .then(() => true)
      .catch(() => false);

    if (!hasGit) {
      return "isomorphic"; // 没有 Git → isomorphic-git
    }

    // 2. 检测项目是否是 git repo
    const isGitRepo = await exec("git", ["-C", this.projectRoot, "rev-parse", "--git-dir"])
      .then(() => true)
      .catch(() => false);

    if (isGitRepo) {
      return "conductor"; // 有 Git + 是 git repo → Conductor 原方案
    } else {
      return "shadow-git"; // 有 Git + 不是 git repo → Shadow Git
    }
  }

  async capture(options?: { id?: string; messageIndex?: number }) {
    switch (this.strategy) {
      case "conductor":
        return capture(this.projectRoot, options);
      case "shadow-git":
        return captureShadow(this.projectRoot, options);
      case "isomorphic":
        return captureIsomorphic(this.projectRoot, options);
    }
  }

  async revert(checkpointId: string) {
    switch (this.strategy) {
      case "conductor":
        return revert(this.projectRoot, checkpointId);
      case "shadow-git":
        return revertShadow(this.projectRoot, checkpointId);
      case "isomorphic":
        return revertIsomorphic(this.projectRoot, checkpointId);
    }
  }

  // diff、list、delete 同理
}
```

调用方只需：

```typescript
const checkpoint = await CheckpointManager.create(workdir);
const meta = await checkpoint.capture({ messageIndex: 3 });
// ...之后需要还原时：
await checkpoint.revert(meta.id);
```

---

### 三种情况对比总结

| 情况                   | 策略                     | 存储位置                           | 支持 diff | 性能           |
| ---------------------- | ------------------------ | ---------------------------------- | --------- | -------------- |
| 有 Git + 是 git repo   | Conductor（private ref） | `.git/refs/conductor-checkpoints/` | ✅        | 最快           |
| 有 Git + 不是 git repo | Shadow Git               | `~/.your-app/checkpoints/{hash}/`  | ✅        | 快             |
| 无 Git                 | isomorphic-git + shadow  | `~/.your-app/checkpoints/{hash}/`  | ✅        | 较慢（大项目） |

---

## 六、注意事项

**不能还原的内容：**

- bash 命令的副作用（如已安装的 npm 包、已执行的数据库迁移）
- `.gitignore`（或 shadow repo 的 `exclude` 文件）中忽略的文件

**并发限制：**
如 Conductor 博客所述，多个 AI 任务同时在同一工作区运行时，checkpoint 会将它们的变更混在一起，无法独立还原。建议同一工作区同一时刻只运行一个 AI 任务。

**GC 清理：**
删除 ref 后，对象会在 `git gc` 运行时被回收。可定期运行：

```bash
git gc --prune=7.days
```

对于 shadow repo，可在应用退出时对 shadow git 目录执行 gc。

**Git 要求（Conductor / Shadow Git 方案）：**

- 最低版本：Git 2.5+
- Shadow Git 方案：项目根目录不能是 `$HOME` 或 `/` 等受保护目录

---

## 七、参考来源

- [Conductor 官方博客：How we built checkpointing](https://blog.conductor.build/checkpointing/)
- [checkpointer.sh 源码 Gist（Conductor 团队）](https://gist.github.com/jacksondc/10507c3e41623769dc2918c8b9a3597f)
- [Conductor checkpoint 文档](https://docs.conductor.build/core/checkpoints)
- [Cline Checkpoints System（DeepWiki）](https://deepwiki.com/char8x/cline/5.4-checkpoints-system)
- [t3code 架构（DeepWiki）](https://deepwiki.com/pingdotgg/t3code)
