import type { ContextMenuItem, LocalApi } from "@t3tools/contracts";

import { resetGitStatusStateForTests } from "./lib/gitStatusState";
import { resetSourceControlDiscoveryStateForTests } from "./lib/sourceControlDiscoveryState";
import { resetRequestLatencyStateForTests } from "./rpc/requestLatencyState";
import { resetServerStateForTests } from "./rpc/serverState";
import { resetWsConnectionStateForTests } from "./rpc/wsConnectionState";
import {
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
} from "./environments/runtime";
import {
  getPrimaryEnvironmentConnection,
  resetEnvironmentServiceForTests,
} from "./environments/runtime";
import { getPrimaryKnownEnvironment } from "./environments/primary";
import { type WsRpcClient } from "./rpc/wsRpcClient";
import { showContextMenuFallback } from "./contextMenuFallback";
import {
  readBrowserClientSettings,
  readBrowserSavedEnvironmentRegistry,
  readBrowserSavedEnvironmentSecret,
  removeBrowserSavedEnvironmentSecret,
  writeBrowserClientSettings,
  writeBrowserSavedEnvironmentRegistry,
  writeBrowserSavedEnvironmentSecret,
} from "./clientPersistenceStorage";

let cachedApi: LocalApi | undefined;

function unavailableLocalBackendError(): Error {
  return new Error("Local backend API is unavailable before a backend is paired.");
}

