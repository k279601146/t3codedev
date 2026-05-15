/**
 * ShadowGitCheckpoints - Checkpoint operations for non-git workspaces.
 *
 * When the target workspace is not a git repository, this module provides
 * checkpoint capture/restore/diff by maintaining an isolated "shadow" git
 * repository under `~/.bahew/checkpoints/{cwdHash}/`. The shadow repo uses
 * `--git-dir` and `--work-tree` to operate on the user's project files
 * without polluting the project directory.
 *
 * @module ShadowGitCheckpoints
 */
import { createHash, randomUUID } from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { VcsProcessExitError, VcsProcessSpawnError, type VcsError } from "@t3tools/contracts";
import type { VcsCheckpointOps } from "../../vcs/VcsDriver.ts";
import { VcsProcess, type VcsProcessOutput } from "../../vcs/VcsProcess.ts";
import { ServerConfig } from "../../config.ts";

const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;

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
  "target/",
  "*.lock",
].join("\n");

export interface ShadowGitCheckpointsShape {
  readonly resolve: (cwd: string) => Effect.Effect<VcsCheckpointOps, VcsError>;
}

export class ShadowGitCheckpoints extends Context.Service<
  ShadowGitCheckpoints,
  ShadowGitCheckpointsShape
>()("t3/checkpointing/ShadowGitCheckpoints") {}

function cwdHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

