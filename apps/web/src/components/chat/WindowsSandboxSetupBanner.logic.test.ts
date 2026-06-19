import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderWindowsSandbox,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveWindowsSandboxBannerCopy } from "./WindowsSandboxSetupBanner.logic";

function sandbox(
  input: Partial<ServerProviderWindowsSandbox> = {},
): ServerProviderWindowsSandbox {
  return {
    mode: "elevated",
    readiness: "updateRequired",
    commandRunnerAvailable: true,
    setupHelperAvailable: true,
    lastError: null,
    updatedAt: "2026-06-17T00:00:00.000Z",
    ...input,
  };
}

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
  it("在 elevated 需要更新时显示输入框提示", () => {
    const copy = deriveWindowsSandboxBannerCopy(
      provider({
        windowsSandbox: sandbox({ readiness: "updateRequired" }),
      }),
      null,
    );

    expect(copy).toEqual({
      kind: "updateRequired",
      tone: "warning",
      title: "设置 Agent 沙箱以继续",
      detail: "Windows elevated 沙箱需要启动或更新。",
    });
  });

  it("在 elevated ready 时不显示提示", () => {
    const copy = deriveWindowsSandboxBannerCopy(
      provider({
        windowsSandbox: sandbox({ readiness: "ready" }),
      }),
      null,
    );

    expect(copy).toBeNull();
  });

  it("在 unelevated 后备沙箱 ready 时不打扰输入框", () => {
    const copy = deriveWindowsSandboxBannerCopy(
      provider({
        windowsSandbox: sandbox({ mode: "unelevated", readiness: "ready" }),
      }),
      null,
    );

    expect(copy).toBeNull();
  });

  it("在 unelevated 返回错误时也不把 elevated 启动入口贴到输入框", () => {
    const copy = deriveWindowsSandboxBannerCopy(
      provider({
        windowsSandbox: sandbox({
          mode: "unelevated",
          readiness: "error",
          lastError: "沙箱状态检查失败",
        }),
      }),
      null,
    );

    expect(copy).toBeNull();
  });
});
