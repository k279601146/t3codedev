import type { ServerProvider } from "@t3tools/contracts";

import { formatProviderDriverKindLabel } from "./providerModels";

const CODEX_PROVIDER_STATUS_TIMEOUT = "Timed out while checking Codex app-server provider status.";

export function getServerProviderLabel(provider: ServerProvider): string {
  return provider.displayName?.trim() || formatProviderDriverKindLabel(provider.driver);
}

export function isProviderProbeUnavailableMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes(CODEX_PROVIDER_STATUS_TIMEOUT.toLowerCase()) ||
    normalized.includes("codex app-server provider probe failed") ||
    normalized.includes("bundled ai engine binary is missing") ||
    normalized.includes("codex cli (`codex`) is not installed")
  );
}

export function getFriendlyProviderInfrastructureMessage(
  label: string,
  message: string | null | undefined,
  fallback: string | null = null,
): string | null {
  const rawMessage = message?.trim();
  if (!rawMessage) {
    return fallback;
  }

  const normalized = rawMessage.toLowerCase();
  if (normalized.includes(CODEX_PROVIDER_STATUS_TIMEOUT.toLowerCase())) {
    return `${label} 状态检查超时。引擎可能还在启动，稍后刷新即可；如果反复出现，请重启本地服务。`;
  }
  if (normalized.includes("codex app-server provider probe failed")) {
    return `${label} 状态检查失败。请确认本地引擎可以启动，然后刷新 provider 状态。`;
  }
  if (normalized.includes("bundled ai engine binary is missing")) {
    return "内置 AI 引擎文件缺失或无法访问，请检查安装包或重新构建 ai-engine.exe。";
  }
  if (normalized.includes("codex cli (`codex`) is not installed")) {
    return "未找到 Codex CLI，请确认 codex 已安装并在 PATH 中。";
  }
  if (normalized.includes("t3 code is not signed in")) {
    return "尚未登录 T3 Code 账号，请登录后重试。";
  }
  if (normalized.includes("codex provider status has not been checked")) {
    return `${label} 状态还在检查中，请稍等或手动刷新。`;
  }
  if (normalized.includes("codex is disabled")) {
    return `${label} 已在设置中禁用。`;
  }

  return rawMessage
    .replaceAll("Codex app-server provider", `${label} 状态检查`)
    .replaceAll("Codex app-server", "本地引擎");
}

export function getFriendlyProviderStatusMessage(
  provider: ServerProvider,
  fallback: string | null = null,
): string | null {
  return getFriendlyProviderInfrastructureMessage(
    getServerProviderLabel(provider),
    provider.message,
    fallback,
  );
}

export function getProviderStatusAlertCopy(provider: ServerProvider): {
  readonly title: string;
  readonly detail: string;
} {
  const label = getServerProviderLabel(provider);
  const fallback =
    provider.status === "error"
      ? `${label} 暂时不可用，请稍后刷新状态。`
      : `${label} 可用性受限，请检查设置或稍后刷新。`;
  return {
    title: provider.status === "error" ? `${label} 暂时不可用` : `${label} 需要确认`,
    detail: getFriendlyProviderStatusMessage(provider, fallback) ?? fallback,
  };
}