export const make = Effect.gen(function* () {
  const vcsProcess = yield* VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  const checkpointsBaseDir = pathService.join(serverConfig.baseDir, "checkpoints");

  function shadowGitDir(cwd: string): string {
    return pathService.join(checkpointsBaseDir, cwdHash(cwd), ".git");
  }

  function gitShadow(
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: {
      env?: NodeJS.ProcessEnv;
      allowNonZeroExit?: boolean;
      maxOutputBytes?: number;
    },
  ): Effect.Effect<VcsProcessOutput, VcsError> {
    const gitDir = shadowGitDir(cwd);
    return vcsProcess.run({
      operation,
      command: "git",
      args: [`--git-dir=${gitDir}`, `--work-tree=${cwd}`, ...args],
      cwd,
      spawnCwd: cwd,
      ...(options?.env !== undefined ? { env: options.env } : {}),
      ...(options?.allowNonZeroExit !== undefined
        ? { allowNonZeroExit: options.allowNonZeroExit }
        : {}),
      ...(options?.maxOutputBytes !== undefined
        ? { maxOutputBytes: options.maxOutputBytes }
        : {}),
    });
  }

  const ensureShadowRepo = Effect.fn("ShadowGitCheckpoints.ensureShadowRepo")(function* (
    cwd: string,
  ) {
    const gitDir = shadowGitDir(cwd);
    const exists = yield* fileSystem.exists(gitDir).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      return;
    }

    const repoDir = pathService.dirname(gitDir);
    yield* fileSystem.makeDirectory(repoDir, { recursive: true });

    yield* vcsProcess.run({
      operation: "ShadowGitCheckpoints.init",
      command: "git",
      args: ["init", "--bare", gitDir],
      cwd: repoDir,
      spawnCwd: repoDir,
    });

    yield* gitShadow("ShadowGitCheckpoints.config.worktree", cwd, [
      "config", "core.worktree", cwd,
    ]);
    yield* gitShadow("ShadowGitCheckpoints.config.user.name", cwd, [
      "config", "user.name", "T3 Checkpointer",
    ]);
    yield* gitShadow("ShadowGitCheckpoints.config.user.email", cwd, [
      "config", "user.email", "checkpointer@noreply",
    ]);

    const excludesDir = pathService.join(gitDir, "info");
    yield* fileSystem.makeDirectory(excludesDir, { recursive: true });
    yield* fileSystem.writeFileString(
      pathService.join(excludesDir, "exclude"),
      DEFAULT_EXCLUDES,
    );
  });

  const resolve: ShadowGitCheckpointsShape["resolve"] = (cwd) =>
    Effect.gen(function* () {
      yield* ensureShadowRepo(cwd).pipe(
        Effect.mapError((error) =>
          new VcsProcessSpawnError({
            operation: "ShadowGitCheckpoints.ensureShadowRepo",
            command: "shadow-git-init",
            cwd,
            cause: error,
          }),
        ),
      );

      const checkpoints: VcsCheckpointOps = {
        captureCheckpoint: Effect.fn("ShadowGitCheckpoints.captureCheckpoint")(function* (input) {
          const operation = "ShadowGitCheckpoints.captureCheckpoint";
          const gitDir = shadowGitDir(input.cwd);
          const tempIndexPath = pathService.join(
            pathService.dirname(gitDir),
            `shadow-checkpoint-index-${randomUUID()}`,
          );
          const commitEnv: NodeJS.ProcessEnv = {
            ...process.env,
            GIT_INDEX_FILE: tempIndexPath,
            GIT_AUTHOR_NAME: "T3 Code",
            GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
            GIT_COMMITTER_NAME: "T3 Code",
            GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
          };

          const cleanupTempIndex = fileSystem
            .remove(tempIndexPath, { force: true })
            .pipe(Effect.ignore);

          yield* Effect.gen(function* () {
            yield* gitShadow(operation, input.cwd, ["add", "-A", "--", "."], {
              env: commitEnv,
            });

            const writeTreeResult = yield* gitShadow(
              operation,
              input.cwd,
              ["write-tree"],
              { env: commitEnv },
            );
            const treeOid = writeTreeResult.stdout.trim();
            if (treeOid.length === 0) {
              return yield* new VcsProcessExitError({
                operation,
                command: "git write-tree",
                cwd: input.cwd,
                exitCode: 0,
                detail: "git write-tree returned an empty tree oid.",
              });
            }

            const message = `t3 checkpoint ref=${input.checkpointRef}`;
            const commitTreeResult = yield* gitShadow(
              operation,
              input.cwd,
              ["commit-tree", treeOid, "-m", message],
              { env: commitEnv },
            );
            const commitOid = commitTreeResult.stdout.trim();
            if (commitOid.length === 0) {
              return yield* new VcsProcessExitError({
                operation,
                command: "git commit-tree",
                cwd: input.cwd,
                exitCode: 0,
                detail: "git commit-tree returned an empty commit oid.",
              });
            }

            yield* gitShadow(operation, input.cwd, [
              "update-ref",
              input.checkpointRef,
              commitOid,
            ]);
          }).pipe(Effect.ensuring(cleanupTempIndex));
        }),

        hasCheckpointRef: (input) =>
          gitShadow(
            "ShadowGitCheckpoints.hasCheckpointRef",
            input.cwd,
            ["rev-parse", "--quiet", "--verify", input.checkpointRef],
            { allowNonZeroExit: true },
          ).pipe(Effect.map((result) => result.exitCode === 0)),

        restoreCheckpoint: Effect.fn("ShadowGitCheckpoints.restoreCheckpoint")(function* (input) {
          const operation = "ShadowGitCheckpoints.restoreCheckpoint";

          const verifyResult = yield* gitShadow(operation, input.cwd, [
            "rev-parse", "--quiet", "--verify", input.checkpointRef,
          ], { allowNonZeroExit: true });

          let commitRef: string | null =
            verifyResult.exitCode === 0 ? input.checkpointRef : null;

          if (!commitRef && input.fallbackToHead === true) {
            const headResult = yield* gitShadow(operation, input.cwd, [
              "rev-parse", "--quiet", "--verify", "HEAD",
            ], { allowNonZeroExit: true });
            if (headResult.exitCode === 0) {
              commitRef = headResult.stdout.trim();
            }
          }

          if (!commitRef) {
            return false;
          }

          yield* gitShadow(operation, input.cwd, [
            "restore", "--source", commitRef, "--worktree", "--staged", "--", ".",
          ]);
          yield* gitShadow(operation, input.cwd, ["clean", "-fd", "--", "."]);

          return true;
        }),

        diffCheckpoints: Effect.fn("ShadowGitCheckpoints.diffCheckpoints")(function* (input) {
          const operation = "ShadowGitCheckpoints.diffCheckpoints";

          let fromRevision: string = input.fromCheckpointRef;
          if (input.fallbackFromToHead === true) {
            const resolvedFrom = yield* gitShadow(operation, input.cwd, [
              "rev-parse", "--quiet", "--verify", input.fromCheckpointRef,
            ], { allowNonZeroExit: true });
            if (resolvedFrom.exitCode === 0) {
              fromRevision = resolvedFrom.stdout.trim();
            } else {
              const headResult = yield* gitShadow(operation, input.cwd, [
                "rev-parse", "--quiet", "--verify", "HEAD",
              ], { allowNonZeroExit: true });
              if (headResult.exitCode !== 0) {
                return yield* new VcsProcessExitError({
                  operation,
                  command: "git diff",
                  cwd: input.cwd,
                  exitCode: 1,
                  detail: "Checkpoint ref is unavailable for diff operation.",
                });
              }
              fromRevision = headResult.stdout.trim();
            }
          }

          const result = yield* gitShadow(operation, input.cwd, [
            "diff",
            "--patch",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
            `${fromRevision}^{commit}`,
            `${input.toCheckpointRef}^{commit}`,
          ], { allowNonZeroExit: true, maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES });

          if (result.exitCode !== 0) {
            return yield* new VcsProcessExitError({
              operation,
              command: "git diff",
              cwd: input.cwd,
              exitCode: result.exitCode,
              detail: result.stderr.trim() || "Checkpoint ref is unavailable for diff operation.",
            });
          }

          return result.stdout;
        }),

        deleteCheckpointRefs: Effect.fn("ShadowGitCheckpoints.deleteCheckpointRefs")(
          function* (input) {
            yield* Effect.forEach(
              input.checkpointRefs,
              (checkpointRef) =>
                gitShadow(
                  "ShadowGitCheckpoints.deleteCheckpointRefs",
                  input.cwd,
                  ["update-ref", "-d", checkpointRef],
                  { allowNonZeroExit: true },
                ),
              { discard: true },
            );
          },
        ),
      };

      return checkpoints;
    });

  return ShadowGitCheckpoints.of({ resolve });
});

export const layer = Layer.effect(ShadowGitCheckpoints, make);
