import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { useComposerDraftStore } from "../../composerDraftStore";

async function mountMenu() {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <CompactComposerControlsMenu
      activePlan={false}
      interactionMode="default"
      planSidebarLabel="Plan"
      planSidebarOpen={false}
      runtimeMode="approval-required"
      showInteractionModeToggle
      onToggleInteractionMode={vi.fn()}
      onTogglePlanSidebar={vi.fn()}
      onRuntimeModeChange={vi.fn()}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("CompactComposerControlsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
    });
  });

  it("does not show provider model option controls", async () => {
    await using _ = await mountMenu();

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).not.toContain("Reasoning");
      expect(text).not.toContain("Fast Mode");
      expect(text).not.toContain("Thinking");
      expect(text).toContain("Mode");
      expect(text).toContain("Access");
    });
  });

  it("can hide the interaction mode section", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <CompactComposerControlsMenu
        activePlan={false}
        interactionMode="default"
        planSidebarLabel="Plan"
        planSidebarOpen={false}
        runtimeMode="approval-required"
        showInteractionModeToggle={false}
        onToggleInteractionMode={vi.fn()}
        onTogglePlanSidebar={vi.fn()}
        onRuntimeModeChange={vi.fn()}
      />,
      { container: host },
    );

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).not.toContain("Mode");
      expect(text).not.toContain("Chat");
      expect(text).not.toContain("Plan");
      expect(text).toContain("Access");
      expect(text).toContain("Supervised");
      expect(text).toContain("Full access");
    });

    await screen.unmount();
    host.remove();
  });
});
