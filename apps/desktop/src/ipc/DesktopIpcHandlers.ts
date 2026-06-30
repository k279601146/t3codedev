import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";
import {
  cancelCommercialAuthBrowserSignIn,
  getCommercialAuthState,
  signInCommercialAuth,
  signInCommercialAuthWithBrowser,
  signOutCommercialAuth,
} from "./methods/commercialAuth.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import {
  getSavedEnvironmentRegistry,
  getSavedEnvironmentSecret,
  removeSavedEnvironmentSecret,
  setSavedEnvironmentRegistry,
  setSavedEnvironmentSecret,
} from "./methods/savedEnvironments.ts";
import {
  getCommercialAccountUsage,
  getLastUsedModel,
  listGatewayModels,
  setLastUsedModel,
} from "./methods/gatewayModels.ts";
import {
  getAdvertisedEndpoints,
  getServerExposureState,
  setServerExposureMode,
  setTailscaleServeEnabled,
} from "./methods/serverExposure.ts";
import { repairWindowsSandboxFirewall, setWindowsSandboxMode } from "./methods/windowsSandbox.ts";
import {
  bootstrapSshBearerSession,
  disconnectSshEnvironment,
  discoverSshHosts,
  ensureSshEnvironment,
  fetchSshEnvironmentDescriptor,
  fetchSshSessionState,
  issueSshWebSocketToken,
  resolveSshPasswordPrompt,
} from "./methods/sshEnvironment.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates.ts";
import {
  confirm,
  getAppBranding,
  getDesktopBackendHealth,
  getLocalEnvironmentBootstrap,
  openExternal,
  openPath,
  pickFolder,
  revealPath,
  setTheme,
  showNotification,
  showContextMenu,
} from "./methods/window.ts";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getLocalEnvironmentBootstrap);
  yield* ipc.handle(getDesktopBackendHealth);

  yield* ipc.handle(getCommercialAuthState);
  yield* ipc.handle(signInCommercialAuth);
  yield* ipc.handle(signInCommercialAuthWithBrowser);
  yield* ipc.handle(cancelCommercialAuthBrowserSignIn);
  yield* ipc.handle(signOutCommercialAuth);
  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(getSavedEnvironmentRegistry);
  yield* ipc.handle(setSavedEnvironmentRegistry);
  yield* ipc.handle(getSavedEnvironmentSecret);
  yield* ipc.handle(setSavedEnvironmentSecret);
  yield* ipc.handle(removeSavedEnvironmentSecret);
  yield* ipc.handle(listGatewayModels);
  yield* ipc.handle(getCommercialAccountUsage);
  yield* ipc.handle(getLastUsedModel);
  yield* ipc.handle(setLastUsedModel);

  yield* ipc.handle(discoverSshHosts);
  yield* ipc.handle(ensureSshEnvironment);
  yield* ipc.handle(disconnectSshEnvironment);
  yield* ipc.handle(fetchSshEnvironmentDescriptor);
  yield* ipc.handle(bootstrapSshBearerSession);
  yield* ipc.handle(fetchSshSessionState);
  yield* ipc.handle(issueSshWebSocketToken);
  yield* ipc.handle(resolveSshPasswordPrompt);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);
  yield* ipc.handle(setTailscaleServeEnabled);
  yield* ipc.handle(getAdvertisedEndpoints);
  yield* ipc.handle(repairWindowsSandboxFirewall);
  yield* ipc.handle(setWindowsSandboxMode);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(confirm);
  yield* ipc.handle(showNotification);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openPath);
  yield* ipc.handle(revealPath);

  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