function createBrowserLocalApi(rpcClient?: WsRpcClient): LocalApi {
  return {
    dialogs: {
      pickFolder: async (options) => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder(options);
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    shell: {
      openInEditor: (cwd, editor) =>
        rpcClient
          ? rpcClient.shell.openInEditor({ cwd, editor })
          : Promise.reject(unavailableLocalBackendError()),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
      openPath: async (path) => {
        if (!window.desktopBridge) {
          throw unavailableLocalBackendError();
        }
        const opened = await window.desktopBridge.openPath(path);
        if (!opened) {
          throw new Error("Unable to open path.");
        }
      },
      revealPath: async (path) => {
        if (!window.desktopBridge) {
          throw unavailableLocalBackendError();
        }
        if (window.desktopBridge.revealPath) {
          const revealed = await window.desktopBridge.revealPath(path);
          if (revealed) {
            return;
          }
        }
        const lastSlashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        const directoryPath =
          lastSlashIndex === 2 && /^[A-Za-z]:[\\/]/u.test(path)
            ? path.slice(0, 3)
            : lastSlashIndex > 0
              ? path.slice(0, lastSlashIndex)
              : lastSlashIndex === 0 && path.startsWith("/")
                ? "/"
                : null;
        if (!directoryPath) {
          throw new Error("Unable to resolve containing folder.");
        }
        const opened = await window.desktopBridge.openPath(directoryPath);
        if (!opened) {
          throw new Error(`Unable to reveal path: ${path}`);
        }
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    persistence: {
      getClientSettings: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getClientSettings();
        }
        return readBrowserClientSettings();
      },
      setClientSettings: async (settings) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setClientSettings(settings);
        }
        writeBrowserClientSettings(settings);
      },
      getSavedEnvironmentRegistry: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getSavedEnvironmentRegistry();
        }
        return readBrowserSavedEnvironmentRegistry();
      },
      setSavedEnvironmentRegistry: async (records) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setSavedEnvironmentRegistry(records);
        }
        writeBrowserSavedEnvironmentRegistry(records);
      },
      getSavedEnvironmentSecret: async (environmentId) => {
        if (window.desktopBridge) {
          return window.desktopBridge.getSavedEnvironmentSecret(environmentId);
        }
        return readBrowserSavedEnvironmentSecret(environmentId);
      },
      setSavedEnvironmentSecret: async (environmentId, secret) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setSavedEnvironmentSecret(environmentId, secret);
        }
        return writeBrowserSavedEnvironmentSecret(environmentId, secret);
      },
      removeSavedEnvironmentSecret: async (environmentId) => {
        if (window.desktopBridge) {
          return window.desktopBridge.removeSavedEnvironmentSecret(environmentId);
        }
        removeBrowserSavedEnvironmentSecret(environmentId);
      },
    },
    ...(window.desktopBridge?.getDesktopBackendHealth
      ? {
          diagnostics: {
            getDesktopBackendHealth: async () =>
              window.desktopBridge?.getDesktopBackendHealth?.() ?? null,
          },
        }
      : {}),
    remoteControl: {
      getSnapshot: () =>
        rpcClient
          ? rpcClient.remoteControl.getSnapshot()
          : Promise.reject(unavailableLocalBackendError()),
      enable: (input) =>
        rpcClient
          ? rpcClient.remoteControl.enable(input)
          : Promise.reject(unavailableLocalBackendError()),
      disable: (input) =>
        rpcClient
          ? rpcClient.remoteControl.disable(input)
          : Promise.reject(unavailableLocalBackendError()),
      getStatus: () =>
        rpcClient
          ? rpcClient.remoteControl.getStatus()
          : Promise.reject(unavailableLocalBackendError()),
      startPairing: (input) =>
        rpcClient
          ? rpcClient.remoteControl.startPairing(input)
          : Promise.reject(unavailableLocalBackendError()),
      getPairingStatus: (input) =>
        rpcClient
          ? rpcClient.remoteControl.getPairingStatus(input)
          : Promise.reject(unavailableLocalBackendError()),
      listClients: (input) =>
        rpcClient
          ? rpcClient.remoteControl.listClients(input)
          : Promise.reject(unavailableLocalBackendError()),
      revokeClient: (input) =>
        rpcClient
          ? rpcClient.remoteControl.revokeClient(input)
          : Promise.reject(unavailableLocalBackendError()),
      updateQqBotConfig: (input) =>
        rpcClient
          ? rpcClient.remoteControl.updateQqBotConfig(input)
          : Promise.reject(unavailableLocalBackendError()),
      listQqBindings: () =>
        rpcClient
          ? rpcClient.remoteControl.listQqBindings()
          : Promise.reject(unavailableLocalBackendError()),
      revokeQqBinding: (input) =>
        rpcClient
          ? rpcClient.remoteControl.revokeQqBinding(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
    server: {
      getConfig: () =>
        rpcClient ? rpcClient.server.getConfig() : Promise.reject(unavailableLocalBackendError()),
      refreshProviders: (input) =>
        rpcClient
          ? rpcClient.server.refreshProviders(input)
          : Promise.reject(unavailableLocalBackendError()),
      updateProvider: (input) =>
        rpcClient
          ? rpcClient.server.updateProvider(input)
          : Promise.reject(unavailableLocalBackendError()),
      upsertKeybinding: (input) =>
        rpcClient
          ? rpcClient.server.upsertKeybinding(input)
          : Promise.reject(unavailableLocalBackendError()),
      removeKeybinding: (input) =>
        rpcClient
          ? rpcClient.server.removeKeybinding(input)
          : Promise.reject(unavailableLocalBackendError()),
      getSettings: () =>
        rpcClient ? rpcClient.server.getSettings() : Promise.reject(unavailableLocalBackendError()),
      updateSettings: (patch) =>
        rpcClient
          ? rpcClient.server.updateSettings(patch)
          : Promise.reject(unavailableLocalBackendError()),
      getCodexGlobalGuidance: () =>
        rpcClient
          ? rpcClient.server.getCodexGlobalGuidance()
          : Promise.reject(unavailableLocalBackendError()),
      updateCodexGlobalGuidance: (input) =>
        rpcClient
          ? rpcClient.server.updateCodexGlobalGuidance(input)
          : Promise.reject(unavailableLocalBackendError()),
      discoverSourceControl: () =>
        rpcClient
          ? rpcClient.server.discoverSourceControl()
          : Promise.reject(unavailableLocalBackendError()),
      getTraceDiagnostics: () =>
        rpcClient
          ? rpcClient.server.getTraceDiagnostics()
          : Promise.reject(unavailableLocalBackendError()),
      getProcessDiagnostics: () =>
        rpcClient
          ? rpcClient.server.getProcessDiagnostics()
          : Promise.reject(unavailableLocalBackendError()),
      getProcessResourceHistory: (input) =>
        rpcClient
          ? rpcClient.server.getProcessResourceHistory(input)
          : Promise.reject(unavailableLocalBackendError()),
      signalProcess: (input) =>
        rpcClient
          ? rpcClient.server.signalProcess(input)
          : Promise.reject(unavailableLocalBackendError()),
      windowsSandboxReadiness: (input) =>
        rpcClient
          ? rpcClient.server.windowsSandboxReadiness(input)
          : Promise.reject(unavailableLocalBackendError()),
      windowsSandboxSetupStart: (input) =>
        rpcClient
          ? rpcClient.server.windowsSandboxSetupStart(input)
          : Promise.reject(unavailableLocalBackendError()),
      updateThreadSettings: (input) =>
        rpcClient
          ? rpcClient.server.updateThreadSettings(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
  };
}

export function createLocalApi(rpcClient: WsRpcClient): LocalApi {
  return createBrowserLocalApi(rpcClient);
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  const primaryEnvironment = getPrimaryKnownEnvironment();
  cachedApi = primaryEnvironment
    ? createLocalApi(getPrimaryEnvironmentConnection().client)
    : createBrowserLocalApi();
  return cachedApi;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    throw new Error("Local API not found");
  }
  return api;
}

export async function __resetLocalApiForTests() {
  cachedApi = undefined;
  const { __resetClientSettingsPersistenceForTests } = await import("./hooks/useSettings");
  __resetClientSettingsPersistenceForTests();
  await resetEnvironmentServiceForTests();
  resetGitStatusStateForTests();
  resetSourceControlDiscoveryStateForTests();
  resetRequestLatencyStateForTests();
  resetSavedEnvironmentRegistryStoreForTests();
  resetSavedEnvironmentRuntimeStoreForTests();
  resetServerStateForTests();
  resetWsConnectionStateForTests();
}
