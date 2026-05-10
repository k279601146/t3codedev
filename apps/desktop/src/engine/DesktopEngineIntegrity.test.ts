import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopEngineIntegrity from "./DesktopEngineIntegrity.ts";

const textEncoder = new TextEncoder();
const ENGINE_BINARY_SHA256 = "4337d96a20d1bde86fef8cf57a4174e342e7604daa2a011d563a4f6ecad89b81";

function makeLayer(baseDir: string) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: process.platform,
    processArch: process.arch,
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );

  return DesktopEngineIntegrity.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withIntegrity = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopEnvironment.DesktopEnvironment
    | DesktopEngineIntegrity.DesktopEngineIntegrity
    | FileSystem.FileSystem
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-engine-integrity-test-",
    });
    return yield* effect.pipe(Effect.provide(makeLayer(baseDir)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("DesktopEngineIntegrity", () => {
  it.effect("verifies an engine binary against its same-directory manifest", () =>
    withIntegrity(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const integrity = yield* DesktopEngineIntegrity.DesktopEngineIntegrity;
        const baseDir = environment.path.join(environment.stateDir, "verified");
        const enginePath = environment.path.join(baseDir, "ai-engine");
        const bytes = textEncoder.encode("engine-binary");

        yield* fileSystem.makeDirectory(baseDir, { recursive: true });
        yield* fileSystem.writeFile(enginePath, bytes);
        yield* fileSystem.writeFileString(
          environment.path.join(baseDir, "engine-manifest.json"),
          `{"version":"1.0.0","binaries":{"ai-engine":"${ENGINE_BINARY_SHA256}"}}`,
        );

        yield* integrity.ensure(enginePath);
      }),
    ),
  );

  it.effect("fails when the manifest hash does not match the engine binary", () =>
    withIntegrity(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const integrity = yield* DesktopEngineIntegrity.DesktopEngineIntegrity;
        const baseDir = environment.path.join(environment.stateDir, "tampered");
        const enginePath = environment.path.join(baseDir, "ai-engine");

        yield* fileSystem.makeDirectory(baseDir, { recursive: true });
        yield* fileSystem.writeFile(enginePath, textEncoder.encode("engine-binary"));
        yield* fileSystem.writeFileString(
          environment.path.join(baseDir, "engine-manifest.json"),
          `{"version":"1.0.0","binaries":{"ai-engine":"00"}}`,
        );

        const error = yield* integrity.ensure(enginePath).pipe(Effect.flip);

        assert.include(error.message, "sha256 mismatch");
      }),
    ),
  );
});
