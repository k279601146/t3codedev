// @effect-diagnostics nodeBuiltinImport:off
/**
 * CheckpointStoreLive - Filesystem checkpoint store adapter layer.
 *
 * Implements workspace checkpoints with three strategies:
 * - native Git worktrees: Conductor-style private refs in the user's repo
 * - non-Git folders with system Git: isolated shadow Git repo in app data
 * - no system Git: isomorphic-git backed shadow repo in app data
 *
 * This layer owns filesystem/Git interactions only; it does not persist
 * checkpoint metadata and does not coordinate provider rollback semantics.
 *
 * @module CheckpointStoreLive
 */
import { createHash, randomUUID } from "node:crypto";
import nodeFs from "node:fs";
import nodeFsPromises from "node:fs/promises";
import * as nodePath from "node:path";

import * as isoGit from "isomorphic-git";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { CheckpointInvariantError, type CheckpointStoreError } from "../Errors.ts";
import { CheckpointRef, VcsProcessExitError } from "@t3tools/contracts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { ServerConfig } from "../../config.ts";
import { VcsProcess, type VcsProcessOutput } from "../../vcs/VcsProcess.ts";

const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;
const ZERO_OID = "0".repeat(40);
const SHADOW_CHECKPOINT_DIR_NAME = "checkpoints";
const SHADOW_GIT_DIR_NAME = ".git";
const ISO_SNAPSHOT_REF_PREFIX = "refs/t3/isomorphic-checkpoints";
const SHADOW_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".venv",
  "__pycache__",
  "target",
]);
const DEFAULT_SHADOW_EXCLUDES = [
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
  "target/",
  "*.lock",
].join("\n");

type GitStrategy =
  | {
      readonly kind: "conductor";
      readonly cwd: string;
      readonly canRestoreHead: true;
    }
  | {
      readonly kind: "shadow-git";
      readonly cwd: string;
      readonly gitDir: string;
      readonly canRestoreHead: false;
    };

type CheckpointStrategy =
  | GitStrategy
  | {
      readonly kind: "isomorphic";
      readonly cwd: string;
      readonly gitDir: string;
      readonly canRestoreHead: false;
    };

interface CheckpointGitMetadata {
  readonly headOid: string;
  readonly indexTree: string;
  readonly worktreeTree: string;
  readonly createdAt: string;
}

function parseCheckpointGitMetadata(commitObject: string): CheckpointGitMetadata | null {
  const messageStart = commitObject.indexOf("\n\n");
  const message = messageStart === -1 ? commitObject : commitObject.slice(messageStart + 2);
  return parseCheckpointMessage(message);
}

function parseCheckpointMessage(message: string): CheckpointGitMetadata | null {
  const lines = message.split(/\r?\n/);
  const getValue = (key: string) => {
    const line = lines.find((entry) => entry.startsWith(`${key} `));
    return line ? line.slice(key.length + 1).trim() : "";
  };

  const headOid = getValue("head");
  const indexTree = getValue("index-tree");
  const worktreeTree = getValue("worktree-tree");
  const createdAt = getValue("created");

  if (!headOid || !indexTree || !worktreeTree || !createdAt) {
    return null;
  }

  return {
    headOid,
    indexTree,
    worktreeTree,
    createdAt,
  };
}

