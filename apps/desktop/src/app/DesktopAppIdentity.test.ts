import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const slash = (value: string) => value.replace(/\\/g, "/").replace(/^[A-Z]:/i, "");

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/Bahew.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/Bahew.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

type TestEnvironmentInput = Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> & {
  readonly env?: Record<string, string | undefined>;
};

interface ElectronAppCalls {
  readonly setAboutPanelOptions: Array<Electron.AboutPanelOptionsOptions>;
  readonly setDockIcon: string[];
  readonly setName: string[];
  readonly setAppUserModelId: string[];
  readonly writeShortcutLink: Array<{
    readonly shortcutPath: string;
    readonly operation: "create" | "update" | "replace";
    readonly options: Electron.ShortcutDetails;
  }>;
}

const makeElectronAppLayer = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("Bahew"),
    whenReady: Effect.void,
    quit: Effect.void,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: (name) =>
      Effect.sync(() => {
        calls.setName.push(name);
      }),
    setAboutPanelOptions: (options) =>
      Effect.sync(() => {
        calls.setAboutPanelOptions.push(options);
      }),
    setAppUserModelId: (id) =>
      Effect.sync(() => {
        calls.setAppUserModelId.push(id);
      }),
    setDesktopName: () => Effect.void,
    setDockIcon: (iconPath) =>
      Effect.sync(() => {
        calls.setDockIcon.push(iconPath);
      }),
    appendCommandLineSwitch: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronAppShape);

const makeElectronShellLayer = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronShell.ElectronShell, {
    openExternal: () => Effect.succeed(false),
    openPath: () => Effect.succeed(false),
    revealPath: () => Effect.succeed(false),
    copyText: () => Effect.void,
    writeShortcutLink: (shortcutPath, operation, options) =>
      Effect.sync(() => {
        calls.writeShortcutLink.push({ shortcutPath, operation, options });
        return true;
      }),
  } satisfies ElectronShell.ElectronShellShape);

const makeAssetsLayer = (png: Option.Option<string>) =>
  Layer.succeed(DesktopAssets.DesktopAssets, {
    iconPaths: Effect.succeed({
      ico: Option.none(),
      icns: Option.none(),
      png,
    }),
    resolveResourcePath: () => Effect.succeed(Option.none()),
  } satisfies DesktopAssets.DesktopAssetsShape);

const makeEnvironmentLayer = (overrides: TestEnvironmentInput = {}) => {
  const { env, ...environmentOverrides } = overrides;
  return DesktopEnvironment.layer({
    ...defaultEnvironmentInput,
    ...environmentOverrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({
          ...env,
        }),
      ),
    ),
  );
};

const withIdentity = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopAppIdentity.DesktopAppIdentity
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
  >,
  input: {
    readonly calls?: ElectronAppCalls;
    readonly environment?: TestEnvironmentInput;
    readonly legacyPathExists?: boolean;
    readonly packageJson?: string;
    readonly pngIconPath?: Option.Option<string>;
  } = {},
) => {
  const calls: ElectronAppCalls = input.calls ?? {
    setAboutPanelOptions: [],
    setDockIcon: [],
    setName: [],
    setAppUserModelId: [],
    writeShortcutLink: [],
  };

  return effect.pipe(
    Effect.provide(
      DesktopAppIdentity.layer.pipe(
        Layer.provideMerge(
          FileSystem.layerNoop({
            exists: (path) =>
              Effect.succeed(input.legacyPathExists === true && path.includes("T3 Code (Alpha)")),
            makeDirectory: () => Effect.void,
            readFileString: () =>
              Effect.succeed(input.packageJson ?? '{"t3codeCommitHash":"abcdef1234567890"}'),
          }),
        ),
        Layer.provideMerge(makeAssetsLayer(input.pngIconPath ?? Option.none())),
        Layer.provideMerge(makeElectronShellLayer(calls)),
        Layer.provideMerge(makeElectronAppLayer(calls)),
        Layer.provideMerge(makeEnvironmentLayer(input.environment)),
      ),
    ),
  );
};

describe("DesktopAppIdentity", () => {
  it.effect("keeps using the legacy userData path when it already exists", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(
          slash(userDataPath),
          "/Users/alice/Library/Application Support/T3 Code (Alpha)",
        );
      }),
      { legacyPathExists: true },
    ),
  );

  it.effect("configures app identity from the environment commit override", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
      setAppUserModelId: [],
      writeShortcutLink: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        assert.deepEqual(calls.setName, ["Bahew"]);
        assert.deepEqual(calls.setAppUserModelId, []);
        assert.deepEqual(calls.writeShortcutLink, []);
        assert.equal(calls.setAboutPanelOptions[0]?.applicationName, "Bahew");
        assert.equal(calls.setAboutPanelOptions[0]?.applicationVersion, "1.2.3");
        assert.equal(calls.setAboutPanelOptions[0]?.version, "0123456789ab");
        assert.deepEqual(calls.setDockIcon, ["/icon.png"]);
      }),
      {
        calls,
        environment: {
          env: {
            T3CODE_COMMIT_HASH: "0123456789abcdef",
          },
        },
        pngIconPath: Option.some("/icon.png"),
      },
    );
  });

  it.effect("在 Windows 上写入带 Bahew 身份的通知快捷方式", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
      setAppUserModelId: [],
      writeShortcutLink: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        assert.deepEqual(calls.setAppUserModelId, ["com.bahew.bahew.dev"]);
        assert.equal(calls.writeShortcutLink.length, 1);
        assert.equal(
          slash(calls.writeShortcutLink[0]?.shortcutPath ?? ""),
          "/Users/alice/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Bahew.lnk",
        );
        assert.equal(calls.writeShortcutLink[0]?.operation, "replace");
        assert.equal(calls.writeShortcutLink[0]?.options.target, process.execPath);
        assert.equal(calls.writeShortcutLink[0]?.options.appUserModelId, "com.bahew.bahew.dev");
        assert.equal(calls.writeShortcutLink[0]?.options.description, "Bahew (Dev)");
      }),
      {
        calls,
        environment: {
          platform: "win32",
          env: {
            T3CODE_PORT: "4949",
            VITE_DEV_SERVER_URL: "http://localhost:5173",
          },
        },
      },
    );
  });
});
