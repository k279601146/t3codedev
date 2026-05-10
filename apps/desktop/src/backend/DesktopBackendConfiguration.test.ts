import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV,
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
} from "@t3tools/shared/commercialEngine";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopEngineIntegrity from "../engine/DesktopEngineIntegrity.ts";
import * as DesktopEngineUpdater from "../engine/DesktopEngineUpdater.ts";
import * as DesktopWindowsSandbox from "../security/DesktopWindowsSandbox.ts";
import * as DesktopCommercialAuth from "../settings/DesktopCommercialAuth.ts";
import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopServerExposure from "./DesktopServerExposure.ts";

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
          T3CODE_HOME: baseDir,
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
          Layer.provideMerge(DesktopEngineIntegrity.layerTest),
          Layer.provideMerge(DesktopEngineUpdater.layerTest()),
          Layer.provideMerge(DesktopWindowsSandbox.layerTest()),
          Layer.provideMerge(serverExposureLayer),
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
        assert.isUndefined(first.env.T3CODE_PORT);
        assert.isUndefined(first.env.T3CODE_MODE);
        assert.isUndefined(first.env.T3CODE_DESKTOP_LAN_HOST);

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

        assert.isUndefined(config.bootstrap.otlpTracesUrl);
        assert.isUndefined(config.bootstrap.otlpMetricsUrl);
      }),
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
            Layer.provideMerge(DesktopEngineIntegrity.layerTest),
            Layer.provideMerge(DesktopEngineUpdater.layerTest()),
            Layer.provideMerge(DesktopWindowsSandbox.layerTest()),
            Layer.provideMerge(serverExposureLayer),
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
          assert.isUndefined(config.env.MYIDE_API_KEY);

          const engineConfigPath = environment.path.join(environment.engineHomePath, "config.toml");
          const engineConfig = yield* fileSystem.readFileString(engineConfigPath);
          assert.match(engineConfig, /base_url = "https:\/\/api\.example\.com\/v1"/);
          assert.match(engineConfig, /wire_api = "chat"/);
          assert.match(engineConfig, new RegExp(`env_key = "${COMMERCIAL_ENGINE_IDE_JWT_ENV}"`));
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
              Layer.provideMerge(DesktopEngineIntegrity.layerTest),
              Layer.provideMerge(DesktopEngineUpdater.layerTest()),
              Layer.provideMerge(DesktopWindowsSandbox.layerTest()),
              Layer.provideMerge(serverExposureLayer),
              Layer.provideMerge(makeEnvironmentLayer(baseDir)),
            ),
          ),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );
});
