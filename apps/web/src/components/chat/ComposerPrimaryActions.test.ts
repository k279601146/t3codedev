import { describe, expect, it } from "vitest";

import {
  formatPendingPrimaryActionLabel,
  getRunningPrimaryActionMode,
  isStandardSendButtonDisabled,
} from "./ComposerPrimaryActionState";

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});

describe("isStandardSendButtonDisabled", () => {
  it("does not disable the send button for usage limits", () => {
    expect(
      isStandardSendButtonDisabled({
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        hasSendableContent: true,
      }),
    ).toBe(false);
  });

  it("still disables the send button when the composer cannot submit", () => {
    expect(
      isStandardSendButtonDisabled({
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        hasSendableContent: false,
      }),
    ).toBe(true);
  });

  it("disables the send button when the provider cannot accept model sends", () => {
    expect(
      isStandardSendButtonDisabled({
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isProviderUnavailable: true,
        hasSendableContent: true,
      }),
    ).toBe(true);
  });
});

describe("getRunningPrimaryActionMode", () => {
  it("shows the steer action only when the running turn can be steered and the draft has sendable content", () => {
    expect(
      getRunningPrimaryActionMode({
        canSteerRunningTurn: true,
        hasSendableContent: true,
      }),
    ).toBe("steer");
  });

  it("keeps the stop action while running with an empty draft", () => {
    expect(
      getRunningPrimaryActionMode({
        canSteerRunningTurn: true,
        hasSendableContent: false,
      }),
    ).toBe("interrupt");
  });

  it("keeps the stop action when the provider cannot steer the running turn", () => {
    expect(
      getRunningPrimaryActionMode({
        canSteerRunningTurn: false,
        hasSendableContent: true,
      }),
    ).toBe("interrupt");
  });

  it("keeps the stop action while an interrupt is pending", () => {
    expect(
      getRunningPrimaryActionMode({
        canSteerRunningTurn: true,
        hasSendableContent: true,
        isInterruptPending: true,
      }),
    ).toBe("interrupt");
  });
});
