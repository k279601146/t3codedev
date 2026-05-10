import { parsePersistedServerObservabilitySettings } from "@t3tools/shared/serverSettings";
import {
  COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV,
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  generateCommercialEngineTomlConfig,
  getCommercialEngineEnvVar,
} from "@t3tools/shared/commercialEngine";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";

import * as DesktopBackendManager from "./DesktopBackendManager.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopCommercialAuth from "../settings/DesktopCommercialAuth.ts";
import * as DesktopServerExposure from "./DesktopServerExposure.ts";

export interface DesktopBackendConfigurationShape {
  readonly resolve: Effect.Effect<DesktopBackendManager.DesktopBackendStartConfig>;
}

export class DesktopBackendConfiguration extends Context.Service<
  DesktopBackendConfiguration,
  DesktopBackendConfigurationShape
>()("t3/desktop/BackendConfiguration") {}

interface BackendObservabilitySettings {
  readonly otlpTracesUrl: Option.Option<string>;
  readonly otlpMetricsUrl: Option.Option<string>;
}

const emptyBackendObservabilitySettings: BackendObservabilitySettings = {
  otlpTracesUrl: Option.none(),
  otlpMetricsUrl: Option.none(),
};

const DESKTOP_BACKEND_ENV_NAMES = [
  "T3CODE_PORT",
  "T3CODE_MODE",
  "T3CODE_NO_BROWSER",
  "T3CODE_HOST",
  "T3CODE_DESKTOP_WS_URL",
  "T3CODE_DESKTOP_LAN_ACCESS",
  "T3CODE_DESKTOP_LAN_HOST",
  "T3CODE_DESKTOP_HTTPS_ENDPOINTS",
  "T3CODE_TAILSCALE_SERVE",
  "T3CODE_TAILSCALE_SERVE_PORT",
] as const;

const COMMERCIAL_ENGINE_DESKTOP_ENV_NAMES = [
  COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV,
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
] as const;

const backendChildEnvPatch = (): Record<string, string | undefined> =>
  Object.fromEntries(DESKTOP_BACKEND_ENV_NAMES.map((name) => [name, undefined]));

const { logWarning: logBackendConfigurationWarning } = DesktopObservability.makeComponentLogger(
  "desktop-backend-configuration",
);

const readPersistedBackendObservabilitySettings: Effect.Effect<
  BackendObservabilitySettings,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const exists = yield* fileSystem
    .exists(environment.serverSettingsPath)
    .pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return emptyBackendObservabilitySettings;
  }

  const raw = yield* fileSystem.readFileString(environment.serverSettingsPath).pipe(Effect.option);
  if (Option.isNone(raw)) {
    yield* logBackendConfigurationWarning(
      "failed to read persisted backend observability settings",
    );
    return emptyBackendObservabilitySettings;
  }

  const parsed = parsePersistedServerObservabilitySettings(raw.value);
  return {
    otlpTracesUrl: Option.fromNullishOr(parsed.otlpTracesUrl),
    otlpMetricsUrl: Option.fromNullishOr(parsed.otlpMetricsUrl),
  };
});

const getOrCreateBootstrapToken = Effect.fn("desktop.backendConfiguration.bootstrapToken")(
  function* (tokenRef: Ref.Ref<Option.Option<string>>) {
    const existing = yield* Ref.get(tokenRef);
    if (Option.isSome(existing)) {
      return existing.value;
    }

    let token = "";
    while (token.length < 48) {
      token += (yield* Random.nextUUIDv4).replace(/-/g, "");
    }
    token = token.slice(0, 48);
    yield* Ref.set(tokenRef, Option.some(token));
    return token;
  },
);

