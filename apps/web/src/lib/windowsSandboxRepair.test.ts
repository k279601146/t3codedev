import type { ServerProviderWindowsSandbox } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  isWindowsSandboxFirewallPolicyError,
  shouldOfferWindowsSandboxFirewallRepair,
} from "./windowsSandboxRepair";

function sandbox(input: Partial<ServerProviderWindowsSandbox> = {}): ServerProviderWindowsSandbox {
  return {
    mode: "elevated",
    readiness: "ready",
    commandRunnerAvailable: true,
    setupHelperAvailable: true,
    lastError: null,
    updatedAt: "2026-06-16T00:00:00.000Z",
    ...input,
  };
}

describe("Windows 沙箱防火墙修复提示", () => {
  it("识别 Windows 防火墙策略访问失败", () => {
    expect(
      isWindowsSandboxFirewallPolicyError(
        "helper_firewall_policy_access_failed: INetFwPolicy2::LocalPolicyModifyState failed: HRESULT(0x800706D9)",
      ),
    ).toBe(true);
    expect(isWindowsSandboxFirewallPolicyError("普通 helper 更新失败")).toBe(false);
  });

  it("底层错误命中时提示修复", () => {
    expect(
      shouldOfferWindowsSandboxFirewallRepair(
        sandbox({
          readiness: "error",
          lastError: "INetFwPolicy2::LocalPolicyModifyState failed: HRESULT(0x800706D9)",
        }),
      ),
    ).toBe(true);
  });

  it("启动 elevated 后降级或仍需更新时提示修复", () => {
    expect(shouldOfferWindowsSandboxFirewallRepair(sandbox({ mode: "unelevated" }))).toBe(true);
    expect(shouldOfferWindowsSandboxFirewallRepair(sandbox({ readiness: "updateRequired" }))).toBe(
      true,
    );
  });

  it("ready 的 elevated 沙箱不提示修复", () => {
    expect(shouldOfferWindowsSandboxFirewallRepair(sandbox())).toBe(false);
    expect(shouldOfferWindowsSandboxFirewallRepair(null)).toBe(false);
  });
});
