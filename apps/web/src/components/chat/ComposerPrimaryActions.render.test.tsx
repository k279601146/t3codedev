import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

vi.mock("~/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}));

const renderRunningPrimaryActions = (input: {
  canSteerRunningTurn: boolean;
  hasSendableContent: boolean;
}) =>
  renderToStaticMarkup(
    <ComposerPrimaryActions
      compact={false}
      pendingAction={null}
      isRunning
      canSteerRunningTurn={input.canSteerRunningTurn}
      showPlanFollowUpPrompt={false}
      promptHasText={input.hasSendableContent}
      isSendBusy={false}
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
});
