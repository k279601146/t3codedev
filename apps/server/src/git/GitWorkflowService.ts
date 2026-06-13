import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  GitManagerError,
  GitCommandError,
  type VcsSwitchRefInput,
  type VcsSwitchRefResult,
  type VcsCreateRefInput,
  type VcsCreateRefResult,
  type VcsCreateWorktreeInput,
  type VcsCreateWorktreeResult,
  type VcsDiffCommitInput,
  type VcsDiffCommitResult,
  type VcsFileOperationInput,
  type VcsFileOperationResult,
  type VcsDiffWorkingTreeInput,
  type VcsDiffWorkingTreeResult,
  type VcsListCommitsInput,
  type VcsListCommitsResult,
  type VcsListRefsInput,
  type VcsListRefsResult,
  type GitManagerServiceError,
  type GitPreparePullRequestThreadInput,
  type GitPreparePullRequestThreadResult,
  type GitPullRequestRefInput,
  type VcsPullResult,
  type VcsRemoveWorktreeInput,
  type GitResolvePullRequestResult,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsStatusInput,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  type VcsStatusResult,
} from "@t3tools/contracts";

import { GitManager, type GitRunStackedActionOptions } from "./GitManager.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { VcsDriverRegistry } from "../vcs/VcsDriverRegistry.ts";

export interface GitWorkflowServiceShape {
  readonly status: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
  readonly localStatus: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusLocalResult, GitManagerServiceError>;
  readonly remoteStatus: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusRemoteResult | null, GitManagerServiceError>;
  readonly diffWorkingTree: (
    input: VcsDiffWorkingTreeInput,
  ) => Effect.Effect<VcsDiffWorkingTreeResult, GitCommandError>;
  readonly diffCommit: (
    input: VcsDiffCommitInput,
  ) => Effect.Effect<VcsDiffCommitResult, GitCommandError>;
  readonly stageFile: (
    input: VcsFileOperationInput,
  ) => Effect.Effect<VcsFileOperationResult, GitCommandError>;
  readonly unstageFile: (
    input: VcsFileOperationInput,
  ) => Effect.Effect<VcsFileOperationResult, GitCommandError>;
  readonly restoreFile: (
    input: VcsFileOperationInput,
  ) => Effect.Effect<VcsFileOperationResult, GitCommandError>;
  readonly invalidateLocalStatus: (cwd: string) => Effect.Effect<void, never>;
  readonly invalidateRemoteStatus: (cwd: string) => Effect.Effect<void, never>;
  readonly invalidateStatus: (cwd: string) => Effect.Effect<void, never>;
  readonly pullCurrentBranch: (cwd: string) => Effect.Effect<VcsPullResult, GitCommandError>;
  readonly runStackedAction: (
    input: GitRunStackedActionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>;
  readonly resolvePullRequest: (
    input: GitPullRequestRefInput,
  ) => Effect.Effect<GitResolvePullRequestResult, GitManagerServiceError>;
  readonly preparePullRequestThread: (
    input: GitPreparePullRequestThreadInput,
  ) => Effect.Effect<GitPreparePullRequestThreadResult, GitManagerServiceError>;
  readonly listRefs: (input: VcsListRefsInput) => Effect.Effect<VcsListRefsResult, GitCommandError>;
  readonly listCommits: (
    input: VcsListCommitsInput,
  ) => Effect.Effect<VcsListCommitsResult, GitCommandError>;
  readonly createWorktree: (
    input: VcsCreateWorktreeInput,
  ) => Effect.Effect<VcsCreateWorktreeResult, GitCommandError>;
  readonly removeWorktree: (input: VcsRemoveWorktreeInput) => Effect.Effect<void, GitCommandError>;
  readonly createRef: (
    input: VcsCreateRefInput,
  ) => Effect.Effect<VcsCreateRefResult, GitCommandError>;
  readonly switchRef: (
    input: VcsSwitchRefInput,
  ) => Effect.Effect<VcsSwitchRefResult, GitCommandError>;
  readonly renameBranch: (input: {
    readonly cwd: string;
    readonly oldBranch: string;
    readonly newBranch: string;
  }) => Effect.Effect<{ readonly branch: string }, GitManagerServiceError>;
}

export class GitWorkflowService extends Context.Service<
  GitWorkflowService,
  GitWorkflowServiceShape
>()("t3/git/GitWorkflowService") {}

const unsupportedGitWorkflow = (operation: string, cwd: string, detail: string) =>
  new GitManagerError({
    operation,
    detail: `${detail} (${cwd})`,
  });

const unsupportedGitCommand = (operation: string, cwd: string, detail: string) =>
  new GitCommandError({
    operation,
    command: "vcs-route",
    cwd,
    detail,
  });

function nonRepositoryLocalStatus(): VcsStatusLocalResult {
  return {
    isRepo: false,
    hasPrimaryRemote: false,
    isDefaultRef: false,
    refName: null,
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
  };
}

function nonRepositoryStatus(): VcsStatusResult {
  return {
    ...nonRepositoryLocalStatus(),
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: 0,
    pr: null,
  };
}

function nonRepositoryListRefs(): VcsListRefsResult {
  return {
    refs: [],
    isRepo: false,
    hasPrimaryRemote: false,
    nextCursor: null,
    totalCount: 0,
  };
}

function nonRepositoryListCommits(): VcsListCommitsResult {
  return {
    commits: [],
    isRepo: false,
    nextCursor: null,
    totalCount: 0,
  };
}

function parseCommitLogOutput(output: string): VcsListCommitsResult["commits"] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      const [sha, shortSha, committedAt, authorName, subject] = line.split("\x1f");
      if (!sha || !shortSha || !committedAt || !authorName || !subject) {
        return [];
      }
      return [
        {
          sha,
          shortSha,
          committedAt,
          authorName,
          subject,
        },
      ];
    });
}

