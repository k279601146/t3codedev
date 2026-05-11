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

## 五、无 Git 环境的处理

用户机器没有安装 Git 时有两个方案：

**方案 A（推荐）：使用 isomorphic-git**

纯 JS 实现，零系统依赖，可完全替换上述 `git()` 调用：

```bash
bun add isomorphic-git
```

```typescript
import * as git from "isomorphic-git";
import * as fs from "node:fs";

// isomorphic-git 的 API 与原生 git 命令一一对应
// capture 中的 git write-tree 对应：
const tree = await git.writeTree({ fs, dir });

// git update-ref 对应：
await git.writeRef({ fs, dir, ref: `refs/conductor-checkpoints/${id}`, value: commitOid });
```

**方案 B：降级为文件快照**

检测 Git 不可用时，自动降级为 Cursor 风格的目录复制快照，功能相同但不支持 diff：

```typescript
export async function capture(workdir: string, options?) {
  const hasGit = await checkGitAvailable(workdir);
  if (hasGit) {
    return captureWithGit(workdir, options); // Conductor 方案
  } else {
    return captureWithCopy(workdir, options); // 文件复制降级
  }
}
```

---

## 六、注意事项

**不能还原的内容：**

- bash 命令的副作用（如已安装的 npm 包、已执行的数据库迁移）
- `.gitignore` 忽略的文件（快照时被排除）

**并发限制：**
如 Conductor 博客所述，多个 AI 任务同时在同一工作区运行时，checkpoint 会将它们的变更混在一起，无法独立还原。建议同一工作区同一时刻只运行一个 AI 任务。

**GC 清理：**
删除 ref 后，对象会在 `git gc` 运行时被回收。可定期运行：

```bash
git gc --prune=7.days
```

**Git 要求：**

- 最低版本：Git 2.5+（支持 `commit-tree`、`write-tree`、`read-tree --reset -u`）
- 项目必须是一个有效的 git repo（至少 `git init` 过）

---

## 七、参考来源

- [Conductor 官方博客：How we built checkpointing](https://blog.conductor.build/checkpointing/)
- [checkpointer.sh 源码 Gist（Conductor 团队）](https://gist.github.com/jacksondc/10507c3e41623769dc2918c8b9a3597f)
- [Conductor checkpoint 文档](https://docs.conductor.build/core/checkpoints)
- [t3code 架构（DeepWiki）](https://deepwiki.com/pingdotgg/t3code)
