import * as Encoding from "effect/Encoding";
import {
  CheckpointRef,
  CONVERSATION_PROJECT_ID,
  ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

export const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

function normalizePathForComparison(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

function joinPath(base: string, child: string): string {
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/u, "")}${separator}${child}`;
}

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

export function resolveThreadWorkspaceCwd(input: {
  readonly threadId: ThreadId;
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly conversationWorkspaceDir: string;
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
}): string | undefined {
  const worktreeCwd = input.thread.worktreePath ?? undefined;
  if (worktreeCwd) {
    return worktreeCwd;
  }

  if (input.thread.projectId === CONVERSATION_PROJECT_ID) {
    return joinPath(input.conversationWorkspaceDir, input.threadId);
  }

  return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}

export function isPathInsideConversationWorkspace(input: {
  readonly cwd: string;
  readonly conversationWorkspaceDir: string;
}): boolean {
  const conversationWorkspaceDir = normalizePathForComparison(input.conversationWorkspaceDir);
  const cwd = normalizePathForComparison(input.cwd);
  return cwd === conversationWorkspaceDir || cwd.startsWith(`${conversationWorkspaceDir}/`);
}