function buildFileOperationPathspecs(input: VcsFileOperationInput): readonly string[] {
  return [...new Set([input.oldPath, input.path].filter((path): path is string => Boolean(path)))];
}

export const make = Effect.fn("makeGitWorkflowService")(function* () {
  const registry = yield* VcsDriverRegistry;
  const git = yield* GitVcsDriver;
  const gitManager = yield* GitManager;

  const ensureGit = Effect.fn("GitWorkflowService.ensureGit")(function* (
    operation: string,
    cwd: string,
  ) {
    const handle = yield* registry
      .resolve({ cwd })
      .pipe(
        Effect.mapError((error) =>
          unsupportedGitWorkflow(
            operation,
            cwd,
            error instanceof Error ? error.message : String(error),
          ),
        ),
      );
    if (handle.kind !== "git") {
      return yield* unsupportedGitWorkflow(
        operation,
        cwd,
        `The ${operation} workflow currently supports Git repositories only; detected ${handle.kind}.`,
      );
    }
  });

  const ensureGitCommand = Effect.fn("GitWorkflowService.ensureGitCommand")(function* (
    operation: string,
    cwd: string,
  ) {
    const handle = yield* registry
      .resolve({ cwd })
      .pipe(
        Effect.mapError((error) =>
          unsupportedGitCommand(
            operation,
            cwd,
            error instanceof Error ? error.message : String(error),
          ),
        ),
      );
    if (handle.kind !== "git") {
      return yield* unsupportedGitCommand(
        operation,
        cwd,
        `The ${operation} command currently supports Git repositories only; detected ${handle.kind}.`,
      );
    }
  });

  const detectGitRepositoryForStatus = Effect.fn("GitWorkflowService.detectGitRepositoryForStatus")(
    function* (operation: string, cwd: string) {
      const handle = yield* registry
        .detect({ cwd })
        .pipe(
          Effect.mapError((error) =>
            unsupportedGitWorkflow(
              operation,
              cwd,
              error instanceof Error ? error.message : String(error),
            ),
          ),
        );
      if (!handle) {
        return false;
      }
      if (handle.kind !== "git") {
        return yield* unsupportedGitWorkflow(
          operation,
          cwd,
          `The ${operation} workflow currently supports Git repositories only; detected ${handle.kind}.`,
        );
      }
      return true;
    },
  );

  const detectGitRepositoryForCommand = Effect.fn(
    "GitWorkflowService.detectGitRepositoryForCommand",
  )(function* (operation: string, cwd: string) {
    const handle = yield* registry
      .detect({ cwd })
      .pipe(
        Effect.mapError((error) =>
          unsupportedGitCommand(
            operation,
            cwd,
            error instanceof Error ? error.message : String(error),
          ),
        ),
      );
    if (!handle) {
      return false;
    }
    if (handle.kind !== "git") {
      return yield* unsupportedGitCommand(
        operation,
        cwd,
        `The ${operation} command currently supports Git repositories only; detected ${handle.kind}.`,
      );
    }
    return true;
  });

  const routeGitManager =
    <Input extends { readonly cwd: string }, Output>(
      operation: string,
      run: (input: Input) => Effect.Effect<Output, GitManagerServiceError>,
    ) =>
    (input: Input) =>
      ensureGit(operation, input.cwd).pipe(Effect.andThen(run(input)));

  return GitWorkflowService.of({
    status: (input) =>
      detectGitRepositoryForStatus("GitWorkflowService.status", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository ? gitManager.status(input) : Effect.succeed(nonRepositoryStatus()),
        ),
      ),
    localStatus: (input) =>
      detectGitRepositoryForStatus("GitWorkflowService.localStatus", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository
            ? gitManager.localStatus(input)
            : Effect.succeed(nonRepositoryLocalStatus()),
        ),
      ),
    remoteStatus: (input) =>
      detectGitRepositoryForStatus("GitWorkflowService.remoteStatus", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository ? gitManager.remoteStatus(input) : Effect.succeed(null),
        ),
      ),
    diffWorkingTree: (input) =>
      ensureGitCommand("GitWorkflowService.diffWorkingTree", input.cwd).pipe(
        Effect.andThen(
          git.execute({
            operation: "GitWorkflowService.diffWorkingTree",
            cwd: input.cwd,
            args: [
              "diff",
              "--patch",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              ...(input.staged === true ? ["--cached"] : []),
              ...(input.ignoreWhitespace === true ? ["--ignore-all-space"] : []),
            ],
            allowNonZeroExit: true,
            maxOutputBytes: 2 * 1024 * 1024,
          }),
        ),
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.succeed({ diff: result.stdout })
            : Effect.fail(
                new GitCommandError({
                  operation: "GitWorkflowService.diffWorkingTree",
                  command: "git diff",
                  cwd: input.cwd,
                  detail: result.stderr.trim() || "git diff failed.",
                }),
              ),
        ),
      ),
    diffCommit: (input) =>
      ensureGitCommand("GitWorkflowService.diffCommit", input.cwd).pipe(
        Effect.andThen(
          git.execute({
            operation: "GitWorkflowService.diffCommit",
            cwd: input.cwd,
            args: [
              "show",
              "--format=",
              "--patch",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              ...(input.ignoreWhitespace === true ? ["--ignore-all-space"] : []),
              input.commitSha,
            ],
            allowNonZeroExit: true,
            maxOutputBytes: 2 * 1024 * 1024,
          }),
        ),
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.succeed({ diff: result.stdout })
            : Effect.fail(
                new GitCommandError({
                  operation: "GitWorkflowService.diffCommit",
                  command: "git show",
                  cwd: input.cwd,
                  detail: result.stderr.trim() || "git show failed.",
                }),
              ),
        ),
      ),
    stageFile: (input) =>
      ensureGitCommand("GitWorkflowService.stageFile", input.cwd).pipe(
        Effect.andThen(
          git.execute({
            operation: "GitWorkflowService.stageFile",
            cwd: input.cwd,
            args: ["add", "--all", "--", ...buildFileOperationPathspecs(input)],
            allowNonZeroExit: true,
          }),
        ),
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.succeed({})
            : Effect.fail(
                new GitCommandError({
                  operation: "GitWorkflowService.stageFile",
                  command: "git add",
                  cwd: input.cwd,
                  detail: result.stderr.trim() || "git add failed.",
                }),
              ),
        ),
      ),
    unstageFile: (input) =>
      ensureGitCommand("GitWorkflowService.unstageFile", input.cwd).pipe(
        Effect.andThen(
          git.execute({
            operation: "GitWorkflowService.unstageFile",
            cwd: input.cwd,
            args: ["restore", "--staged", "--", ...buildFileOperationPathspecs(input)],
            allowNonZeroExit: true,
          }),
        ),
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.succeed({})
            : Effect.fail(
                new GitCommandError({
                  operation: "GitWorkflowService.unstageFile",
                  command: "git restore --staged",
                  cwd: input.cwd,
                  detail: result.stderr.trim() || "git restore --staged failed.",
                }),
              ),
        ),
      ),
    restoreFile: (input) =>
      ensureGitCommand("GitWorkflowService.restoreFile", input.cwd).pipe(
        Effect.andThen(
          git.execute({
            operation: "GitWorkflowService.restoreFile",
            cwd: input.cwd,
            args: ["restore", "--", ...buildFileOperationPathspecs(input)],
            allowNonZeroExit: true,
          }),
        ),
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.succeed({})
            : Effect.fail(
                new GitCommandError({
                  operation: "GitWorkflowService.restoreFile",
                  command: "git restore",
                  cwd: input.cwd,
                  detail: result.stderr.trim() || "git restore failed.",
                }),
              ),
        ),
      ),
    invalidateLocalStatus: gitManager.invalidateLocalStatus,
    invalidateRemoteStatus: gitManager.invalidateRemoteStatus,
    invalidateStatus: gitManager.invalidateStatus,
    pullCurrentBranch: (cwd) =>
      ensureGitCommand("GitWorkflowService.pullCurrentBranch", cwd).pipe(
        Effect.andThen(git.pullCurrentBranch(cwd)),
      ),
    runStackedAction: (input, options) =>
      ensureGit("GitWorkflowService.runStackedAction", input.cwd).pipe(
        Effect.andThen(gitManager.runStackedAction(input, options)),
      ),
    resolvePullRequest: routeGitManager(
      "GitWorkflowService.resolvePullRequest",
      gitManager.resolvePullRequest,
    ),
    preparePullRequestThread: routeGitManager(
      "GitWorkflowService.preparePullRequestThread",
      gitManager.preparePullRequestThread,
    ),
    listRefs: (input) =>
      detectGitRepositoryForCommand("GitWorkflowService.listRefs", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository ? git.listRefs(input) : Effect.succeed(nonRepositoryListRefs()),
        ),
      ),
    listCommits: (input) =>
      detectGitRepositoryForCommand("GitWorkflowService.listCommits", input.cwd).pipe(
        Effect.flatMap((isGitRepository) => {
          if (!isGitRepository) {
            return Effect.succeed(nonRepositoryListCommits());
          }
          const limit = input.limit ?? 30;
          const cursor = input.cursor ?? 0;
          const fetchLimit = limit + 1;
          const query = input.query?.trim();
          return git
            .execute({
              operation: "GitWorkflowService.listCommits",
              cwd: input.cwd,
              args: [
                "log",
                `--skip=${cursor}`,
                `--max-count=${fetchLimit}`,
                "--date=iso-strict",
                "--pretty=format:%H%x1f%h%x1f%cI%x1f%an%x1f%s",
                ...(query ? ["--grep", query, "--regexp-ignore-case"] : []),
              ],
              allowNonZeroExit: true,
              maxOutputBytes: 256 * 1024,
            })
            .pipe(
              Effect.flatMap((result) => {
                if (result.exitCode !== 0) {
                  return Effect.fail(
                    new GitCommandError({
                      operation: "GitWorkflowService.listCommits",
                      command: "git log",
                      cwd: input.cwd,
                      detail: result.stderr.trim() || "git log failed.",
                    }),
                  );
                }
                const fetchedCommits = parseCommitLogOutput(result.stdout);
                const commits = fetchedCommits.slice(0, limit);
                const hasMore = fetchedCommits.length > limit;
                return Effect.succeed({
                  commits,
                  isRepo: true,
                  nextCursor: hasMore ? cursor + commits.length : null,
                  totalCount: cursor + commits.length + (hasMore ? 1 : 0),
                });
              }),
            );
        }),
      ),
    createWorktree: (input) =>
      ensureGitCommand("GitWorkflowService.createWorktree", input.cwd).pipe(
        Effect.andThen(git.createWorktree(input)),
      ),
    removeWorktree: (input) =>
      ensureGitCommand("GitWorkflowService.removeWorktree", input.cwd).pipe(
        Effect.andThen(git.removeWorktree(input)),
      ),
    createRef: (input) =>
      ensureGitCommand("GitWorkflowService.createRef", input.cwd).pipe(
        Effect.andThen(git.createRef(input)),
      ),
    switchRef: (input) =>
      ensureGitCommand("GitWorkflowService.switchRef", input.cwd).pipe(
        Effect.andThen(Effect.scoped(git.switchRef(input))),
      ),
    renameBranch: (input) =>
      ensureGit("GitWorkflowService.renameBranch", input.cwd).pipe(
        Effect.andThen(git.renameBranch(input)),
      ),
  });
});

export const layer = Layer.effect(GitWorkflowService, make());
