import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

import * as NetService from "@t3tools/shared/Net";
import { resolveRemoteT3CliPackageSpec } from "@t3tools/ssh/command";
import type { RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";
import serverPackageJson from "../../server/package.json" with { type: "json" };

import type { DesktopSettings as DesktopSettingsValue } from "./settings/DesktopAppSettings.ts";
import * as DesktopIpc from "./ipc/DesktopIpc.ts";
import * as IpcChannels from "./ipc/channels.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronDialog from "./electron/ElectronDialog.ts";
import * as ElectronMenu from "./electron/ElectronMenu.ts";
import * as ElectronProtocol from "./electron/ElectronProtocol.ts";
import * as DesktopSecretStorage from "./electron/ElectronSafeStorage.ts";
import * as ElectronShell from "./electron/ElectronShell.ts";
import * as ElectronTheme from "./electron/ElectronTheme.ts";
import * as ElectronUpdater from "./electron/ElectronUpdater.ts";
import * as ElectronWindow from "./electron/ElectronWindow.ts";
import * as DesktopApp from "./app/DesktopApp.ts";
import * as DesktopAppIdentity from "./app/DesktopAppIdentity.ts";
import * as DesktopApplicationMenu from "./window/DesktopApplicationMenu.ts";
import * as DesktopAssets from "./app/DesktopAssets.ts";
import * as DesktopBackendConfiguration from "./backend/DesktopBackendConfiguration.ts";
import * as DesktopBackendManager from "./backend/DesktopBackendManager.ts";
import * as DesktopBrowserAutomationHost from "./browser/DesktopBrowserAutomationHost.ts";
import * as DesktopBrowserExternalAutomationHost from "./browser/DesktopBrowserExternalAutomationHost.ts";
import * as DesktopComputerAutomationHost from "./computer/DesktopComputerAutomationHost.ts";
import * as DesktopEngineIntegrity from "./engine/DesktopEngineIntegrity.ts";
import * as DesktopEngineUpdater from "./engine/DesktopEngineUpdater.ts";
import * as DesktopEnvironment from "./app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "./app/DesktopLifecycle.ts";
import * as DesktopObservability from "./app/DesktopObservability.ts";
import * as DesktopServerExposure from "./backend/DesktopServerExposure.ts";
import * as DesktopCommercialAuth from "./settings/DesktopCommercialAuth.ts";
import * as DesktopClientSettings from "./settings/DesktopClientSettings.ts";
import * as DesktopSavedEnvironments from "./settings/DesktopSavedEnvironments.ts";
import * as DesktopAppSettings from "./settings/DesktopAppSettings.ts";
import * as DesktopShellEnvironment from "./shell/DesktopShellEnvironment.ts";
import * as DesktopWindowsSandbox from "./security/DesktopWindowsSandbox.ts";
import * as DesktopSshEnvironment from "./ssh/DesktopSshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "./ssh/DesktopSshPasswordPrompts.ts";
import * as DesktopSshRemoteApi from "./ssh/DesktopSshRemoteApi.ts";
import * as DesktopState from "./app/DesktopState.ts";
import * as DesktopApm from "./telemetry/DesktopApm.ts";
import * as DesktopInstallationIdentity from "./telemetry/DesktopInstallationIdentity.ts";
import * as DesktopUpdates from "./updates/DesktopUpdates.ts";
import * as DesktopWindow from "./window/DesktopWindow.ts";

const desktopEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );
    return DesktopEnvironment.layer({
      dirname: __dirname,
      homeDirectory: NodeOS.homedir(),
      platform: process.platform,
      processArch: process.arch,
      ...metadata,
    });
  }),
);

const resolveDesktopSshCliRunner = (
  environment: DesktopEnvironment.DesktopEnvironmentShape,
  settings: DesktopSettingsValue,
): RemoteT3RunnerOptions => {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteT3ServerEntryPath);
  if (environment.isDevelopment && devRemoteEntryPath !== undefined) {
    return {
      nodeScriptPath: devRemoteEntryPath,
      nodeEngineRange: serverPackageJson.engines.node,
    };
  }
  return {
    packageSpec: resolveRemoteT3CliPackageSpec({
      appVersion: environment.appVersion,
      updateChannel: settings.updateChannel,
      isDevelopment: environment.isDevelopment,
    }),
    nodeEngineRange: serverPackageJson.engines.node,
  };
};

const desktopSshEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    return DesktopSshEnvironment.layer({
      resolveCliRunner: settings.get.pipe(
        Effect.map((currentSettings) => resolveDesktopSshCliRunner(environment, currentSettings)),
      ),
    });
  }),
);

const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronProtocol.layer,
  DesktopSecretStorage.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  Layer.succeed(DesktopIpc.DesktopIpc, DesktopIpc.make(Electron.ipcMain)),
);

const desktopFoundationBaseLayer = Layer.mergeAll(
  DesktopState.layer,
  DesktopLifecycle.layerShutdown,
  DesktopAppSettings.layer,
  DesktopCommercialAuth.layer,
  DesktopClientSettings.layer,
  DesktopSavedEnvironments.layer,
  DesktopAssets.layer,
  DesktopEngineIntegrity.layer,
  DesktopEngineUpdater.layer,
  DesktopObservability.layer,
).pipe(Layer.provideMerge(desktopEnvironmentLayer));

const desktopFoundationLayer = DesktopWindowsSandbox.layer.pipe(
  Layer.provideMerge(desktopFoundationBaseLayer),
);