const resolveBackendStartConfig = Effect.fn("desktop.backendConfiguration.resolveStartConfig")(
  function* (input: {
    readonly bootstrapToken: string;
    readonly commercialCredentials: Option.Option<DesktopCommercialAuth.DesktopCommercialAuthCredentials>;
    readonly observabilitySettings: BackendObservabilitySettings;
  }): Effect.fn.Return<
    DesktopBackendManager.DesktopBackendStartConfig,
    never,
    DesktopEnvironment.DesktopEnvironment | DesktopServerExposure.DesktopServerExposure
  > {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    const backendExposure = yield* serverExposure.backendConfig;
    const commercialEnv = Option.match(input.commercialCredentials, {
      onNone: () =>
        Object.fromEntries(
          COMMERCIAL_ENGINE_DESKTOP_ENV_NAMES.map((name) => [
            name,
            getCommercialEngineEnvVar(process.env, name),
          ]),
        ),
      onSome: (credentials) => ({
        [COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV]: credentials.gatewayBaseUrl,
        [COMMERCIAL_ENGINE_IDE_JWT_ENV]: credentials.ideJwt,
      }),
    });

    return {
      executablePath: process.execPath,
      entryPath: environment.backendEntryPath,
      cwd: environment.backendCwd,
      env: {
        ...backendChildEnvPatch(),
        ELECTRON_RUN_AS_NODE: "1",
        // 捆绑引擎路径注入：server 层通过这些环境变量检测捆绑模式
        MYIDE_ENGINE_PATH: environment.engineBinaryPath,
        MYIDE_ENGINE_HOME: environment.engineHomePath,
        ...commercialEnv,
      },
      bootstrap: {
        mode: "desktop",
        noBrowser: true,
        port: backendExposure.port,
        t3Home: environment.baseDir,
        host: backendExposure.bindHost,
        desktopBootstrapToken: input.bootstrapToken,
        tailscaleServeEnabled: backendExposure.tailscaleServeEnabled,
        tailscaleServePort: backendExposure.tailscaleServePort,
        ...Option.match(input.observabilitySettings.otlpTracesUrl, {
          onNone: () => ({}),
          onSome: (otlpTracesUrl) => ({ otlpTracesUrl }),
        }),
        ...Option.match(input.observabilitySettings.otlpMetricsUrl, {
          onNone: () => ({}),
          onSome: (otlpMetricsUrl) => ({ otlpMetricsUrl }),
        }),
      },
      httpBaseUrl: backendExposure.httpBaseUrl,
      captureOutput: true,
    };
  },
);

export const layer = Layer.effect(
  DesktopBackendConfiguration,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    const tokenRef = yield* Ref.make(Option.none<string>());

    return DesktopBackendConfiguration.of({
      resolve: Effect.gen(function* () {
        yield* fileSystem
          .makeDirectory(environment.engineHomePath, { recursive: true })
          .pipe(
            Effect.catch((error) =>
              logBackendConfigurationWarning(
                `Failed to create engine home directory: ${error.message ?? error}`,
              ),
            ),
          );

        // 写入不含密钥的 TOML 配置文件，避免底层 Figment 对 CODEX_ 环境变量的嵌套解析差异。
        const commercialCredentials = yield* commercialAuth.getCredentials.pipe(
          Effect.catch((error) =>
            logBackendConfigurationWarning(
              `Failed to load commercial auth credentials: ${error.message ?? error}`,
            ).pipe(
              Effect.as(Option.none<DesktopCommercialAuth.DesktopCommercialAuthCredentials>()),
            ),
          ),
        );
        const commercialConfigEnv = Option.match(commercialCredentials, {
          onNone: () => process.env,
          onSome: (credentials) => ({
            ...process.env,
            [COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV]: credentials.gatewayBaseUrl,
            [COMMERCIAL_ENGINE_IDE_JWT_ENV]: credentials.ideJwt,
          }),
        });
        const tomlConfig = generateCommercialEngineTomlConfig(commercialConfigEnv);
        const configPath =
          environment.engineHomePath + (process.platform === "win32" ? "\\" : "/") + "config.toml";
        yield* fileSystem
          .writeFileString(configPath, tomlConfig)
          .pipe(
            Effect.catch((error) =>
              logBackendConfigurationWarning(
                `Failed to write engine config.toml: ${error.message ?? error}`,
              ),
            ),
          );

        const bootstrapToken = yield* getOrCreateBootstrapToken(tokenRef);
        const observabilitySettings = yield* readPersistedBackendObservabilitySettings.pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
        );
        return yield* resolveBackendStartConfig({
          bootstrapToken,
          commercialCredentials,
          observabilitySettings,
        }).pipe(
          Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
          Effect.provideService(DesktopServerExposure.DesktopServerExposure, serverExposure),
        );
      }).pipe(Effect.withSpan("desktop.backendConfiguration.resolve")),
    });
  }),
);
