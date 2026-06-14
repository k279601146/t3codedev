import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopInstallationIdentity from "./DesktopInstallationIdentity.ts";

function makeLayer(baseDir: string) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "win32",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ BAHEW_HOME: baseDir })),
    ),
  );

  return DesktopInstallationIdentity.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withIdentity = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopInstallationIdentity.DesktopInstallationIdentity>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-installation-identity-test-",
    });
    return yield* effect.pipe(Effect.provide(makeLayer(baseDir)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("DesktopInstallationIdentity", () => {
  it.effect("creates and reuses a persisted installation id", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopInstallationIdentity.DesktopInstallationIdentity;
        const first = yield* identity.installationId;
        const second = yield* identity.installationId;

        assert.match(first, /^[0-9a-f]{32}$/);
        assert.equal(second, first);
      }),
    ),
  );

  it.effect("recovers from a malformed persisted installation id", () =>
    withIdentity(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(environment.installationIdPath, "not-a-valid-id\n");

        const identity = yield* DesktopInstallationIdentity.DesktopInstallationIdentity;
        const recovered = yield* identity.installationId;

        assert.match(recovered, /^[0-9a-f]{32}$/);
        assert.notEqual(recovered, "not-a-valid-id");
      }),
    ),
  );

  it.effect("derives a stable anonymous device id", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopInstallationIdentity.DesktopInstallationIdentity;
        assert.match(yield* identity.deviceId, /^[0-9a-f]{24}$/);
      }),
    ),
  );
});
