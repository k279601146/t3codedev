import type { ServerProvider, ServerProviderWindowsSandbox } from "@t3tools/contracts";

import {
  getFriendlyProviderInfrastructureMessage,
  getServerProviderLabel,
  isProviderProbeUnavailableMessage,
} from "../../providerStatusCopy";

export type WindowsSandboxBannerKind = "notConfigured" | "updateRequired" | "error";

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
  if (!sandbox || sandbox.mode !== "elevated") {
    return null;
  }

  switch (sandbox.readiness) {
    case "ready":
      return null;
    case "notConfigured":
      return {
        kind: "notConfigured",
        tone: "warning",
        title: "设置 Agent 沙箱以继续",
        detail: "Windows elevated 沙箱尚未初始化。",
      };
    case "updateRequired":
      return {
        kind: "updateRequired",
        tone: "warning",
        title: "设置 Agent 沙箱以继续",
        detail: "Windows elevated 沙箱需要启动或更新。",
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
            "本地引擎状态暂时不可用，可以重新启动 Agent 沙箱或进入设置检查配置。",
          ),
        };
      }
      return {
        kind: "error",
        tone: "error",
        title: "Agent 沙箱启动失败",
        detail:
          sandbox.lastError ??
          "Windows elevated 沙箱当前不可用。尝试修复失败后会自动回退到 unelevated 后备沙箱。",
      };
  }
}
