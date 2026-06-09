import { scopeThreadRef } from "@t3tools/client-runtime";
import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerDraftStore } from "../composerDraftStore";
import { startNewConversationThread } from "./conversationThreadActions";

const TEST_ENVIRONMENT_ID = EnvironmentId.make("environment-local");

function resetComposerDraftStore() {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

describe("startNewConversationThread", () => {
  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("为已经提交的无项目对话创建新的草稿", async () => {
    const store = useComposerDraftStore.getState();
    const previousDraft = store.ensureConversationDraftSession(TEST_ENVIRONMENT_ID);
    store.markDraftThreadPromoting(
      previousDraft.draftId,
      scopeThreadRef(TEST_ENVIRONMENT_ID, previousDraft.threadId),
    );

    const setNewThreadScope = vi.fn();
    const navigateToConversationHome = vi.fn();

    await startNewConversationThread({
      environmentId: TEST_ENVIRONMENT_ID,
      setNewThreadScope,
      navigateToConversationHome,
    });

    const nextDraft = useComposerDraftStore.getState().getReusableConversationDraftSession();
    expect(nextDraft?.draftId).not.toBe(previousDraft.draftId);
    expect(nextDraft?.environmentId).toBe(TEST_ENVIRONMENT_ID);
    expect(setNewThreadScope).toHaveBeenCalledWith({ kind: "conversation" });
    expect(navigateToConversationHome).toHaveBeenCalledOnce();
  });

  it("没有环境时仍然执行导航", async () => {
    const setNewThreadScope = vi.fn();
    const navigateToConversationHome = vi.fn();

    await startNewConversationThread({
      environmentId: null,
      setNewThreadScope,
      navigateToConversationHome,
    });

    expect(useComposerDraftStore.getState().getReusableConversationDraftSession()).toBeNull();
    expect(setNewThreadScope).toHaveBeenCalledWith({ kind: "conversation" });
    expect(navigateToConversationHome).toHaveBeenCalledOnce();
  });
});
