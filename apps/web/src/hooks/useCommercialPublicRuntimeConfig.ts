import type { CommercialPublicRuntimeConfigSchema } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { resolveCommercialAccountWebBaseUrl } from "../lib/commercialAccountLinks";

let cachedRuntimeConfig: CommercialPublicRuntimeConfigSchema | null | undefined;
let runtimeConfigPromise: Promise<CommercialPublicRuntimeConfigSchema | null> | null = null;
let lastRefreshStartedAt = 0;
let browserRefreshListenersInstalled = false;
let runtimeConfigEventSource: EventSource | null = null;
let runtimeConfigEventSourceBaseUrl: string | null = null;

const AUTO_REFRESH_MIN_INTERVAL_MS = 30_000;
const PUBLIC_RUNTIME_CONFIG_CHANGED_EVENT = "public-runtime-config-changed";
const runtimeConfigListeners = new Set<() => void>();

export interface RefreshCommercialPublicRuntimeConfigOptions {
  force?: boolean;
}

function fetchCommercialPublicRuntimeConfig(
  accountWebBaseUrl: string,
): Promise<CommercialPublicRuntimeConfigSchema | null> {
  const configUrl = new URL("/api/public-runtime-config", accountWebBaseUrl).toString();
  return fetch(configUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (!response.ok) {
      return null;
    }
    return response.json() as Promise<CommercialPublicRuntimeConfigSchema>;
  });
}

function canUseDesktopPublicRuntimeConfigBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return typeof window.desktopBridge?.getCommercialPublicRuntimeConfig === "function";
}

function loadCommercialPublicRuntimeConfig(
  accountWebBaseUrl: string,
): Promise<CommercialPublicRuntimeConfigSchema | null> {
  if (cachedRuntimeConfig !== undefined) {
    return Promise.resolve(cachedRuntimeConfig);
  }
  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const getConfigFromDesktopBridge = bridge?.getCommercialPublicRuntimeConfig;
  runtimeConfigPromise = (
    getConfigFromDesktopBridge
      ? getConfigFromDesktopBridge({ accountWebBaseUrl })
      : fetchCommercialPublicRuntimeConfig(accountWebBaseUrl)
  )
    .then((config) => {
      cachedRuntimeConfig = config;
      notifyCommercialPublicRuntimeConfigListeners();
      return config;
    })
    .finally(() => {
      runtimeConfigPromise = null;
    });

  return runtimeConfigPromise;
}

export function refreshCommercialPublicRuntimeConfig(
  options: RefreshCommercialPublicRuntimeConfigOptions = {},
): Promise<CommercialPublicRuntimeConfigSchema | null> {
  const accountWebBaseUrl = resolveCommercialAccountWebBaseUrl();
  if (!options.force && cachedRuntimeConfig !== undefined) {
    return Promise.resolve(cachedRuntimeConfig);
  }
  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  const previousConfig = cachedRuntimeConfig;
  if (options.force) {
    cachedRuntimeConfig = undefined;
  }
  lastRefreshStartedAt = Date.now();
  return loadCommercialPublicRuntimeConfig(accountWebBaseUrl).catch(() => {
    cachedRuntimeConfig = previousConfig ?? null;
    notifyCommercialPublicRuntimeConfigListeners();
    return cachedRuntimeConfig ?? null;
  });
}

function refreshCommercialPublicRuntimeConfigIfStale(): void {
  if (Date.now() - lastRefreshStartedAt < AUTO_REFRESH_MIN_INTERVAL_MS) {
    return;
  }
  void refreshCommercialPublicRuntimeConfig({ force: true });
}

function notifyCommercialPublicRuntimeConfigListeners(): void {
  for (const listener of runtimeConfigListeners) {
    listener();
  }
}

function subscribeCommercialPublicRuntimeConfig(listener: () => void): () => void {
  runtimeConfigListeners.add(listener);
  return () => {
    runtimeConfigListeners.delete(listener);
  };
}

function installBrowserRefreshListeners(accountWebBaseUrl: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!browserRefreshListenersInstalled) {
    browserRefreshListenersInstalled = true;
    window.addEventListener("focus", refreshCommercialPublicRuntimeConfigIfStale);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshCommercialPublicRuntimeConfigIfStale();
      }
    });
  }

  connectRuntimeConfigEventSource(accountWebBaseUrl);
}

function connectRuntimeConfigEventSource(accountWebBaseUrl: string): void {
  if (!shouldConnectCommercialPublicRuntimeConfigEventSource()) {
    runtimeConfigEventSource?.close();
    runtimeConfigEventSource = null;
    runtimeConfigEventSourceBaseUrl = null;
    return;
  }
  if (runtimeConfigEventSource !== null && runtimeConfigEventSourceBaseUrl === accountWebBaseUrl) {
    return;
  }

  runtimeConfigEventSource?.close();
  runtimeConfigEventSourceBaseUrl = accountWebBaseUrl;

  const eventsUrl = new URL("/api/public-runtime-config/events", accountWebBaseUrl).toString();
  const eventSource = new window.EventSource(eventsUrl);
  runtimeConfigEventSource = eventSource;

  eventSource.addEventListener(PUBLIC_RUNTIME_CONFIG_CHANGED_EVENT, () => {
    void refreshCommercialPublicRuntimeConfig({ force: true });
  });
  eventSource.onerror = () => {
    eventSource.close();
    if (runtimeConfigEventSource === eventSource) {
      runtimeConfigEventSource = null;
      runtimeConfigEventSourceBaseUrl = null;
    }
  };
}

export function shouldConnectCommercialPublicRuntimeConfigEventSource(): boolean {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return false;
  }
  if (canUseDesktopPublicRuntimeConfigBridge()) {
    return false;
  }
  return true;
}

export function readCommercialPublicRuntimeFlag(
  config: CommercialPublicRuntimeConfigSchema | null | undefined,
  key: keyof CommercialPublicRuntimeConfigSchema["featureFlags"],
  fallback: boolean,
): boolean {
  const value = config?.featureFlags?.[key];
  return value === undefined || value === null ? fallback : Boolean(value);
}

export function useCommercialPublicRuntimeFlag(
  key: keyof CommercialPublicRuntimeConfigSchema["featureFlags"],
  fallback: boolean,
): boolean {
  const [config, setConfig] = useState(cachedRuntimeConfig);

  useEffect(() => {
    const accountWebBaseUrl = resolveCommercialAccountWebBaseUrl();
    installBrowserRefreshListeners(accountWebBaseUrl);

    const unsubscribe = subscribeCommercialPublicRuntimeConfig(() => {
      setConfig(cachedRuntimeConfig);
    });
    void refreshCommercialPublicRuntimeConfig();

    return () => {
      unsubscribe();
    };
  }, []);

  return readCommercialPublicRuntimeFlag(config, key, fallback);
}

export function useCommercialUpgradeEntryEnabled(): boolean {
  return useCommercialPublicRuntimeFlag("upgradeEntryEnabled", false);
}

export function useT3ClientModelSelectorEnabled(): boolean {
  return useCommercialPublicRuntimeFlag("t3ClientModelSelectorEnabled", true);
}

export function __resetCommercialPublicRuntimeConfigForTests(): void {
  cachedRuntimeConfig = undefined;
  runtimeConfigPromise = null;
  lastRefreshStartedAt = 0;
  browserRefreshListenersInstalled = false;
  runtimeConfigEventSource?.close();
  runtimeConfigEventSource = null;
  runtimeConfigEventSourceBaseUrl = null;
  runtimeConfigListeners.clear();
}
