import type { ServerProvider, ServerProviderVersionAdvisory } from "@t3tools/contracts";

import { getFriendlyProviderStatusMessage } from "../../providerStatusCopy";

/**
 * Visual treatment for each server-reported provider status. Centralized so
 * the default-driver card and per-instance cards share the same language.
 */
export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/**
 * Derive the headline + detail copy shown under a provider's name in the
 * settings page. Prefers `provider.message` for server-supplied detail and
 * falls back to generic phrasing when the server has not yet reported any
 * state — which happens before the first probe or when an instance names a
 * driver this build does not ship.
 */
export function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and authentication details.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Disabled",
      detail:
        getFriendlyProviderStatusMessage(
          provider,
          "此 provider 已安装，但已在 Bahew 设置中禁用。",
        ) ?? "此 provider 已安装，但已在 Bahew 设置中禁用。",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: getFriendlyProviderStatusMessage(provider, "未在 PATH 中检测到 CLI。"),
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: getFriendlyProviderStatusMessage(provider),
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: getFriendlyProviderStatusMessage(provider),
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        getFriendlyProviderStatusMessage(provider, "Provider 已安装，但服务端无法完整验证。") ??
        "Provider 已安装，但服务端无法完整验证。",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail:
        getFriendlyProviderStatusMessage(provider, "Provider 启动检查失败。") ??
        "Provider 启动检查失败。",
    };
  }
  return {
    headline: "Available",
    detail:
      getFriendlyProviderStatusMessage(provider, "已安装并可用，但认证状态暂未确认。") ??
      "已安装并可用，但认证状态暂未确认。",
  };
}

/**
 * Normalize a version string for display. Adds the `v` prefix when the
 * driver reported a bare version (e.g. `1.2.3`) so cards render
 * consistently regardless of driver.
 */
export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
): {
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
} | null {
  if (!advisory || advisory.status === "current" || advisory.status === "unknown") {
    return null;
  }

  const label = "Update available";
  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    detail:
      advisory.message ??
      (versionLabel
        ? `${label}: install ${versionLabel}.`
        : `${label}: install the latest provider version.`),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
  };
}
