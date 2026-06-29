import type { DesktopAppBranding } from "@t3tools/contracts";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();
const hostedAppChannel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();

export const HOSTED_APP_CHANNEL =
  hostedAppChannel === "latest" || hostedAppChannel === "nightly" ? hostedAppChannel : null;
export const HOSTED_APP_CHANNEL_LABEL =
  HOSTED_APP_CHANNEL === "nightly"
    ? "Nightly"
    : HOSTED_APP_CHANNEL === "latest"
      ? "Stable"
      : null;
export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? "Bahew";
export const APP_STAGE_LABEL =
  injectedDesktopAppBranding?.stageLabel ??
  HOSTED_APP_CHANNEL_LABEL ??
  (import.meta.env.DEV ? "Dev" : "Stable");
export const APP_DISPLAY_NAME =
  injectedDesktopAppBranding?.displayName ??
  (APP_STAGE_LABEL === "Stable" ? APP_BASE_NAME : `${APP_BASE_NAME} (${APP_STAGE_LABEL})`);
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";

export function formatBrandedRuntimeLabel(value: string): string {
  return value.trim().toLowerCase() === "electron" ? APP_BASE_NAME : value;
}

export function formatBrandedRuntimeText(value: string): string {
  return value.replace(/\belectron(?:\.exe)?\b/giu, (match) =>
    match.toLowerCase().endsWith(".exe") ? `${APP_BASE_NAME}.exe` : APP_BASE_NAME,
  );
}
