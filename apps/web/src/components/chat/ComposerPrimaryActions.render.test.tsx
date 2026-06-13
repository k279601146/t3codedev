import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

vi.mock("~/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}));

const renderRunningPrimaryActions = (input: {
  canSteerRunningTurn: boolean;
  hasSendableContent: boolean;
  isInterruptPending?: boolean;
  isSendBusy?: boolean;
}) =>
  renderToStaticMarkup(
    <ComposerPrimaryActions
      compact={false}
      pendingAction={null}
      isRunning
      canSteerRunningTurn={input.canSteerRunningTurn}
      showPlanFollowUpPrompt={false}
      promptHasText={input.hasSendableContent}
      isSendBusy={input.isSendBusy ?? false}
      isInterruptPending={input.isInterruptPending ?? false}
      isConnecting={false}
      isEnvironmentUnavailable={false}
      isPreparingWorktree={false}
      hasSendableContent={input.hasSendableContent}
      onPreviousPendingQuestion={() => {}}
      onInterrupt={() => {}}
      onImplementPlanInNewThread={() => {}}
    />,
  );

describe("ComposerPrimaryActions running render", () => {
  it("renders only the steer submit button while running with sendable content", () => {
    const markup = renderRunningPrimaryActions({
      canSteerRunningTurn: true,
      hasSendableContent: true,
    });

    expect(markup.match(/<button/g)?.length).toBe(1);
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('aria-label="Steer current turn"');
    expect(markup).not.toContain('aria-label="Stop generation"');
  });

  it("renders only the stop button while running without sendable content", () => {
    const markup = renderRunningPrimaryActions({
      canSteerRunningTurn: true,
      hasSendableContent: false,
    });

    expect(markup.match(/<button/g)?.length).toBe(1);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Steer current turn"');
  });

  it("keeps the stop button while an interrupt is pending even if the draft has content", () => {
    const markup = renderRunningPrimaryActions({
      canSteerRunningTurn: true,
      hasSendableContent: true,
      isInterruptPending: true,
      isSendBusy: true,
    });

    expect(markup.match(/<button/g)?.length).toBe(1);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Stopping generation"');
    expect(markup).not.toContain('type="submit"');
    expect(markup).not.toContain('aria-label="Steer current turn"');
    expect(markup).not.toContain("animate-spin");
  });
});
