import type { EnvironmentId } from "@t3tools/contracts";
import { useComposerDraftStore } from "../composerDraftStore";
import type { NewThreadScope } from "../uiStateStore";

interface StartNewConversationThreadInput {
  environmentId: EnvironmentId | null | undefined;
  setNewThreadScope: (scope: NewThreadScope) => void;
  navigateToConversationHome: () => Promise<unknown> | unknown;
}

export async function startNewConversationThread(
  input: StartNewConversationThreadInput,
): Promise<void> {
  input.setNewThreadScope({ kind: "conversation" });
  if (input.environmentId) {
    useComposerDraftStore.getState().ensureConversationDraftSession(input.environmentId);
  }
  await input.navigateToConversationHome();
}
