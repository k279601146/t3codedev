import { describe, expect, it } from "vitest";

import { resolveFriendlyErrorMessage, sanitizeProviderErrorMessage } from "./friendlyErrors";

describe("friendlyErrors", () => {
  it("maps insufficient balance provider responses to actionable copy", () => {
    const friendly = resolveFriendlyErrorMessage(
      'unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
    );

    expect(friendly.title).toBe("Your Codex message limit is used up");
    expect(friendly.description).not.toContain("unexpected status");
    expect(friendly.primaryActionLabel).toBe("Upgrade");
  });

  it("trims empty provider errors before storing them", () => {
    expect(sanitizeProviderErrorMessage("  Failed  ")).toBe("Failed");
    expect(sanitizeProviderErrorMessage("   ")).toBeNull();
  });
});
