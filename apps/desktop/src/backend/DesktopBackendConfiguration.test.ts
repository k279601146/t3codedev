import assert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import {
  COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV,
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
} from "@t3tools/shared/commercialEngine";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopEngineIntegrity from "../engine/DesktopEngineIntegrity.ts";
import * as DesktopEngineUpdater from "../engine/DesktopEngineUpdater.ts";
import * as DesktopWindowsSandbox from "../security/DesktopWindowsSandbox.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopCommercialAuth from "../settings/DesktopCommercialAuth.ts";
import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopServerExposure from "./DesktopServerExposure.ts";
import * as DesktopBrowserAutomationHost from "../browser/DesktopBrowserAutomationHost.ts";
import * as DesktopBrowserExternalAutomationHost from "../browser/DesktopBrowserExternalAutomationHost.ts";
import * as DesktopComputerAutomationHost from "../computer/DesktopComputerAutomationHost.ts";

const PersistedServerObservabilitySettingsDocument = Schema.Struct({
  observability: Schema.Struct({
    otlpTracesUrl: Schema.String,
    otlpMetricsUrl: Schema.String,
  }),
});

const encodePersistedServerObservabilitySettingsDocument = Schema.encodeEffect(
  Schema.fromJsonString(PersistedServerObservabilitySettingsDocument),
);

const serverExposureLayer = Layer.succeed(DesktopServerExposure.DesktopServerExposure, {
  getState: Effect.die("unexpected getState"),
  backendConfig: Effect.succeed({
    port: 4888,
    bindHost: "0.0.0.0",
    httpBaseUrl: new URL("http://127.0.0.1:4888"),
    tailscaleServeEnabled: true,
    tailscaleServePort: 8443,
  }),
  configureFromSettings: () => Effect.die("unexpected configureFromSettings"),
  setMode: () => Effect.die("unexpected setMode"),
  setTailscaleServeEnabled: () => Effect.die("unexpected setTailscaleServeEnabled"),
  getAdvertisedEndpoints: Effect.succeed([]),
} satisfies DesktopServerExposure.DesktopServerExposureShape);

const browserAutomationHostLayer = Layer.succeed(
  DesktopBrowserAutomationHost.DesktopBrowserAutomationHost,
  DesktopBrowserAutomationHost.DesktopBrowserAutomationHost.of({
    endpoint: "http://127.0.0.1:49876",
    token: "browser-token",
    state: Effect.succeed({
      endpoint: "http://127.0.0.1:49876",
      selectedTabId: null,
      tabs: [],
      lastError: null,
      lastScreenshotDataUrl: null,
      lastScreenshotPath: null,
      lastToolCallAt: null,
      toolCallSequence: 0,
      updatedAt: "2026-06-09T00:00:00.000Z",
    }),
    navigate: () =>
      Effect.succeed({
        endpoint: "http://127.0.0.1:49876",
        selectedTabId: null,
        tabs: [],
        lastError: null,
        lastScreenshotDataUrl: null,
        lastScreenshotPath: null,
        lastToolCallAt: null,
        toolCallSequence: 0,
        updatedAt: "2026-06-09T00:00:00.000Z",
      }),
    reload: Effect.succeed({
      endpoint: "http://127.0.0.1:49876",
      selectedTabId: null,
      tabs: [],
      lastError: null,
      lastScreenshotDataUrl: null,
      lastScreenshotPath: null,
      lastToolCallAt: null,
      toolCallSequence: 0,
      updatedAt: "2026-06-09T00:00:00.000Z",
    }),
    goBack: Effect.succeed({
      endpoint: "http://127.0.0.1:49876",
      selectedTabId: null,
      tabs: [],
      lastError: null,
      lastScreenshotDataUrl: null,
      lastScreenshotPath: null,
      lastToolCallAt: null,
      toolCallSequence: 0,
      updatedAt: "2026-06-09T00:00:00.000Z",
    }),
    goForward: Effect.succeed({
      endpoint: "http://127.0.0.1:49876",
      selectedTabId: null,
      tabs: [],
      lastError: null,
      lastScreenshotDataUrl: null,
      lastScreenshotPath: null,
      lastToolCallAt: null,
      toolCallSequence: 0,
      updatedAt: "2026-06-09T00:00:00.000Z",
    }),
    setPanelBounds: () => Effect.void,
    reveal: Effect.void,
  } satisfies DesktopBrowserAutomationHost.DesktopBrowserAutomationHostShape),
);

