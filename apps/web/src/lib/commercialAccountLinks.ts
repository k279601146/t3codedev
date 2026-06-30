import {
  DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL,
  resolveCommercialEngineWebAuthBaseUrl,
} from "@t3tools/shared/commercialEngine";

export function resolveCommercialAccountWebBaseUrl(): string {
  return resolveCommercialEngineWebAuthBaseUrl();
}

export function resolveCommercialAccountActionUrl(
  baseUrl: string | null | undefined,
  path: string,
): string {
  const fallback = new URL(path, DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL).toString();
  if (!baseUrl) {
    return fallback;
  }

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return fallback;
  }
}

export function openCommercialAccountUrl(url: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.desktopBridge;
  if (bridge?.openExternal) {
    void bridge.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
