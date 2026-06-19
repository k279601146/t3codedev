import assert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopWindowsSandbox from "./DesktopWindowsSandbox.ts";

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "win32",
  processArch: "x64",
  appVersion: "0.0.22",
  appPath: "/Applications/Bahew.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Bahew.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

function resolveMode(
  input: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) {
  const baseLayer = Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env));
  const environmentLayer = DesktopEnvironment.layer({
    ...defaultEnvironmentInput,
    ...input,
  }).pipe(Layer.provide(baseLayer));
  const testLayer = DesktopWindowsSandbox.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(baseLayer, environmentLayer)),
  );

  return Effect.gen(function* () {
    const sandbox = yield* DesktopWindowsSandbox.DesktopWindowsSandbox;
    return yield* sandbox.resolveMode;
  }).pipe(Effect.provide(testLayer));
}

describe("DesktopWindowsSandbox", () => {
  it.effect("Windows 默认使用官方推荐的 elevated sandbox", () =>
    Effect.gen(function* () {
      const mode = yield* resolveMode();

      assert.equal(mode, "elevated");
    }),
  );

  it.effect("显式 MYIDE_WINDOWS_SANDBOX_MODE 可以选择 unelevated", () =>
    Effect.gen(function* () {
      const mode = yield* resolveMode(
        {},
        {
          MYIDE_WINDOWS_SANDBOX_MODE: " unelevated ",
        },
      );

      assert.equal(mode, "unelevated");
    }),
  );

  it.effect("非 Windows 平台不启用 elevated helper", () =>
    Effect.gen(function* () {
      const mode = yield* resolveMode({
        platform: "darwin",
      });

      assert.equal(mode, "unelevated");
    }),
  );
});
