import { describe, expect, it } from "vitest";

import { isBrowserExternalAutomationAllowedOrigin } from "./DesktopBrowserExternalAutomationHost.ts";

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
