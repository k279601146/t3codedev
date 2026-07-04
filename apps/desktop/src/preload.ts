import type { DesktopBridge } from "@t3tools/contracts";
import { contextBridge, ipcRenderer, webUtils } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

function unwrapEnsureSshEnvironmentResult(result: unknown) {
  if (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    result.type === IpcChannels.SSH_PASSWORD_PROMPT_CANCELLED_RESULT
  ) {
    const message =
      "message" in result && typeof result.message === "string"
        ? result.message
        : "SSH authentication cancelled.";
    throw new Error(message);
  }
  return result as Awaited<ReturnType<DesktopBridge["ensureSshEnvironment"]>>;
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getAppBranding"]>;
  },
  getLocalEnvironmentBootstrap: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstrap"]>;
  },
  getDesktopBackendHealth: () =>
    ipcRenderer.invoke(IpcChannels.GET_DESKTOP_BACKEND_HEALTH_CHANNEL),
  getCommercialAuthState: () => ipcRenderer.invoke(IpcChannels.GET_COMMERCIAL_AUTH_STATE_CHANNEL),
  signInCommercialAuth: (input) =>
    ipcRenderer.invoke(IpcChannels.SIGN_IN_COMMERCIAL_AUTH_CHANNEL, input),
  signInCommercialAuthWithBrowser: (input) =>
    ipcRenderer.invoke(IpcChannels.SIGN_IN_COMMERCIAL_AUTH_WITH_BROWSER_CHANNEL, input),
  cancelCommercialAuthBrowserSignIn: (input) =>
    ipcRenderer.invoke(IpcChannels.CANCEL_COMMERCIAL_AUTH_BROWSER_SIGN_IN_CHANNEL, input),
  signOutCommercialAuth: () => ipcRenderer.invoke(IpcChannels.SIGN_OUT_COMMERCIAL_AUTH_CHANNEL),
  getCommercialAccountUsage: () =>
    ipcRenderer.invoke(IpcChannels.GET_COMMERCIAL_ACCOUNT_USAGE_CHANNEL),
  getCommercialPublicRuntimeConfig: (input) =>
    ipcRenderer.invoke(IpcChannels.GET_COMMERCIAL_PUBLIC_RUNTIME_CONFIG_CHANNEL, input ?? {}),
  getClientSettings: () => ipcRenderer.invoke(IpcChannels.GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.SET_CLIENT_SETTINGS_CHANNEL, settings),
  getSavedEnvironmentRegistry: () =>
    ipcRenderer.invoke(IpcChannels.GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL),
  setSavedEnvironmentRegistry: (records) =>
    ipcRenderer.invoke(IpcChannels.SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, records),
  getSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(IpcChannels.GET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  setSavedEnvironmentSecret: (environmentId, secret) =>
    ipcRenderer.invoke(IpcChannels.SET_SAVED_ENVIRONMENT_SECRET_CHANNEL, { environmentId, secret }),
  removeSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(IpcChannels.REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  discoverSshHosts: () => ipcRenderer.invoke(IpcChannels.DISCOVER_SSH_HOSTS_CHANNEL),
  ensureSshEnvironment: async (target, options) =>
    unwrapEnsureSshEnvironmentResult(
      await ipcRenderer.invoke(IpcChannels.ENSURE_SSH_ENVIRONMENT_CHANNEL, {
        target,
        ...(options === undefined ? {} : { options }),
      }),
    ),
  disconnectSshEnvironment: (target) =>
    ipcRenderer.invoke(IpcChannels.DISCONNECT_SSH_ENVIRONMENT_CHANNEL, target),
  fetchSshEnvironmentDescriptor: (httpBaseUrl) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL, { httpBaseUrl }),
  bootstrapSshBearerSession: (httpBaseUrl, credential) =>
    ipcRenderer.invoke(IpcChannels.BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL, {
      httpBaseUrl,
      credential,
    }),
  fetchSshSessionState: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_SESSION_STATE_CHANNEL, { httpBaseUrl, bearerToken }),
  issueSshWebSocketToken: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(IpcChannels.ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL, { httpBaseUrl, bearerToken }),
  onSshPasswordPrompt: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (typeof request !== "object" || request === null) return;
      listener(request as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    };
  },
  resolveSshPasswordPrompt: (requestId, password) =>
    ipcRenderer.invoke(IpcChannels.RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL, { requestId, password }),
  getServerExposureState: () => ipcRenderer.invoke(IpcChannels.GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) =>
    ipcRenderer.invoke(IpcChannels.SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  setTailscaleServeEnabled: (input) =>
    ipcRenderer.invoke(IpcChannels.SET_TAILSCALE_SERVE_ENABLED_CHANNEL, input),
  getAdvertisedEndpoints: () => ipcRenderer.invoke(IpcChannels.GET_ADVERTISED_ENDPOINTS_CHANNEL),
  repairWindowsSandboxFirewall: () =>
    ipcRenderer.invoke(IpcChannels.REPAIR_WINDOWS_SANDBOX_FIREWALL_CHANNEL),
  setWindowsSandboxMode: (input) =>
    ipcRenderer.invoke(IpcChannels.SET_WINDOWS_SANDBOX_MODE_CHANNEL, input),
  pickFolder: (options) => ipcRenderer.invoke(IpcChannels.PICK_FOLDER_CHANNEL, options),
  confirm: (message) => ipcRenderer.invoke(IpcChannels.CONFIRM_CHANNEL, message),
  showNotification: (input) =>
    ipcRenderer.invoke(IpcChannels.SHOW_NOTIFICATION_CHANNEL, input),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannels.SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) =>
    ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_CHANNEL, {
      items,
      ...(position === undefined ? {} : { position }),
    }),
  getPathForFile: (file) => {
    if (!(file instanceof File)) {
      return null;
    }
    return webUtils.getPathForFile(file) || null;
  },
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL_CHANNEL, url),
  createCloudAuthRequest: () => ipcRenderer.invoke(IpcChannels.CREATE_CLOUD_AUTH_REQUEST_CHANNEL),
  getCloudAuthToken: () => ipcRenderer.invoke(IpcChannels.GET_CLOUD_AUTH_TOKEN_CHANNEL),
  setCloudAuthToken: (token: string) =>
    ipcRenderer.invoke(IpcChannels.SET_CLOUD_AUTH_TOKEN_CHANNEL, token),
  clearCloudAuthToken: () => ipcRenderer.invoke(IpcChannels.CLEAR_CLOUD_AUTH_TOKEN_CHANNEL),
  fetchCloudAuth: (input) => ipcRenderer.invoke(IpcChannels.FETCH_CLOUD_AUTH_CHANNEL, input),
  onCloudAuthCallback: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, rawUrl: unknown) => {
      if (typeof rawUrl !== "string") return;
      listener(rawUrl);
    };

    ipcRenderer.on(IpcChannels.CLOUD_AUTH_CALLBACK_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.CLOUD_AUTH_CALLBACK_CHANNEL, wrappedListener);
    };
  },
  openPath: (path: string) => ipcRenderer.invoke(IpcChannels.OPEN_PATH_CHANNEL, path),
  revealPath: (path: string) => ipcRenderer.invoke(IpcChannels.REVEAL_PATH_CHANNEL, path),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getBrowserAutomationState: () =>
    ipcRenderer.invoke(IpcChannels.BROWSER_AUTOMATION_GET_STATE_CHANNEL),
  navigateBrowserAutomation: (url) =>
    ipcRenderer.invoke(IpcChannels.BROWSER_AUTOMATION_NAVIGATE_CHANNEL, url),
  reloadBrowserAutomation: () => ipcRenderer.invoke(IpcChannels.BROWSER_AUTOMATION_RELOAD_CHANNEL),
  goBackBrowserAutomation: () => ipcRenderer.invoke(IpcChannels.BROWSER_AUTOMATION_GO_BACK_CHANNEL),
  goForwardBrowserAutomation: () =>
    ipcRenderer.invoke(IpcChannels.BROWSER_AUTOMATION_GO_FORWARD_CHANNEL),
  setBrowserAutomationBounds: (bounds) =>
    ipcRenderer.invoke(IpcChannels.BROWSER_AUTOMATION_SET_BOUNDS_CHANNEL, bounds),
  onBrowserAutomationState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.BROWSER_AUTOMATION_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.BROWSER_AUTOMATION_STATE_CHANNEL, wrappedListener);
    };
  },
  getBrowserExternalAutomationState: () =>
    ipcRenderer.invoke(IpcChannels.BROWSER_EXTERNAL_AUTOMATION_GET_STATE_CHANNEL),
  onBrowserExternalAutomationState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.BROWSER_EXTERNAL_AUTOMATION_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(
        IpcChannels.BROWSER_EXTERNAL_AUTOMATION_STATE_CHANNEL,
        wrappedListener,
      );
    };
  },
  getComputerAutomationState: () =>
    ipcRenderer.invoke(IpcChannels.COMPUTER_AUTOMATION_GET_STATE_CHANNEL),
  setComputerAutomationPaused: (paused) =>
    ipcRenderer.invoke(IpcChannels.COMPUTER_AUTOMATION_SET_PAUSED_CHANNEL, paused),
  allowComputerAutomationForegroundApp: () =>
    ipcRenderer.invoke(IpcChannels.COMPUTER_AUTOMATION_ALLOW_FOREGROUND_APP_CHANNEL),
  removeComputerAutomationAppPermission: (appKey) =>
    ipcRenderer.invoke(IpcChannels.COMPUTER_AUTOMATION_REMOVE_APP_PERMISSION_CHANNEL, appKey),
  clearComputerAutomationAppPermissions: () =>
    ipcRenderer.invoke(IpcChannels.COMPUTER_AUTOMATION_CLEAR_APP_PERMISSIONS_CHANNEL),
  onComputerAutomationState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.COMPUTER_AUTOMATION_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.COMPUTER_AUTOMATION_STATE_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE_CHANNEL),
  setUpdateChannel: (channel) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_SET_CHANNEL_CHANNEL, channel),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
