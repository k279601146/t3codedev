import { describe, expect, it } from "vitest";

import {
  createDesktopBrowserExternalAutomationStateFingerprint,
  isBrowserExternalAutomationAllowedOrigin,
  type DesktopBrowserExternalAutomationState,
} from "./DesktopBrowserExternalAutomationHost.ts";

describe("DesktopBrowserExternalAutomationHost CORS policy", () => {
  it("allows loopback browser origins", () => {
    expect(isBrowserExternalAutomationAllowedOrigin("http://localhost:5733")).toBe(true);
    expect(isBrowserExternalAutomationAllowedOrigin("http://127.0.0.1:5733")).toBe(true);
    expect(isBrowserExternalAutomationAllowedOrigin("http://[::1]:5733")).toBe(true);
  });

  it("allows Chrome extension origins for the paired extension", () => {
    expect(
      isBrowserExternalAutomationAllowedOrigin(
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      ),
    ).toBe(true);
  });

  it("rejects untrusted website origins", () => {
    expect(isBrowserExternalAutomationAllowedOrigin("https://example.com")).toBe(false);
    expect(isBrowserExternalAutomationAllowedOrigin("file:///tmp/page.html")).toBe(false);
    expect(isBrowserExternalAutomationAllowedOrigin("not a url")).toBe(false);
  });
});

describe("DesktopBrowserExternalAutomationHost performance helpers", () => {
  const baseState = {
    endpoint: "http://127.0.0.1:1234",
    token: "token",
    connected: true,
    extensionId: "extension-1",
    browserName: "Chrome",
    profileName: "Default",
    selectedTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        title: "Example",
        url: "https://example.com/",
        visible: true,
        width: 1024,
        height: 768,
        canGoBack: false,
        canGoForward: false,
      },
    ],
    permissions: [],
    lastError: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } satisfies DesktopBrowserExternalAutomationState;

  it("keeps the fingerprint stable when only updatedAt changes", () => {
    expect(createDesktopBrowserExternalAutomationStateFingerprint(baseState)).toBe(
      createDesktopBrowserExternalAutomationStateFingerprint({
        ...baseState,
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    );
  });

  it("changes the fingerprint when extension tab state changes", () => {
    expect(createDesktopBrowserExternalAutomationStateFingerprint(baseState)).not.toBe(
      createDesktopBrowserExternalAutomationStateFingerprint({
        ...baseState,
        tabs: [{ ...baseState.tabs[0]!, url: "https://example.com/changed" }],
      }),
    );
  });
});
