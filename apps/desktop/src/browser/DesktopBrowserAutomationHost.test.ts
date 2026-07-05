import { describe, expect, it } from "vitest";

import {
  createDesktopBrowserAutomationStateFingerprint,
  desktopBrowserAutomationBoundsEqual,
  normalizeDesktopBrowserAutomationBounds,
  type DesktopBrowserAutomationState,
} from "./DesktopBrowserAutomationHost.ts";

describe("DesktopBrowserAutomationHost performance helpers", () => {
  const baseState = {
    endpoint: "http://127.0.0.1:1234",
    selectedTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        title: "Example",
        url: "https://example.com/",
        visible: true,
        width: 800,
        height: 600,
        canGoBack: false,
        canGoForward: true,
      },
    ],
    lastError: null,
    lastScreenshotDataUrl: null,
    lastScreenshotPath: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } satisfies DesktopBrowserAutomationState;

  it("keeps the fingerprint stable when only updatedAt changes", () => {
    expect(createDesktopBrowserAutomationStateFingerprint(baseState)).toBe(
      createDesktopBrowserAutomationStateFingerprint({
        ...baseState,
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    );
  });

  it("changes the fingerprint when visible tab state changes", () => {
    expect(createDesktopBrowserAutomationStateFingerprint(baseState)).not.toBe(
      createDesktopBrowserAutomationStateFingerprint({
        ...baseState,
        tabs: [{ ...baseState.tabs[0]!, title: "Changed" }],
      }),
    );
  });

  it("normalizes and compares rounded panel bounds", () => {
    const previous = normalizeDesktopBrowserAutomationBounds({
      x: 10.2,
      y: 20.4,
      width: 300.49,
      height: 200.51,
      visible: true,
    });
    const next = normalizeDesktopBrowserAutomationBounds({
      x: 10.4,
      y: 20.2,
      width: 300.4,
      height: 201.1,
      visible: true,
    });

    expect(desktopBrowserAutomationBoundsEqual(previous, next)).toBe(true);
  });
});
