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
  it("在 unelevated 已就绪时不显示阻塞输入的提示", () => {
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

    expect(copy).toBeNull();
  });

  it("在 unelevated 返回错误时仍显示可诊断的错误提示", () => {
    const copy = deriveWindowsSandboxBannerCopy(
      provider(),
      {
        mode: "unelevated",
        readiness: "error",
        commandRunnerAvailable: true,
        setupHelperAvailable: true,
        lastError: "沙箱状态检查失败",
        updatedAt: "2026-06-17T00:00:00.000Z",
      },
    );

    expect(copy).toEqual({
      kind: "error",
      tone: "error",
      title: "Agent 沙箱启动失败",
      detail: "沙箱状态检查失败",
    });
  });
});