const computerAutomationState = {
  endpoint: "http://127.0.0.1:49877",
  platform: "win32",
  available: true,
  paused: false,
  allowedApps: [],
  virtualScreen: null,
  cursor: null,
  foregroundWindow: null,
  selectedWindow: null,
  lastAction: null,
  lastError: null,
  lastScreenshotDataUrl: null,
  lastScreenshotPath: null,
  lastToolCallAt: null,
  toolCallSequence: 0,
  updatedAt: "2026-06-09T00:00:00.000Z",
} satisfies DesktopComputerAutomationHost.DesktopComputerAutomationState;

const browserExternalAutomationState = {
  endpoint: "http://127.0.0.1:49878",
  token: "browser-external-token",
  connected: false,
  extensionId: null,
  browserName: null,
  profileName: null,
  selectedTabId: null,
  tabs: [],
  permissions: [],
  lastError: null,
  lastToolCallAt: null,
  toolCallSequence: 0,
  updatedAt: "2026-06-09T00:00:00.000Z",
} satisfies DesktopBrowserExternalAutomationHost.DesktopBrowserExternalAutomationState;

const browserExternalAutomationHostLayer = Layer.succeed(
  DesktopBrowserExternalAutomationHost.DesktopBrowserExternalAutomationHost,
  DesktopBrowserExternalAutomationHost.DesktopBrowserExternalAutomationHost.of({
    endpoint: "http://127.0.0.1:49878",
    token: "browser-external-token",
    state: Effect.succeed(browserExternalAutomationState),
  } satisfies DesktopBrowserExternalAutomationHost.DesktopBrowserExternalAutomationHostShape),
);

const computerAutomationHostLayer = Layer.succeed(
  DesktopComputerAutomationHost.DesktopComputerAutomationHost,
  DesktopComputerAutomationHost.DesktopComputerAutomationHost.of({
    endpoint: "http://127.0.0.1:49877",
    token: "computer-token",
    state: Effect.succeed(computerAutomationState),
    setPaused: () => Effect.succeed(computerAutomationState),
    allowForegroundApp: () => Effect.succeed(computerAutomationState),
    removeAppPermission: () => Effect.succeed(computerAutomationState),
    clearAppPermissions: () => Effect.succeed(computerAutomationState),
  } satisfies DesktopComputerAutomationHost.DesktopComputerAutomationHostShape),
);

function makeEnvironmentLayer(
  baseDir: string,
  options?: {
    readonly isPackaged?: boolean;
    readonly devServerUrl?: string;
  },
) {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: options?.isPackaged ?? true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({
          BAHEW_HOME: baseDir,
          T3CODE_PORT: "9999",
          T3CODE_MODE: "desktop",
          T3CODE_DESKTOP_LAN_HOST: "192.168.1.50",
          VITE_DEV_SERVER_URL: options?.devServerUrl,
        }),
      ),
    ),
  );
}

