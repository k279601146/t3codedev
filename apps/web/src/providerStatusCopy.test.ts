import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  getFriendlyProviderStatusMessage,
  shouldShowProviderStatusBanner,
} from "./providerStatusCopy";

function makeProvider(input: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "MyService",
    enabled: true,
    installed: true,
    version: null,
    status: "warning",
    auth: { status: "unknown" },
    checkedAt: "2026-06-25T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...input,
  };
}

describe("providerStatusCopy", () => {
  it("keeps initial background checks out of the top banner", () => {
    const provider = makeProvider({
      message: "Codex provider status has not been checked in this session yet.",
    });

    expect(shouldShowProviderStatusBanner(provider)).toBe(false);
  });

  it("keeps slow startup timeouts out of the top banner", () => {
    const provider = makeProvider({
      status: "error",
      message: "Timed out while checking Codex app-server provider status.",
    });

    expect(shouldShowProviderStatusBanner(provider)).toBe(false);
    expect(getFriendlyProviderStatusMessage(provider)).toContain("后台检查状态");
  });

  it("shows actionable provider failures in the top banner", () => {
    const provider = makeProvider({
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Bahew is not signed in. Sign in to your account and try again.",
    });

    expect(shouldShowProviderStatusBanner(provider)).toBe(true);
    expect(getFriendlyProviderStatusMessage(provider)).toBe("尚未登录 Bahew 账号，请登录后重试。");
  });

  it("does not show ready or disabled providers in the top banner", () => {
    expect(shouldShowProviderStatusBanner(makeProvider({ status: "ready" }))).toBe(false);
    expect(shouldShowProviderStatusBanner(makeProvider({ status: "disabled" }))).toBe(false);
  });
});
