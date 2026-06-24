import type { ThreadId } from "@t3tools/contracts";

export function resolveConversationWorkspacePath(
  conversationWorkspaceDir: string | null | undefined,
  threadId: ThreadId | string | null | undefined,
): string | undefined {
  const normalizedRoot = conversationWorkspaceDir?.trim().replace(/[\\/]+$/u, "");
  if (!normalizedRoot || !threadId) {
    return undefined;
  }
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  return `${normalizedRoot}${separator}${String(threadId)}`;
}