const withHarness = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
    | DesktopBackendConfiguration.DesktopBackendConfiguration
  >,
  options?: {
    readonly clientSettings?: Parameters<typeof DesktopClientSettings.layerTest>[0];
  },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-backend-config-test-",
    });

    return yield* effect.pipe(
      Effect.provide(
        DesktopBackendConfiguration.layer.pipe(
          Layer.provideMerge(DesktopCommercialAuth.layerTest()),
          Layer.provideMerge(DesktopClientSettings.layerTest(options?.clientSettings)),
          Layer.provideMerge(DesktopEngineIntegrity.layerTest),
          Layer.provideMerge(DesktopEngineUpdater.layerTest()),
          Layer.provideMerge(DesktopWindowsSandbox.layerTest()),
          Layer.provideMerge(serverExposureLayer),
          Layer.provideMerge(browserAutomationHostLayer),
          Layer.provideMerge(browserExternalAutomationHostLayer),
          Layer.provideMerge(computerAutomationHostLayer),
          Layer.provideMerge(makeEnvironmentLayer(baseDir)),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const withProcessEnv = <A, E, R>(
  patch: Record<string, string | undefined>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }),
  );

describe("DesktopBackendConfiguration", () => {
  it.effect("resolves backend start config with a stable scoped bootstrap token", () =>
    withHarness(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;

        const first = yield* configuration.resolve;
        const second = yield* configuration.resolve;

        assert.equal(first.executablePath, process.execPath);
        assert.equal(first.entryPath, environment.backendEntryPath);
        assert.equal(first.cwd, environment.backendCwd);
        assert.equal(first.captureOutput, true);
        assert.equal(first.env.ELECTRON_RUN_AS_NODE, "1");
        assert.equal(first.env.T3CODE_BROWSER_USE_ENDPOINT, "http://127.0.0.1:49876");
        assert.equal(first.env.T3CODE_BROWSER_USE_TOKEN, "browser-token");
        assert.equal(first.env.T3CODE_BROWSER_USE_EXTERNAL_ENDPOINT, "http://127.0.0.1:49878");
        assert.equal(first.env.T3CODE_BROWSER_USE_EXTERNAL_TOKEN, "browser-external-token");
        assert.equal(first.env.T3CODE_COMPUTER_USE_ENDPOINT, "http://127.0.0.1:49877");
        assert.equal(first.env.T3CODE_COMPUTER_USE_TOKEN, "computer-token");
        assert.equal(first.env.T3CODE_PORT, undefined);
        assert.equal(first.env.T3CODE_MODE, undefined);
        assert.equal(first.env.T3CODE_DESKTOP_LAN_HOST, undefined);

        assert.equal(first.bootstrap.mode, "desktop");
        assert.equal(first.bootstrap.noBrowser, true);
        assert.equal(first.bootstrap.port, 4888);
        assert.equal(first.bootstrap.host, "0.0.0.0");
        assert.equal(first.bootstrap.t3Home, environment.baseDir);
        assert.equal(first.bootstrap.tailscaleServeEnabled, true);
        assert.equal(first.bootstrap.tailscaleServePort, 8443);
        assert.match(first.bootstrap.desktopBootstrapToken, /^[0-9a-f]{48}$/i);
        assert.equal(second.bootstrap.desktopBootstrapToken, first.bootstrap.desktopBootstrapToken);
      }),
    ),
  );

  it.effect("includes persisted backend observability endpoints when present", () =>
    withHarness(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;

        yield* fileSystem.makeDirectory(environment.path.dirname(environment.serverSettingsPath), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(
          environment.serverSettingsPath,
          yield* encodePersistedServerObservabilitySettingsDocument({
            observability: {
              otlpTracesUrl: " http://127.0.0.1:4318/v1/traces ",
              otlpMetricsUrl: " http://127.0.0.1:4318/v1/metrics ",
            },
          }),
        );

        const config = yield* configuration.resolve;
        assert.equal(config.bootstrap.otlpTracesUrl, "http://127.0.0.1:4318/v1/traces");
        assert.equal(config.bootstrap.otlpMetricsUrl, "http://127.0.0.1:4318/v1/metrics");
      }),
    ),
  );

  it.effect("omits backend observability endpoints when settings are missing", () =>
    withHarness(
      Effect.gen(function* () {
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
        const config = yield* configuration.resolve;

        assert.equal(config.bootstrap.otlpTracesUrl, undefined);
        assert.equal(config.bootstrap.otlpMetricsUrl, undefined);
      }),
    ),
  );

  it.effect("keeps anonymous telemetry disabled unless the user opts in", () =>
    withHarness(
      Effect.gen(function* () {
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
        const config = yield* configuration.resolve;

        assert.equal(config.env.T3CODE_TELEMETRY_ENABLED, "false");
      }),
    ),
  );

  it.effect("enables anonymous telemetry for the backend after usage consent", () =>
    withHarness(
      Effect.gen(function* () {
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
        const config = yield* configuration.resolve;

        assert.equal(config.env.T3CODE_TELEMETRY_ENABLED, "true");
      }),
      {
        clientSettings: Option.some({
          ...DEFAULT_CLIENT_SETTINGS,
          telemetryConsent: {
            operationalTelemetry: true,
            crashReporting: false,
            usageAnalytics: true,
            improveProduct: false,
          },
        }),
      },
    ),
  );

  it.effect("captures backend output in development so child process logs can be persisted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-backend-config-test-",
      });

      yield* Effect.gen(function* () {
        const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
        const config = yield* configuration.resolve;
        assert.equal(config.captureOutput, true);
      }).pipe(
        Effect.provide(
          DesktopBackendConfiguration.layer.pipe(
            Layer.provideMerge(DesktopCommercialAuth.layerTest()),
            Layer.provideMerge(DesktopClientSettings.layerTest()),
            Layer.provideMerge(DesktopEngineIntegrity.layerTest),
            Layer.provideMerge(DesktopEngineUpdater.layerTest()),
            Layer.provideMerge(DesktopWindowsSandbox.layerTest()),
            Layer.provideMerge(serverExposureLayer),
            Layer.provideMerge(browserAutomationHostLayer),
            Layer.provideMerge(browserExternalAutomationHostLayer),
            Layer.provideMerge(computerAutomationHostLayer),
            Layer.provideMerge(
              makeEnvironmentLayer(baseDir, {
                isPackaged: false,
                devServerUrl: "http://127.0.0.1:5733",
              }),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("passes IDE JWT configuration without forwarding legacy API keys", () =>
    withProcessEnv(
      {
        [COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV]: "https://api.example.com/v1",
        [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
        MYIDE_API_KEY: "legacy-real-key",
        SystemDrive: "C:",
      },
      withHarness(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;

          const config = yield* configuration.resolve;
          assert.equal(
            config.env[COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV],
            "https://api.example.com/v1",
          );
          assert.equal(config.env[COMMERCIAL_ENGINE_IDE_JWT_ENV], "jwt-token");
          assert.equal(config.env.SystemDrive, "C:");
          assert.equal(config.env.MYIDE_API_KEY, undefined);

          const engineConfigPath = environment.path.join(environment.engineHomePath, "config.toml");
          const engineConfig = yield* fileSystem.readFileString(engineConfigPath);
          assert.match(engineConfig, /base_url = "https:\/\/api\.example\.com\/v1"/);
          assert.match(engineConfig, /wire_api = "responses"/);
          assert.match(engineConfig, new RegExp(`env_key = "${COMMERCIAL_ENGINE_IDE_JWT_ENV}"`));
          assert.match(engineConfig, /plugins = true/);
          assert.match(engineConfig, /apps = true/);
          assert.equal(engineConfig.includes("legacy-real-key"), false);
          assert.equal(engineConfig.includes("jwt-token"), false);
        }),
      ),
    ),
  );

  it.effect("prefers encrypted desktop commercial auth over process environment tokens", () =>
    withProcessEnv(
      {
        [COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV]: "https://env.example.com/v1",
        [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "env-jwt",
      },
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-desktop-backend-config-test-",
        });

        yield* Effect.gen(function* () {
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;

          const config = yield* configuration.resolve;
          assert.equal(
            config.env[COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV],
            "https://stored.example.com/v1",
          );
          assert.equal(config.env[COMMERCIAL_ENGINE_IDE_JWT_ENV], "stored-jwt");

          const engineConfigPath = environment.path.join(environment.engineHomePath, "config.toml");
          const engineConfig = yield* fileSystem.readFileString(engineConfigPath);
          assert.match(engineConfig, /base_url = "https:\/\/stored\.example\.com\/v1"/);
          assert.equal(engineConfig.includes("stored-jwt"), false);
          assert.equal(engineConfig.includes("env-jwt"), false);
        }).pipe(
          Effect.provide(
            DesktopBackendConfiguration.layer.pipe(
              Layer.provideMerge(
                DesktopCommercialAuth.layerTest({
                  gatewayBaseUrl: "https://stored.example.com/v1",
                  ideJwt: "stored-jwt",
                }),
              ),
              Layer.provideMerge(DesktopClientSettings.layerTest()),
              Layer.provideMerge(DesktopEngineIntegrity.layerTest),
              Layer.provideMerge(DesktopEngineUpdater.layerTest()),
              Layer.provideMerge(DesktopWindowsSandbox.layerTest()),
              Layer.provideMerge(serverExposureLayer),
              Layer.provideMerge(browserAutomationHostLayer),
              Layer.provideMerge(browserExternalAutomationHostLayer),
              Layer.provideMerge(computerAutomationHostLayer),
              Layer.provideMerge(makeEnvironmentLayer(baseDir)),
            ),
          ),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );
});
