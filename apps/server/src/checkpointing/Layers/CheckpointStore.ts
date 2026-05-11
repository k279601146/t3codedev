/**
 * CheckpointStoreLive - Filesystem checkpoint store adapter layer.
 *
 * Implements hidden Git-ref checkpoint capture/restore directly with
 * Effect-native child process execution (`effect/unstable/process`).
 *
 * This layer owns filesystem/Git interactions only; it does not persist
 * checkpoint metadata and does not coordinate provider rollback semantics.
 *
 * @module CheckpointStoreLive
 */
import { randomUUID } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";

import { CheckpointInvariantError } from "../Errors.ts";
import { VcsProcessExitError } from "@t3tools/contracts";
import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointRef } from "@t3tools/contracts";

const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;
const ZERO_OID = "0".repeat(40);

interface CheckpointGitMetadata {
  readonly headOid: string;
  readonly indexTree: string;
  readonly worktreeTree: string;
  readonly createdAt: string;
}

function parseCheckpointGitMetadata(commitObject: string): CheckpointGitMetadata | null {
  const messageStart = commitObject.indexOf("\n\n");
  const message = messageStart === -1 ? commitObject : commitObject.slice(messageStart + 2);
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

const makeCheckpointStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry;
  const vcs = {
    execute: (input: {
      readonly operation: string;
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly stdin?: string;
      readonly env?: NodeJS.ProcessEnv;
      readonly allowNonZeroExit?: boolean;
      readonly timeoutMs?: number;
      readonly maxOutputBytes?: number;
      readonly truncateOutputAtMaxBytes?: boolean;
    }) =>
      vcsRegistry
        .resolve({ cwd: input.cwd, requestedKind: "git" })
        .pipe(Effect.flatMap((handle) => handle.driver.execute(input))),
  };

  const resolveHeadCommit = (cwd: string) =>
    vcs
      .execute({
        operation: "CheckpointStore.resolveHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.exitCode !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const resolveRepoRoot = (cwd: string) =>
    vcs
      .execute({
        operation: "CheckpointStore.resolveRepoRoot",
        cwd,
        args: ["rev-parse", "--show-toplevel"],
      })
      .pipe(Effect.map((result) => result.stdout.trim() || cwd));

  const hasHeadCommit = (cwd: string) =>
    vcs
      .execute({
        operation: "CheckpointStore.hasHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "HEAD"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((result) => result.exitCode === 0));

  const resolveCheckpointCommit = (cwd: string, checkpointRef: CheckpointRef) =>
    vcs
      .execute({
        operation: "CheckpointStore.resolveCheckpointCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.exitCode !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const readCheckpointGitMetadata = (cwd: string, commitOid: string) =>
    vcs
      .execute({
        operation: "CheckpointStore.readCheckpointGitMetadata",
        cwd,
        args: ["cat-file", "commit", commitOid],
      })
      .pipe(Effect.map((result) => parseCheckpointGitMetadata(result.stdout)));

  const resolveCheckpointWorktreeTree = (input: {
    readonly cwd: string;
    readonly checkpointRef: CheckpointRef;
  }) =>
    Effect.gen(function* () {
      const commitOid = yield* resolveCheckpointCommit(input.cwd, input.checkpointRef);
      if (!commitOid) {
        return null;
      }

      const metadata = yield* readCheckpointGitMetadata(input.cwd, commitOid);
      return metadata?.worktreeTree ?? commitOid;
    });

  const isGitRepository: CheckpointStoreShape["isGitRepository"] = (cwd) =>
    vcs
      .execute({
        operation: "CheckpointStore.isGitRepository",
        cwd,
        args: ["rev-parse", "--is-inside-work-tree"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.exitCode === 0 && result.stdout.trim() === "true"),
        Effect.catch(() => Effect.succeed(false)),
      );

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = Effect.fn(
    "captureCheckpoint",
  )(function* (input) {
    const operation = "CheckpointStore.captureCheckpoint";
    const root = yield* resolveRepoRoot(input.cwd);

    yield* Effect.acquireUseRelease(
      fs.makeTempDirectory({ prefix: "t3-fs-checkpoint-" }),
      Effect.fn("captureCheckpoint.withTempDirectory")(function* (tempDir) {
        const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
        const now = DateTime.formatIso(yield* DateTime.now);
        const commitEnv: NodeJS.ProcessEnv = {
          ...process.env,
          GIT_AUTHOR_NAME: "T3 Code",
          GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
          GIT_COMMITTER_NAME: "T3 Code",
          GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
          GIT_AUTHOR_DATE: now,
          GIT_COMMITTER_DATE: now,
        };

        const headOid = (yield* resolveHeadCommit(root)) ?? ZERO_OID;
        const indexTreeResult = yield* vcs.execute({
          operation,
          cwd: root,
          args: ["write-tree"],
          env: commitEnv,
        });
        const indexTree = indexTreeResult.stdout.trim();
        if (indexTree.length === 0) {
          return yield* new VcsProcessExitError({
            operation,
            command: "git write-tree",
            cwd: root,
            exitCode: 0,
            detail: "git write-tree returned an empty index tree oid.",
          });
        }

        const tempIndexEnv: NodeJS.ProcessEnv = {
          ...commitEnv,
          GIT_INDEX_FILE: tempIndexPath,
        };

        const headExists = headOid !== ZERO_OID;
        if (headExists) {
          yield* vcs.execute({
            operation,
            cwd: root,
            args: ["read-tree", "HEAD"],
            env: tempIndexEnv,
          });
        }

        yield* vcs.execute({
          operation,
          cwd: root,
          args: ["add", "-A", "--", "."],
          env: tempIndexEnv,
        });

        const writeTreeResult = yield* vcs.execute({
          operation,
          cwd: root,
          args: ["write-tree"],
          env: tempIndexEnv,
        });
        const worktreeTree = writeTreeResult.stdout.trim();
        if (worktreeTree.length === 0) {
          return yield* new VcsProcessExitError({
            operation,
            command: "git write-tree",
            cwd: root,
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
        const commitTreeResult = yield* vcs.execute({
          operation,
          cwd: root,
          args: ["commit-tree", worktreeTree, "-m", message],
          env: commitEnv,
        });
        const commitOid = commitTreeResult.stdout.trim();
        if (commitOid.length === 0) {
          return yield* new VcsProcessExitError({
            operation,
            command: "git commit-tree",
            cwd: root,
            exitCode: 0,
            detail: "git commit-tree returned an empty commit oid.",
          });
        }

        yield* vcs.execute({
          operation,
          cwd: root,
          args: ["update-ref", input.checkpointRef, commitOid],
        });
      }),
      (tempDir) => fs.remove(tempDir, { recursive: true }),
    ).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            new CheckpointInvariantError({
              operation: "CheckpointStore.captureCheckpoint",
              detail: "Failed to capture checkpoint.",
              cause: error,
            }),
          ),
      }),
    );
  });

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = (input) =>
    resolveCheckpointCommit(input.cwd, input.checkpointRef).pipe(
      Effect.map((commit) => commit !== null),
    );

  const restoreCheckpoint: CheckpointStoreShape["restoreCheckpoint"] = Effect.fn(
    "restoreCheckpoint",
  )(function* (input) {
    const operation = "CheckpointStore.restoreCheckpoint";
    const root = yield* resolveRepoRoot(input.cwd);

    let commitOid = yield* resolveCheckpointCommit(root, input.checkpointRef);

    if (!commitOid && input.fallbackToHead === true) {
      commitOid = yield* resolveHeadCommit(root);
    }

    if (!commitOid) {
      return false;
    }

    const metadata = yield* readCheckpointGitMetadata(root, commitOid);
    if (metadata) {
      if (metadata.headOid === ZERO_OID) {
        return false;
      }

      yield* vcs.execute({
        operation,
        cwd: root,
        args: ["reset", "--hard", metadata.headOid],
      });
      yield* vcs.execute({
        operation,
        cwd: root,
        args: ["read-tree", "--reset", "-u", metadata.worktreeTree],
      });
      yield* vcs.execute({
        operation,
        cwd: root,
        args: ["clean", "-fd", "--", "."],
      });
      yield* vcs.execute({
        operation,
        cwd: root,
        args: ["read-tree", "--reset", metadata.indexTree],
      });

      return true;
    }

    // Backward compatibility for checkpoint refs produced before the
    // three-layer metadata format: their commit tree is the worktree snapshot,
    // but staged state and HEAD cannot be reconstructed from that old format.
    yield* vcs.execute({
      operation,
      cwd: root,
      args: ["restore", "--source", commitOid, "--worktree", "--staged", "--", "."],
    });
    yield* vcs.execute({
      operation,
      cwd: root,
      args: ["clean", "-fd", "--", "."],
    });

    const headExists = yield* hasHeadCommit(root);
    if (headExists) {
      yield* vcs.execute({
        operation,
        cwd: root,
        args: ["reset", "--quiet", "--", "."],
      });
    }

    return true;
  });

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = Effect.fn("diffCheckpoints")(
    function* (input) {
      const operation = "CheckpointStore.diffCheckpoints";
      const root = yield* resolveRepoRoot(input.cwd);

      let fromTree = yield* resolveCheckpointWorktreeTree({
        cwd: root,
        checkpointRef: input.fromCheckpointRef,
      });
      const toTree = yield* resolveCheckpointWorktreeTree({
        cwd: root,
        checkpointRef: input.toCheckpointRef,
      });

      if (!fromTree && input.fallbackFromToHead === true) {
        const headCommit = yield* resolveHeadCommit(root);
        if (headCommit) {
          fromTree = headCommit;
        }
      }

      if (!fromTree || !toTree) {
        return yield* new VcsProcessExitError({
          operation,
          command: "git diff",
          cwd: root,
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

      const result = yield* vcs.execute({
        operation,
        cwd: root,
        args: diffArgs,
        maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
      });

      return result.stdout;
    },
  );

  const deleteCheckpointRefs: CheckpointStoreShape["deleteCheckpointRefs"] = Effect.fn(
    "deleteCheckpointRefs",
  )(function* (input) {
    const operation = "CheckpointStore.deleteCheckpointRefs";
    const root = yield* resolveRepoRoot(input.cwd);

    yield* Effect.forEach(
      input.checkpointRefs,
      (checkpointRef) =>
        vcs.execute({
          operation,
          cwd: root,
          args: ["update-ref", "-d", checkpointRef],
          allowNonZeroExit: true,
        }),
      { discard: true },
    );
  });

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
