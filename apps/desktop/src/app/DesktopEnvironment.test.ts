import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/Bahew.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Bahew.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))));

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  Effect.gen(function* () {
    return yield* DesktopEnvironment.DesktopEnvironment;
  }).pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

const slash = (value: string) => value.replace(/\\/g, "/").replace(/^[A-Z]:/i, "");

describe("DesktopEnvironment", () => {
  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          BAHEW_HOME: " /tmp/t3 ",
          T3CODE_COMMIT_HASH: " 0123456789abcdef ",
          T3CODE_PORT: "4949",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          T3CODE_DEV_REMOTE_T3_SERVER_ENTRY_PATH: " /remote/server.mjs ",
          T3CODE_OTLP_TRACES_URL: " http://127.0.0.1:4318/v1/traces ",
          T3CODE_OTLP_EXPORT_INTERVAL_MS: "2500",
        },
      );

      assert.equal(environment.isDevelopment, true);
      assert.equal(slash(environment.appDataDirectory), "/Users/alice/Library/Application Support");
      assert.equal(slash(environment.baseDir), "/tmp/t3");
      assert.equal(slash(environment.stateDir), "/tmp/t3/userdata");
      assert.equal(
        slash(environment.desktopSettingsPath),
        "/tmp/t3/userdata/desktop-settings.json",
      );
      assert.equal(slash(environment.clientSettingsPath), "/tmp/t3/userdata/client-settings.json");
      assert.equal(
        slash(environment.savedEnvironmentRegistryPath),
        "/tmp/t3/userdata/saved-environments.json",
      );
      assert.equal(slash(environment.serverSettingsPath), "/tmp/t3/userdata/settings.json");
      assert.equal(slash(environment.logDir), "/tmp/t3/userdata/logs");
      assert.equal(slash(environment.rootDir), "/repo");
      assert.equal(slash(environment.appRoot), "/repo");
      assert.equal(slash(environment.backendEntryPath), "/repo/apps/server/dist/bin.mjs");
      assert.equal(slash(environment.backendCwd), "/repo");
      assert.equal(slash(environment.bundledExtensionsPath), "/repo/extensions");
      assert.equal(environment.appUserModelId, "com.bahew.bahew.dev");
      assert.equal(environment.linuxWmClass, "bahew-dev");
      assert.deepEqual(
        Option.map(environment.devServerUrl, (url) => url.href),
        Option.some("http://localhost:5173/"),
      );
      assert.deepEqual(environment.devRemoteT3ServerEntryPath, Option.some("/remote/server.mjs"));
      assert.deepEqual(environment.configuredBackendPort, Option.some(4949));
      assert.deepEqual(environment.commitHashOverride, Option.some("0123456789abcdef"));
      assert.deepEqual(environment.otlpTracesUrl, Option.some("http://127.0.0.1:4318/v1/traces"));
      assert.equal(environment.otlpExportIntervalMs, 2500);
    }),
  );

  it.effect("derives production state paths under userdata", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          BAHEW_HOME: "/tmp/t3",
        },
      );

      assert.equal(environment.isDevelopment, false);
      assert.equal(slash(environment.stateDir), "/tmp/t3/userdata");
      assert.equal(slash(environment.logDir), "/tmp/t3/userdata/logs");
      assert.equal(slash(environment.serverSettingsPath), "/tmp/t3/userdata/settings.json");
    }),
  );

  it.effect("resolves packaged bundled extensions from Electron resources", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        isPackaged: true,
        resourcesPath: "/Applications/Bahew.app/Contents/Resources",
      });

      assert.equal(
        slash(environment.bundledExtensionsPath),
        "/Applications/Bahew.app/Contents/Resources/extensions",
      );
    }),
  );

  it.effect("uses repository resources when a development launcher looks packaged", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {
          appPath: "/repo/apps/desktop",
          isPackaged: true,
          resourcesPath: "/repo/apps/desktop/.electron-runtime/win32/electron/resources",
        },
        {
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      );

      assert.equal(environment.isPackaged, true);
      assert.equal(environment.isDevelopment, true);
      assert.equal(slash(environment.appRoot), "/repo");
      assert.equal(slash(environment.backendEntryPath), "/repo/apps/server/dist/bin.mjs");
      assert.equal(slash(environment.backendCwd), "/repo");
      assert.equal(
        slash(environment.engineBinaryPath),
        `/repo/apps/desktop/bin/ai-engine${process.platform === "win32" ? ".exe" : ""}`,
      );
      assert.equal(slash(environment.bundledExtensionsPath), "/repo/extensions");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        Option.map(environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }), slash),
        Option.some(slash("/Users/alice/project")),
      );
    }),
  );
});