const desktopApmLayer = DesktopApm.layer.pipe(
  Layer.provideMerge(DesktopInstallationIdentity.layer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopSshLayer = Layer.mergeAll(desktopSshEnvironmentLayer, DesktopSshRemoteApi.layer).pipe(
  Layer.provideMerge(DesktopSshPasswordPrompts.layer()),
);

const desktopServerExposureLayer = DesktopServerExposure.layer.pipe(
  Layer.provideMerge(DesktopServerExposure.networkInterfacesLayer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopWindowLayer = DesktopWindow.layer.pipe(Layer.provideMerge(desktopServerExposureLayer));

const desktopBackendLayer = DesktopBackendManager.layer.pipe(
  Layer.provideMerge(DesktopAppIdentity.layer),
  Layer.provideMerge(DesktopBackendConfiguration.layer),
  Layer.provideMerge(DesktopBrowserAutomationHost.layer),
  Layer.provideMerge(DesktopBrowserExternalAutomationHost.layer),
  Layer.provideMerge(DesktopComputerAutomationHost.layer),
  Layer.provideMerge(desktopApmLayer),
  Layer.provideMerge(desktopWindowLayer),
);

const desktopBrowserAutomationIpcLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    const host = yield* DesktopBrowserAutomationHost.DesktopBrowserAutomationHost;
    yield* ipc.handle({
      channel: IpcChannels.BROWSER_AUTOMATION_GET_STATE_CHANNEL,
      handler: () => host.state,
    });
    yield* ipc.handle({
      channel: IpcChannels.BROWSER_AUTOMATION_SET_BOUNDS_CHANNEL,
      handler: (raw) => {
        const bounds = raw as {
          readonly x?: unknown;
          readonly y?: unknown;
          readonly width?: unknown;
          readonly height?: unknown;
          readonly visible?: unknown;
        };
        return host.setPanelBounds({
          x: typeof bounds.x === "number" ? bounds.x : 0,
          y: typeof bounds.y === "number" ? bounds.y : 0,
          width: typeof bounds.width === "number" ? bounds.width : 0,
          height: typeof bounds.height === "number" ? bounds.height : 0,
          visible: bounds.visible === true,
        });
      },
    });
    yield* ipc.handle({
      channel: IpcChannels.BROWSER_AUTOMATION_NAVIGATE_CHANNEL,
      handler: (raw) => {
        if (typeof raw !== "string") {
          return host.state;
        }
        return host.navigate(raw);
      },
    });
    yield* ipc.handle({
      channel: IpcChannels.BROWSER_AUTOMATION_RELOAD_CHANNEL,
      handler: () => host.reload,
    });
    yield* ipc.handle({
      channel: IpcChannels.BROWSER_AUTOMATION_GO_BACK_CHANNEL,
      handler: () => host.goBack,
    });
    yield* ipc.handle({
      channel: IpcChannels.BROWSER_AUTOMATION_GO_FORWARD_CHANNEL,
      handler: () => host.goForward,
    });
  }),
);

const desktopComputerAutomationIpcLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    const host = yield* DesktopComputerAutomationHost.DesktopComputerAutomationHost;
    yield* ipc.handle({
      channel: IpcChannels.COMPUTER_AUTOMATION_GET_STATE_CHANNEL,
      handler: () => host.state,
    });
    yield* ipc.handle({
      channel: IpcChannels.COMPUTER_AUTOMATION_SET_PAUSED_CHANNEL,
      handler: (raw) => host.setPaused(raw === true),
    });
    yield* ipc.handle({
      channel: IpcChannels.COMPUTER_AUTOMATION_ALLOW_FOREGROUND_APP_CHANNEL,
      handler: () => host.allowForegroundApp(),
    });
    yield* ipc.handle({
      channel: IpcChannels.COMPUTER_AUTOMATION_REMOVE_APP_PERMISSION_CHANNEL,
      handler: (raw) => host.removeAppPermission(typeof raw === "string" ? raw : ""),
    });
    yield* ipc.handle({
      channel: IpcChannels.COMPUTER_AUTOMATION_CLEAR_APP_PERMISSIONS_CHANNEL,
      handler: () => host.clearAppPermissions(),
    });
  }),
);

const desktopBrowserExternalAutomationIpcLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    const host =
      yield* DesktopBrowserExternalAutomationHost.DesktopBrowserExternalAutomationHost;
    yield* ipc.handle({
      channel: IpcChannels.BROWSER_EXTERNAL_AUTOMATION_GET_STATE_CHANNEL,
      handler: () => host.state,
    });
  }),
);

const desktopApplicationLayer = Layer.mergeAll(
  DesktopLifecycle.layer,
  DesktopApplicationMenu.layer,
  DesktopShellEnvironment.layer,
  desktopBrowserAutomationIpcLayer,
  desktopBrowserExternalAutomationIpcLayer,
  desktopComputerAutomationIpcLayer,
  desktopSshLayer,
).pipe(
  Layer.provideMerge(desktopApmLayer),
  Layer.provideMerge(DesktopUpdates.layer),
  Layer.provideMerge(desktopBackendLayer),
);

const desktopRuntimeLayer = ElectronProtocol.layerSchemePrivileges.pipe(
  Layer.flatMap(() =>
    desktopApplicationLayer.pipe(
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(NodeHttpClient.layerUndici),
      Layer.provideMerge(NetService.layer),
      Layer.provideMerge(electronLayer),
    ),
  ),
);

DesktopApp.program.pipe(Effect.provide(desktopRuntimeLayer), NodeRuntime.runMain);