function checkpointInvariant(operation: string, detail: string, cause?: unknown) {
  return new CheckpointInvariantError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function normalizePathForGit(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = nodePath.relative(root, candidate);
  return relative.length === 0 || (!relative.startsWith("..") && !nodePath.isAbsolute(relative));
}

function wholeFileUnifiedDiff(input: {
  readonly filePath: string;
  readonly before: string | null;
  readonly after: string | null;
}): string {
  if (input.before === input.after) {
    return "";
  }

  const beforeLines = input.before === null ? [] : input.before.split("\n");
  const afterLines = input.after === null ? [] : input.after.split("\n");
  if (beforeLines.at(-1) === "") beforeLines.pop();
  if (afterLines.at(-1) === "") afterLines.pop();

  const oldPath = input.before === null ? "/dev/null" : `a/${input.filePath}`;
  const newPath = input.after === null ? "/dev/null" : `b/${input.filePath}`;
  const header = [
    `diff --git a/${input.filePath} b/${input.filePath}`,
    input.before === null ? "new file mode 100644" : null,
    input.after === null ? "deleted file mode 100644" : null,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -1,${Math.max(beforeLines.length, 1)} +1,${Math.max(afterLines.length, 1)} @@`,
  ].filter((line): line is string => line !== null);
  const body = [...beforeLines.map((line) => `-${line}`), ...afterLines.map((line) => `+${line}`)];
  return [...header, ...body, ""].join("\n");
}

const makeCheckpointStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsProcess = yield* VcsProcess;
  const config = yield* ServerConfig;

  const mapPlatformError = (operation: string, detail: string) =>
    Effect.mapError((error: unknown) => checkpointInvariant(operation, detail, error));

  const tryPromise = <A>(
    operation: string,
    detail: string,
    evaluate: () => Promise<A>,
  ): Effect.Effect<A, CheckpointInvariantError> =>
    Effect.tryPromise({
      try: evaluate,
      catch: (error) => checkpointInvariant(operation, detail, error),
    });

  const git = (input: {
    readonly operation: string;
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly env?: NodeJS.ProcessEnv;
    readonly allowNonZeroExit?: boolean;
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly truncateOutputAtMaxBytes?: boolean;
  }): Effect.Effect<VcsProcessOutput, CheckpointStoreError> =>
    vcsProcess.run({
      operation: input.operation,
      command: "git",
      cwd: input.cwd,
      args: input.args,
      ...(input.env !== undefined ? { env: input.env } : {}),
      ...(input.allowNonZeroExit !== undefined ? { allowNonZeroExit: input.allowNonZeroExit } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      ...(input.truncateOutputAtMaxBytes !== undefined
        ? { truncateOutputAtMaxBytes: input.truncateOutputAtMaxBytes }
        : {}),
    });

  const runStrategyGit = (
    strategy: GitStrategy,
    input: {
      readonly operation: string;
      readonly args: ReadonlyArray<string>;
      readonly env?: NodeJS.ProcessEnv;
      readonly allowNonZeroExit?: boolean;
      readonly timeoutMs?: number;
      readonly maxOutputBytes?: number;
      readonly truncateOutputAtMaxBytes?: boolean;
    },
  ) =>
    git({
      operation: input.operation,
      cwd: strategy.cwd,
      args:
        strategy.kind === "shadow-git"
          ? [`--git-dir=${strategy.gitDir}`, `--work-tree=${strategy.cwd}`, ...input.args]
          : input.args,
      ...(input.env !== undefined ? { env: input.env } : {}),
      ...(input.allowNonZeroExit !== undefined ? { allowNonZeroExit: input.allowNonZeroExit } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      ...(input.truncateOutputAtMaxBytes !== undefined
        ? { truncateOutputAtMaxBytes: input.truncateOutputAtMaxBytes }
        : {}),
    });

  const hasSystemGit = (cwd: string) =>
    git({
      operation: "CheckpointStore.hasSystemGit",
      cwd,
      args: ["--version"],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => result.exitCode === 0),
      Effect.catch(() => Effect.succeed(false)),
    );

  const isInsideNativeGitWorktree = (cwd: string) =>
    git({
      operation: "CheckpointStore.isInsideNativeGitWorktree",
      cwd,
      args: ["rev-parse", "--is-inside-work-tree"],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => result.exitCode === 0 && result.stdout.trim() === "true"),
      Effect.catch(() => Effect.succeed(false)),
    );

  const resolveNativeRepoRoot = (cwd: string) =>
    git({
      operation: "CheckpointStore.resolveNativeRepoRoot",
      cwd,
      args: ["rev-parse", "--show-toplevel"],
    }).pipe(Effect.map((result) => result.stdout.trim() || cwd));

  const shadowGitDirForProject = (projectRoot: string) => {
    const hash = createHash("sha256")
      .update(nodePath.resolve(projectRoot))
      .digest("hex")
      .slice(0, 16);
    return nodePath.join(config.stateDir, SHADOW_CHECKPOINT_DIR_NAME, hash, SHADOW_GIT_DIR_NAME);
  };

  const ensureShadowRepo = Effect.fn("CheckpointStore.ensureShadowRepo")(function* (
    projectRoot: string,
  ) {
    const gitDir = shadowGitDirForProject(projectRoot);
    const shadowRoot = nodePath.dirname(gitDir);
    yield* fs
      .makeDirectory(shadowRoot, { recursive: true })
      .pipe(
        mapPlatformError(
          "CheckpointStore.ensureShadowRepo",
          "Failed to create shadow checkpoint dir.",
        ),
      );

    if (!(yield* fs.exists(gitDir))) {
      yield* git({
        operation: "CheckpointStore.ensureShadowRepo",
        cwd: projectRoot,
        args: ["init", "--bare", gitDir],
      });

      const configValue = (key: string, value: string) =>
        git({
          operation: "CheckpointStore.ensureShadowRepo",
          cwd: projectRoot,
          args: [`--git-dir=${gitDir}`, "config", key, value],
        });
      yield* configValue("core.bare", "false");
      yield* configValue("core.worktree", projectRoot);
      yield* configValue("user.name", "T3 Code");
      yield* configValue("user.email", "t3code@users.noreply.github.com");

      const excludesPath = nodePath.join(gitDir, "info", "exclude");
      yield* fs
        .makeDirectory(nodePath.dirname(excludesPath), { recursive: true })
        .pipe(
          mapPlatformError(
            "CheckpointStore.ensureShadowRepo",
            "Failed to create shadow checkpoint exclude dir.",
          ),
        );
      yield* fs
        .writeFileString(excludesPath, `${DEFAULT_SHADOW_EXCLUDES}\n`)
        .pipe(
          mapPlatformError(
            "CheckpointStore.ensureShadowRepo",
            "Failed to write shadow checkpoint exclude file.",
          ),
        );
    }

    return {
      kind: "shadow-git",
      cwd: projectRoot,
      gitDir,
      canRestoreHead: false,
    } satisfies GitStrategy;
  });

  const ensureIsomorphicRepo = Effect.fn("CheckpointStore.ensureIsomorphicRepo")(function* (
    projectRoot: string,
  ) {
    const gitDir = shadowGitDirForProject(projectRoot);
    yield* fs
      .makeDirectory(gitDir, { recursive: true })
      .pipe(
        mapPlatformError(
          "CheckpointStore.ensureIsomorphicRepo",
          "Failed to create isomorphic checkpoint dir.",
        ),
      );
    yield* tryPromise(
      "CheckpointStore.ensureIsomorphicRepo",
      "Failed to initialize isomorphic checkpoint repository.",
      () => isoGit.init({ fs: nodeFs, dir: projectRoot, gitdir: gitDir, defaultBranch: "main" }),
    );
    return {
      kind: "isomorphic",
      cwd: projectRoot,
      gitDir,
      canRestoreHead: false,
    } satisfies CheckpointStrategy;
  });

  const detectStrategy = Effect.fn("CheckpointStore.detectStrategy")(function* (cwd: string) {
    const projectRoot = nodePath.resolve(cwd);
    if (yield* hasSystemGit(projectRoot)) {
      if (yield* isInsideNativeGitWorktree(projectRoot)) {
        return {
          kind: "conductor",
          cwd: yield* resolveNativeRepoRoot(projectRoot),
          canRestoreHead: true,
        } satisfies CheckpointStrategy;
      }
      return yield* ensureShadowRepo(projectRoot);
    }
    return yield* ensureIsomorphicRepo(projectRoot);
  });

  const withNestedGitDisabled = <A, E, R>(
    strategy: CheckpointStrategy,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CheckpointInvariantError, R> => {
    if (strategy.kind === "conductor") {
      return effect;
    }

    const operation = "CheckpointStore.withNestedGitDisabled";
    return Effect.acquireUseRelease(
      tryPromise(operation, "Failed to disable nested git repositories.", async () => {
        const nested = await findNestedGitPaths(strategy.cwd);
        const renamed: Array<{ from: string; to: string }> = [];
        for (const gitPath of nested) {
          const disabledPath = await nextDisabledGitPath(gitPath);
          await nodeFsPromises.rename(gitPath, disabledPath);
          renamed.push({ from: gitPath, to: disabledPath });
        }
        return renamed;
      }),
      () => effect,
      (renamed) =>
        tryPromise(operation, "Failed to restore nested git repositories.", async () => {
          for (const entry of renamed.toReversed()) {
            await nodeFsPromises.rename(entry.to, entry.from).catch(() => undefined);
          }
        }).pipe(Effect.ignore),
    );
  };

  async function nextDisabledGitPath(gitPath: string): Promise<string> {
    const preferred = `${gitPath}_disabled`;
    if (!(await existsOnDisk(preferred))) {
      return preferred;
    }
    return `${preferred}_${randomUUID()}`;
  }

  async function existsOnDisk(filePath: string): Promise<boolean> {
    return nodeFsPromises
      .access(filePath)
      .then(() => true)
      .catch(() => false);
  }

  async function findNestedGitPaths(root: string): Promise<string[]> {
    const results: string[] = [];
    const resolvedRoot = nodePath.resolve(root);

    async function visit(directory: string): Promise<void> {
      let entries: nodeFs.Dirent[];
      try {
        entries = await nodeFsPromises.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = nodePath.join(directory, entry.name);
        if (entry.name === ".git") {
          if (nodePath.resolve(fullPath) !== nodePath.join(resolvedRoot, ".git")) {
            results.push(fullPath);
          }
          continue;
        }
        if (!entry.isDirectory() || SHADOW_SCAN_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await visit(fullPath);
      }
    }

    await visit(resolvedRoot);
    return results;
  }

  async function listWorkspaceFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const resolvedRoot = nodePath.resolve(root);

    async function visit(directory: string): Promise<void> {
      let entries: nodeFs.Dirent[];
      try {
        entries = await nodeFsPromises.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (SHADOW_SCAN_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        const fullPath = nodePath.join(directory, entry.name);
        const relativePath = normalizePathForGit(nodePath.relative(resolvedRoot, fullPath));
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }
        if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    }

    await visit(resolvedRoot);
    return files.toSorted((left, right) => left.localeCompare(right));
  }

  const resolveHeadCommit = (strategy: GitStrategy) =>
    runStrategyGit(strategy, {
      operation: "CheckpointStore.resolveHeadCommit",
      args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.exitCode !== 0) {
          return null;
        }
        const commit = result.stdout.trim();
        return commit.length > 0 ? commit : null;
      }),
    );

  const hasHeadCommit = (strategy: GitStrategy) =>
    runStrategyGit(strategy, {
      operation: "CheckpointStore.hasHeadCommit",
      args: ["rev-parse", "--verify", "HEAD"],
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => result.exitCode === 0));

  const resolveCheckpointCommitGit = (strategy: GitStrategy, checkpointRef: CheckpointRef) =>
    runStrategyGit(strategy, {
      operation: "CheckpointStore.resolveCheckpointCommit",
      args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.exitCode !== 0) {
          return null;
        }
        const commit = result.stdout.trim();
        return commit.length > 0 ? commit : null;
      }),
    );

  const readCheckpointGitMetadata = (strategy: GitStrategy, commitOid: string) =>
    runStrategyGit(strategy, {
      operation: "CheckpointStore.readCheckpointGitMetadata",
      args: ["cat-file", "commit", commitOid],
    }).pipe(Effect.map((result) => parseCheckpointGitMetadata(result.stdout)));

  const resolveCheckpointCommitIso = (
    strategy: Extract<CheckpointStrategy, { kind: "isomorphic" }>,
    checkpointRef: CheckpointRef,
  ) =>
    tryPromise(
      "CheckpointStore.resolveCheckpointCommitIso",
      "Failed to resolve isomorphic checkpoint ref.",
      () =>
        isoGit.resolveRef({
          fs: nodeFs,
          dir: strategy.cwd,
          gitdir: strategy.gitDir,
          ref: checkpointRef,
        }),
    ).pipe(Effect.catch(() => Effect.succeed(null)));

  const readCheckpointIsoMetadata = (
    strategy: Extract<CheckpointStrategy, { kind: "isomorphic" }>,
    commitOid: string,
  ) =>
    tryPromise(
      "CheckpointStore.readCheckpointIsoMetadata",
      "Failed to read isomorphic checkpoint.",
      async () => {
        const commit = await isoGit.readCommit({
          fs: nodeFs,
          dir: strategy.cwd,
          gitdir: strategy.gitDir,
          oid: commitOid,
        });
        return parseCheckpointMessage(commit.commit.message);
      },
    );

  const resolveCheckpointWorktreeTree = (input: {
    readonly strategy: CheckpointStrategy;
    readonly checkpointRef: CheckpointRef;
  }) =>
    Effect.gen(function* () {
      if (input.strategy.kind === "isomorphic") {
        const commitOid = yield* resolveCheckpointCommitIso(input.strategy, input.checkpointRef);
        if (!commitOid) return null;
        const metadata = yield* readCheckpointIsoMetadata(input.strategy, commitOid);
        return metadata?.worktreeTree ?? commitOid;
      }

      const commitOid = yield* resolveCheckpointCommitGit(input.strategy, input.checkpointRef);
      if (!commitOid) return null;
      const metadata = yield* readCheckpointGitMetadata(input.strategy, commitOid);
      return metadata?.worktreeTree ?? commitOid;
    });

  const captureGitCheckpoint = Effect.fn("CheckpointStore.captureGitCheckpoint")(function* (input: {
    readonly strategy: GitStrategy;
    readonly checkpointRef: CheckpointRef;
  }) {
    const operation = "CheckpointStore.captureCheckpoint";
    yield* withNestedGitDisabled(
      input.strategy,
      Effect.acquireUseRelease(
        fs.makeTempDirectory({ prefix: "t3-fs-checkpoint-" }),
        Effect.fn("captureGitCheckpoint.withTempDirectory")(function* (tempDir) {
          const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
          const now = DateTime.formatIso(yield* DateTime.now);
          const commitEnv: NodeJS.ProcessEnv = {
            ...globalThis.process.env,
            GIT_AUTHOR_NAME: "T3 Code",
            GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
            GIT_COMMITTER_NAME: "T3 Code",
            GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
            GIT_AUTHOR_DATE: now,
            GIT_COMMITTER_DATE: now,
          };

          const headOid = input.strategy.canRestoreHead
            ? ((yield* resolveHeadCommit(input.strategy)) ?? ZERO_OID)
            : ZERO_OID;

          if (input.strategy.kind === "shadow-git") {
            yield* runStrategyGit(input.strategy, {
              operation,
              args: ["add", "-A", "--", "."],
              env: commitEnv,
            });
          }

          const indexTreeResult = yield* runStrategyGit(input.strategy, {
            operation,
            args: ["write-tree"],
            env: commitEnv,
          });
          const indexTree = indexTreeResult.stdout.trim();
          if (indexTree.length === 0) {
            return yield* new VcsProcessExitError({
              operation,
              command: "git write-tree",
              cwd: input.strategy.cwd,
              exitCode: 0,
              detail: "git write-tree returned an empty index tree oid.",
            });
          }

          const tempIndexEnv: NodeJS.ProcessEnv = {
            ...commitEnv,
            GIT_INDEX_FILE: tempIndexPath,
          };
          if (headOid !== ZERO_OID) {
            yield* runStrategyGit(input.strategy, {
              operation,
              args: ["read-tree", "HEAD"],
              env: tempIndexEnv,
            });
          }

          yield* runStrategyGit(input.strategy, {
            operation,
            args: ["add", "-A", "--", "."],
            env: tempIndexEnv,
          });

          const writeTreeResult = yield* runStrategyGit(input.strategy, {
            operation,
            args: ["write-tree"],
            env: tempIndexEnv,
          });
          const worktreeTree = writeTreeResult.stdout.trim();
          if (worktreeTree.length === 0) {
            return yield* new VcsProcessExitError({
              operation,
              command: "git write-tree",
              cwd: input.strategy.cwd,
              exitCode: 0,
              detail: "git write-tree returned an empty worktree tree oid.",
            });
          }

          const message = [
            `t3 checkpoint ref=${input.checkpointRef}`,
            `head ${headOid}`,
            `index-tree ${indexTree}`,
            `worktree-tree ${worktreeTree}`,
            `created ${now}`,
          ].join("\n");
          const commitTreeResult = yield* runStrategyGit(input.strategy, {
            operation,
            args: ["commit-tree", worktreeTree, "-m", message],
            env: commitEnv,
          });
          const commitOid = commitTreeResult.stdout.trim();
          if (commitOid.length === 0) {
            return yield* new VcsProcessExitError({
              operation,
              command: "git commit-tree",
              cwd: input.strategy.cwd,
              exitCode: 0,
              detail: "git commit-tree returned an empty commit oid.",
            });
          }

          yield* runStrategyGit(input.strategy, {
            operation,
            args: ["update-ref", input.checkpointRef, commitOid],
          });
        }),
        (tempDir) => fs.remove(tempDir, { recursive: true }),
      ),
    ).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            checkpointInvariant(
              "CheckpointStore.captureCheckpoint",
              "Failed to capture checkpoint.",
              error,
            ),
          ),
      }),
    );
  });

  const captureIsomorphicCheckpoint = Effect.fn("CheckpointStore.captureIsomorphicCheckpoint")(
    function* (input: {
      readonly strategy: Extract<CheckpointStrategy, { kind: "isomorphic" }>;
      readonly checkpointRef: CheckpointRef;
    }) {
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* withNestedGitDisabled(
        input.strategy,
        tryPromise(
          "CheckpointStore.captureIsomorphicCheckpoint",
          "Failed to capture isomorphic checkpoint.",
          async () => {
            const files = await listWorkspaceFiles(input.strategy.cwd);
            const indexedFiles = await isoGit.listFiles({
              fs: nodeFs,
              dir: input.strategy.cwd,
              gitdir: input.strategy.gitDir,
            });
            const fileSet = new Set(files);
            for (const indexedFile of indexedFiles) {
              if (!fileSet.has(indexedFile)) {
                await isoGit.remove({
                  fs: nodeFs,
                  dir: input.strategy.cwd,
                  gitdir: input.strategy.gitDir,
                  filepath: indexedFile,
                });
              }
            }
            if (files.length > 0) {
              await isoGit.add({
                fs: nodeFs,
                dir: input.strategy.cwd,
                gitdir: input.strategy.gitDir,
                filepath: files,
                parallel: true,
              });
            }

            const commitOid = await isoGit.commit({
              fs: nodeFs,
              dir: input.strategy.cwd,
              gitdir: input.strategy.gitDir,
              message: [
                `t3 checkpoint ref=${input.checkpointRef}`,
                `head ${ZERO_OID}`,
                `index-tree ${ZERO_OID}`,
                `worktree-tree ${ZERO_OID}`,
                `created ${now}`,
              ].join("\n"),
              author: { name: "T3 Code", email: "t3code@users.noreply.github.com" },
              committer: { name: "T3 Code", email: "t3code@users.noreply.github.com" },
              noUpdateBranch: true,
            });
            await isoGit.writeRef({
              fs: nodeFs,
              dir: input.strategy.cwd,
              gitdir: input.strategy.gitDir,
              ref: input.checkpointRef,
              value: commitOid,
              force: true,
            });
            await isoGit.writeRef({
              fs: nodeFs,
              dir: input.strategy.cwd,
              gitdir: input.strategy.gitDir,
              ref: `${ISO_SNAPSHOT_REF_PREFIX}/${commitOid}`,
              value: commitOid,
              force: true,
            });
          },
        ),
      );
    },
  );

  const isGitRepository: CheckpointStoreShape["isGitRepository"] = (cwd) =>
    isInsideNativeGitWorktree(cwd);

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const strategy = yield* detectStrategy(input.cwd);
      if (strategy.kind === "isomorphic") {
        return yield* captureIsomorphicCheckpoint({ strategy, checkpointRef: input.checkpointRef });
      }
      return yield* captureGitCheckpoint({ strategy, checkpointRef: input.checkpointRef });
    }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            checkpointInvariant(
              "CheckpointStore.captureCheckpoint",
              "Failed to capture checkpoint.",
              error,
            ),
          ),
      }),
    );

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = (input) =>
    Effect.gen(function* () {
      const strategy = yield* detectStrategy(input.cwd);
      if (strategy.kind === "isomorphic") {
        return (yield* resolveCheckpointCommitIso(strategy, input.checkpointRef)) !== null;
      }
      return (yield* resolveCheckpointCommitGit(strategy, input.checkpointRef)) !== null;
    }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            checkpointInvariant(
              "CheckpointStore.hasCheckpointRef",
              "Failed to inspect checkpoint ref.",
              error,
            ),
          ),
      }),
    );

  const restoreCheckpoint: CheckpointStoreShape["restoreCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.restoreCheckpoint";
      const strategy = yield* detectStrategy(input.cwd);

      if (strategy.kind === "isomorphic") {
        let commitOid = yield* resolveCheckpointCommitIso(strategy, input.checkpointRef);
        if (!commitOid && input.fallbackToHead === true) {
          commitOid = yield* resolveCheckpointCommitIso(
            strategy,
            CheckpointRef.make(`${ISO_SNAPSHOT_REF_PREFIX}/HEAD`),
          );
        }
        if (!commitOid) return false;

        yield* withNestedGitDisabled(
          strategy,
          tryPromise(operation, "Failed to restore isomorphic checkpoint.", async () => {
            const trackedFiles = await isoGit.listFiles({
              fs: nodeFs,
              dir: strategy.cwd,
              gitdir: strategy.gitDir,
              ref: commitOid,
            });
            const trackedSet = new Set(trackedFiles);
            for (const file of await listWorkspaceFiles(strategy.cwd)) {
              if (!trackedSet.has(file)) {
                const target = nodePath.resolve(strategy.cwd, file);
                if (isPathInside(strategy.cwd, target)) {
                  await nodeFsPromises.rm(target, { force: true, recursive: true });
                }
              }
            }
            await isoGit.checkout({
              fs: nodeFs,
              dir: strategy.cwd,
              gitdir: strategy.gitDir,
              ref: commitOid,
              force: true,
              noUpdateHead: true,
            });
          }),
        );
        return true;
      }

      let commitOid = yield* resolveCheckpointCommitGit(strategy, input.checkpointRef);
      if (!commitOid && input.fallbackToHead === true && strategy.canRestoreHead) {
        commitOid = yield* resolveHeadCommit(strategy);
      }
      if (!commitOid) return false;

      const metadata = yield* readCheckpointGitMetadata(strategy, commitOid);
      if (metadata) {
        if (strategy.canRestoreHead) {
          if (metadata.headOid === ZERO_OID) {
            return false;
          }
          yield* runStrategyGit(strategy, {
            operation,
            args: ["reset", "--hard", metadata.headOid],
          });
        }

        yield* withNestedGitDisabled(
          strategy,
          Effect.gen(function* () {
            yield* runStrategyGit(strategy, {
              operation,
              args: ["read-tree", "--reset", "-u", metadata.worktreeTree],
            });
            yield* runStrategyGit(strategy, {
              operation,
              args: ["clean", "-fd", "--", "."],
            });
            yield* runStrategyGit(strategy, {
              operation,
              args: ["read-tree", "--reset", metadata.indexTree],
            });
          }),
        );
        return true;
      }

      yield* runStrategyGit(strategy, {
        operation,
        args: ["restore", "--source", commitOid, "--worktree", "--staged", "--", "."],
      });
      yield* runStrategyGit(strategy, {
        operation,
        args: ["clean", "-fd", "--", "."],
      });

      if (strategy.canRestoreHead && (yield* hasHeadCommit(strategy))) {
        yield* runStrategyGit(strategy, {
          operation,
          args: ["reset", "--quiet", "--", "."],
        });
      }

      return true;
    }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            checkpointInvariant(
              "CheckpointStore.restoreCheckpoint",
              "Failed to restore checkpoint.",
              error,
            ),
          ),
      }),
    );

  const diffIsomorphicCheckpoints = Effect.fn("CheckpointStore.diffIsomorphicCheckpoints")(
    function* (input: {
      readonly strategy: Extract<CheckpointStrategy, { kind: "isomorphic" }>;
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
    }) {
      return yield* tryPromise(
        "CheckpointStore.diffIsomorphicCheckpoints",
        "Failed to diff isomorphic checkpoints.",
        async () => {
          const fromCommit = await isoGit.resolveRef({
            fs: nodeFs,
            dir: input.strategy.cwd,
            gitdir: input.strategy.gitDir,
            ref: input.fromCheckpointRef,
          });
          const toCommit = await isoGit.resolveRef({
            fs: nodeFs,
            dir: input.strategy.cwd,
            gitdir: input.strategy.gitDir,
            ref: input.toCheckpointRef,
          });
          const [fromFiles, toFiles] = await Promise.all([
            isoGit.listFiles({
              fs: nodeFs,
              dir: input.strategy.cwd,
              gitdir: input.strategy.gitDir,
              ref: fromCommit,
            }),
            isoGit.listFiles({
              fs: nodeFs,
              dir: input.strategy.cwd,
              gitdir: input.strategy.gitDir,
              ref: toCommit,
            }),
          ]);
          const allFiles = [...new Set([...fromFiles, ...toFiles])].toSorted((left, right) =>
            left.localeCompare(right),
          );
          const patches: string[] = [];
          for (const filePath of allFiles) {
            const before = fromFiles.includes(filePath)
              ? Buffer.from(
                  (
                    await isoGit.readBlob({
                      fs: nodeFs,
                      dir: input.strategy.cwd,
                      gitdir: input.strategy.gitDir,
                      oid: fromCommit,
                      filepath: filePath,
                    })
                  ).blob,
                ).toString("utf8")
              : null;
            const after = toFiles.includes(filePath)
              ? Buffer.from(
                  (
                    await isoGit.readBlob({
                      fs: nodeFs,
                      dir: input.strategy.cwd,
                      gitdir: input.strategy.gitDir,
                      oid: toCommit,
                      filepath: filePath,
                    })
                  ).blob,
                ).toString("utf8")
              : null;
            const patch = wholeFileUnifiedDiff({ filePath, before, after });
            if (patch.length > 0) patches.push(patch);
          }
          return patches.join("\n");
        },
      );
    },
  );

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.diffCheckpoints";
      const strategy = yield* detectStrategy(input.cwd);

      if (strategy.kind === "isomorphic") {
        return yield* diffIsomorphicCheckpoints({
          strategy,
          fromCheckpointRef: input.fromCheckpointRef,
          toCheckpointRef: input.toCheckpointRef,
        });
      }

      let fromTree = yield* resolveCheckpointWorktreeTree({
        strategy,
        checkpointRef: input.fromCheckpointRef,
      });
      const toTree = yield* resolveCheckpointWorktreeTree({
        strategy,
        checkpointRef: input.toCheckpointRef,
      });

      if (!fromTree && input.fallbackFromToHead === true && strategy.canRestoreHead) {
        const headCommit = yield* resolveHeadCommit(strategy);
        if (headCommit) {
          fromTree = headCommit;
        }
      }

      if (!fromTree || !toTree) {
        return yield* new VcsProcessExitError({
          operation,
          command: "git diff",
          cwd: strategy.cwd,
          exitCode: 1,
          detail: "Checkpoint ref is unavailable for diff operation.",
        });
      }

      const diffArgs = [
        "diff",
        "--patch",
        "--minimal",
        "--no-color",
        ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
        fromTree,
        toTree,
      ];
      const result = yield* runStrategyGit(strategy, {
        operation,
        args: diffArgs,
        maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
      });
      return result.stdout;
    }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            checkpointInvariant(
              "CheckpointStore.diffCheckpoints",
              "Failed to diff checkpoints.",
              error,
            ),
          ),
      }),
    );

  const deleteCheckpointRefs: CheckpointStoreShape["deleteCheckpointRefs"] = (input) =>
    Effect.gen(function* () {
      const strategy = yield* detectStrategy(input.cwd);
      if (strategy.kind === "isomorphic") {
        yield* Effect.forEach(
          input.checkpointRefs,
          (checkpointRef) =>
            tryPromise(
              "CheckpointStore.deleteCheckpointRefs",
              "Failed to delete isomorphic checkpoint ref.",
              () =>
                isoGit.deleteRef({
                  fs: nodeFs,
                  dir: strategy.cwd,
                  gitdir: strategy.gitDir,
                  ref: checkpointRef,
                }),
            ).pipe(Effect.ignore),
          { discard: true },
        );
        return;
      }

      yield* Effect.forEach(
        input.checkpointRefs,
        (checkpointRef) =>
          runStrategyGit(strategy, {
            operation: "CheckpointStore.deleteCheckpointRefs",
            args: ["update-ref", "-d", checkpointRef],
            allowNonZeroExit: true,
          }),
        { discard: true },
      );
    }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            checkpointInvariant(
              "CheckpointStore.deleteCheckpointRefs",
              "Failed to delete checkpoint refs.",
              error,
            ),
          ),
      }),
    );

  return {
    isGitRepository,
    captureCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    deleteCheckpointRefs,
  } satisfies CheckpointStoreShape;
});

export const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore);
