import type {
  ProviderInstanceId,
  ProviderWindowsSandboxReadinessResult,
  ProviderWindowsSandboxSetupStartResult,
  ServerProviderWindowsSandbox,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runElevatedWindowsSandboxSetupFlow } from "./windowsSandboxSetupFlow";

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(),
}));

vi.mock("./windowsSandboxRepair", async () => {
  const logic = await import("./windowsSandboxRepair.logic");
  return {
    shouldOfferWindowsSandboxFirewallRepair: logic.shouldOfferWindowsSandboxFirewallRepair,
    repairWindowsSandboxFirewallWithConfirmation: vi.fn(),
  };
});

const { ensureLocalApi } = await import("../localApi");
const { repairWindowsSandboxFirewallWithConfirmation } = await import("./windowsSandboxRepair");

const providerInstanceId = "provider-1" as ProviderInstanceId;

function sandbox(input: Partial<ServerProviderWindowsSandbox> = {}): ServerProviderWindowsSandbox {
  return {
    mode: "elevated",
    readiness: "updateRequired",
    commandRunnerAvailable: true,
    setupHelperAvailable: true,
    lastError: null,
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...input,
  };
}

function makeSetupResult(
  input: Partial<ProviderWindowsSandboxSetupStartResult>,
): ProviderWindowsSandboxSetupStartResult {
  return {
    providerInstanceId,
    started: true,
    windowsSandbox: sandbox(),
    ...input,
  };
}

function makeReadinessResult(
  windowsSandbox: ServerProviderWindowsSandbox,
): ProviderWindowsSandboxReadinessResult {
  return {
    providerInstanceId,
    windowsSandbox,
  };
}

function installApi(input: {
  readonly setupResults: ReadonlyArray<ProviderWindowsSandboxSetupStartResult>;
  readonly readinessResults: ReadonlyArray<ProviderWindowsSandboxReadinessResult>;
}) {
  const windowsSandboxSetupStart = vi
    .fn()
    .mockImplementation(async () => {
      const next = input.setupResults[windowsSandboxSetupStart.mock.calls.length - 1];
      if (!next) {
        throw new Error("未配置 setupStart 测试结果");
      }
      return next;
    });
  const windowsSandboxReadiness = vi
    .fn()
    .mockImplementation(async () => {
      const next = input.readinessResults[windowsSandboxReadiness.mock.calls.length - 1];
      if (!next) {
        throw new Error("未配置 readiness 测试结果");
      }
      return next;
    });

  vi.mocked(ensureLocalApi).mockReturnValue({
    server: {
      windowsSandboxSetupStart,
      windowsSandboxReadiness,
    },
  } as unknown as ReturnType<typeof ensureLocalApi>);

  return {
    windowsSandboxSetupStart,
    windowsSandboxReadiness,
  };
}

describe("runElevatedWindowsSandboxSetupFlow", () => {
  beforeEach(() => {
    vi.mocked(repairWindowsSandboxFirewallWithConfirmation).mockReset();
    vi.mocked(ensureLocalApi).mockReset();
  });

  it("setup 后仅为 updateRequired 时不提前弹防火墙修复", async () => {
    vi.mocked(repairWindowsSandboxFirewallWithConfirmation).mockResolvedValue(true);
    const api = installApi({
      setupResults: [makeSetupResult({})],
      readinessResults: [
        makeReadinessResult(sandbox({ readiness: "updateRequired" })),
        makeReadinessResult(sandbox({ readiness: "updateRequired" })),
      ],
    });

    const { result, repairedFirewall } = await runElevatedWindowsSandboxSetupFlow({
      providerInstanceId,
      attempts: 2,
      delayMs: 0,
    });

    expect(result.windowsSandbox.readiness).toBe("updateRequired");
    expect(repairedFirewall).toBe(false);
    expect(repairWindowsSandboxFirewallWithConfirmation).not.toHaveBeenCalled();
    expect(api.windowsSandboxSetupStart).toHaveBeenCalledTimes(1);
  });

  it("异步 setup 失败命中防火墙错误后提示修复并重试", async () => {
    vi.mocked(repairWindowsSandboxFirewallWithConfirmation).mockResolvedValue(true);
    const firewallError =
      "helper_firewall_policy_access_failed: INetFwPolicy2::LocalPolicyModifyState failed: HRESULT(0x800706D9)";
    const api = installApi({
      setupResults: [
        makeSetupResult({}),
        makeSetupResult({
          windowsSandbox: sandbox({ readiness: "ready" }),
        }),
      ],
      readinessResults: [
        makeReadinessResult(
          sandbox({
            readiness: "error",
            lastError: firewallError,
          }),
        ),
        makeReadinessResult(sandbox({ readiness: "ready" })),
        makeReadinessResult(sandbox({ readiness: "ready" })),
      ],
    });

    const { result, repairedFirewall } = await runElevatedWindowsSandboxSetupFlow({
      providerInstanceId,
      attempts: 2,
      delayMs: 0,
    });

    expect(repairWindowsSandboxFirewallWithConfirmation).toHaveBeenCalledTimes(1);
    expect(api.windowsSandboxSetupStart).toHaveBeenCalledTimes(2);
    expect(result.windowsSandbox.readiness).toBe("ready");
    expect(repairedFirewall).toBe(true);
  });

  it("readiness 先返回 ready 但随后收到防火墙失败时仍提示修复", async () => {
    vi.mocked(repairWindowsSandboxFirewallWithConfirmation).mockResolvedValue(true);
    const firewallError =
      "helper_firewall_policy_access_failed: INetFwPolicy2::LocalPolicyModifyState failed: HRESULT(0x800706D9)";
    const api = installApi({
      setupResults: [
        makeSetupResult({}),
        makeSetupResult({
          windowsSandbox: sandbox({ readiness: "ready" }),
        }),
      ],
      readinessResults: [
        makeReadinessResult(sandbox({ readiness: "ready" })),
        makeReadinessResult(
          sandbox({
            readiness: "error",
            lastError: firewallError,
          }),
        ),
        makeReadinessResult(sandbox({ readiness: "ready" })),
        makeReadinessResult(sandbox({ readiness: "ready" })),
      ],
    });

    const { result, repairedFirewall } = await runElevatedWindowsSandboxSetupFlow({
      providerInstanceId,
      attempts: 2,
      delayMs: 0,
    });

    expect(repairWindowsSandboxFirewallWithConfirmation).toHaveBeenCalledTimes(1);
    expect(api.windowsSandboxSetupStart).toHaveBeenCalledTimes(2);
    expect(result.windowsSandbox.readiness).toBe("ready");
    expect(repairedFirewall).toBe(true);
  });
});
