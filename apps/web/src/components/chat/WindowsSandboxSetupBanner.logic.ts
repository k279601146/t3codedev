import type { ServerProvider, ServerProviderWindowsSandbox } from "@t3tools/contracts";

import {
  getFriendlyProviderInfrastructureMessage,
  getServerProviderLabel,
  isProviderProbeUnavailableMessage,
} from "../../providerStatusCopy";

export type WindowsSandboxBannerKind =
  | "missingSnapshot"
  | "notConfigured"
  | "updateRequired"
  | "fallback"
  | "error";

export interface WindowsSandboxBannerCopy {
  readonly kind: WindowsSandboxBannerKind;
  readonly tone: "warning" | "error";
  readonly title: string;
  readonly detail: string | null;
}

export function deriveWindowsSandboxBannerCopy(
  provider: ServerProvider | null,
  checkedSandbox: ServerProviderWindowsSandbox | null,
): WindowsSandboxBannerCopy | null {
  if (!provider || provider.driver !== "codex") {
    return null;
  }

  const sandbox = checkedSandbox ?? provider.windowsSandbox;
  if (!sandbox) {
    return {
      kind: "missingSnapshot",
      tone: "warning",
      title: "设置 Agent 沙箱以继续",
      detail: "尚未收到 Windows 沙箱状态",
    };
  }

  if (sandbox.mode === "unelevated") {
    return {
      kind: "fallback",
      tone: "warning",
      title: "Agent 沙箱已降级运行",
      detail:
        "Windows elevated 沙箱暂不可用，已使用 unelevated 沙箱继续运行；修复后可在设置中恢复 elevated。",
    };
  }

  switch (sandbox.readiness) {
    case "ready":
      return null;
    case "notConfigured":
      return {
        kind: "notConfigured",
        tone: "warning",
        title: "设置 Agent 沙箱以继续",
        detail: "Windows elevated 沙箱尚未初始化",
      };
    case "updateRequired":
      return {
        kind: "updateRequired",
        tone: "warning",
        title: "设置 Agent 沙箱以继续",
        detail: "Windows elevated 沙箱需要启动或更新",
      };
    case "error":
      if (isProviderProbeUnavailableMessage(sandbox.lastError)) {
        return {
          kind: "error",
          tone: "warning",
          title: "Agent 沙箱需要确认",
          detail: getFriendlyProviderInfrastructureMessage(
            getServerProviderLabel(provider),
            sandbox.lastError,
            "本地引擎状态暂时不可用，仍可尝试重新启动 Agent 沙箱或进入设置检查配置。",
          ),
        };
      }
      return {
        kind: "error",
        tone: "error",
        title: "Agent 沙箱启动失败",
        detail: sandbox.lastError ?? "Windows elevated 沙箱当前不可用，可以重新启动初始化流程",
      };
    default:
      return null;
  }
}
