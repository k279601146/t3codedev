import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveWindowsSandboxBannerCopy } from "./WindowsSandboxSetupBanner.logic";

function provider(input: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("provider-1"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    status: "ready",
    auth: { status: "unknown" },
    enabled: true,
    installed: true,
    version: null,
    checkedAt: "2026-06-17T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    permissionProfiles: [],
    ...input,
  };
}

describe("WindowsSandboxSetupBanner.logic", () => {
  it("在 elevated 降级为 unelevated 时显示可继续使用的提示", () => {
    const copy = deriveWindowsSandboxBannerCopy(
      provider(),
      {
        mode: "unelevated",
        readiness: "ready",
        commandRunnerAvailable: true,
        setupHelperAvailable: true,
        lastError: null,
        updatedAt: "2026-06-17T00:00:00.000Z",
      },
    );

    expect(copy).toEqual({
      kind: "fallback",
      tone: "warning",
      title: "Agent 沙箱已降级运行",
      detail:
        "Windows elevated 沙箱暂不可用，已使用 unelevated 沙箱继续运行；修复后可在设置中恢复 elevated。",
    });
  });
});
