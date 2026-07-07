import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopInstallationIdentity from "../telemetry/DesktopInstallationIdentity.ts";
import * as DesktopEngineUpdater from "./DesktopEngineUpdater.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const NEW_ENGINE_BINARY_SHA256 = "5b8b15328d32318543543b0161fb2805b58f11bf9c2b0e77a9012df913fdc829";

function engineBinaryName() {
  return process.platform === "win32" ? "ai-engine.exe" : "ai-engine";
}

function makeLayer(baseDir: string, env: Record<string, string | undefined> = {}) {
  const configLayer = DesktopConfig.layerTest({ BAHEW_HOME: baseDir, ...env });
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
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, configLayer)));

  return DesktopEngineUpdater.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(configLayer),
    Layer.provideMerge(
      DesktopInstallationIdentity.layerTest({
        installationId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        deviceId: "engine-device",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withUpdater = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopEnvironment.DesktopEnvironment
    | DesktopEngineUpdater.DesktopEngineUpdater
    | FileSystem.FileSystem
  >,
  env?: Record<string, string | undefined>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-engine-updater-test-",
    });
    return yield* effect.pipe(Effect.provide(makeLayer(baseDir, env)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const withFetch = <A, E, R>(fetchImpl: typeof fetch, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.fetch;
      globalThis.fetch = fetchImpl;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        globalThis.fetch = previous;
      }),
  );

describe("DesktopEngineUpdater", () => {
  it.effect("uses a downloaded engine version when the version pointer exists", () =>
    withUpdater(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const updater = yield* DesktopEngineUpdater.DesktopEngineUpdater;
        const versionDir = environment.path.join(environment.engineVersionsPath, "2.0.0");
        const enginePath = environment.path.join(versionDir, engineBinaryName());

        yield* fileSystem.makeDirectory(versionDir, { recursive: true });
        yield* fileSystem.writeFile(enginePath, textEncoder.encode("downloaded-engine"));
        yield* fileSystem.writeFileString(
          environment.path.join(environment.engineVersionsPath, "current_version"),
          "2.0.0\n",
        );

        assert.equal(yield* updater.getActiveEnginePath, enginePath);
        assert.equal(yield* updater.getCurrentVersion, "2.0.0");
      }),
    ),
  );

  it.effect("downloads and activates an engine from the configured manifest", () => {
    const manifestUrl = "https://updates.example.test/engine-manifest.json";
    const binaryUrl = "https://updates.example.test/ai-engine";
    const binaryBytes = textEncoder.encode("new-engine-binary");
    const binaryName = engineBinaryName();
    const key = `${process.platform}-${process.arch}`;

    return withUpdater(
      withFetch(
        (async (url) => {
          const rawUrl = String(url);
          if (rawUrl === manifestUrl) {
            return new Response(
              `{"version":"2.1.0","minAppVersion":"1.0.0","binaries":{"${key}":{"url":"${binaryUrl}","sha256":"${NEW_ENGINE_BINARY_SHA256}","size":${binaryBytes.byteLength}}}}`,
              { status: 200 },
            );
          }

          if (rawUrl === binaryUrl) {
            return new Response(binaryBytes, { status: 200 });
          }

          return new Response("not found", { status: 404 });
        }) as typeof fetch,
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          const updater = yield* DesktopEngineUpdater.DesktopEngineUpdater;

          yield* updater.checkAndUpdate;

          const activeEnginePath = yield* updater.getActiveEnginePath;
          assert.equal(
            activeEnginePath,
            environment.path.join(environment.engineVersionsPath, "2.1.0", binaryName),
          );
          assert.equal(yield* updater.getCurrentVersion, "2.1.0");
          assert.equal(
            textDecoder.decode(yield* fileSystem.readFile(activeEnginePath)),
            "new-engine-binary",
          );
          assert.include(
            yield* fileSystem.readFileString(
              environment.path.join(
                environment.engineVersionsPath,
                "2.1.0",
                "engine-manifest.json",
              ),
            ),
            NEW_ENGINE_BINARY_SHA256,
          );
        }),
      ),
      { MYIDE_ENGINE_MANIFEST_URL: manifestUrl },
    );
  });

  it.effect("accepts the dev2 IDE version envelope as an engine manifest", () => {
    const manifestUrl = "https://updates.example.test/ide/api/version/engine";
    const binaryUrl = "https://updates.example.test/ai-engine";
    const binaryBytes = textEncoder.encode("new-engine-binary");
    const binaryName = engineBinaryName();

    return withUpdater(
      withFetch(
        (async (url) => {
          const rawUrl = String(url);
          if (rawUrl === manifestUrl) {
            return new Response(
              JSON.stringify({
                code: 0,
                data: {
                  version: "2.2.0",
                  min_app_version: "1.0.0",
                  protocolVersion: "app-server-v1",
                  download: {
                    url: binaryUrl,
                    sha256: NEW_ENGINE_BINARY_SHA256,
                    size: binaryBytes.byteLength,
                  },
                },
              }),
              { status: 200 },
            );
          }

          if (rawUrl === binaryUrl) {
            return new Response(binaryBytes, { status: 200 });
          }

          return new Response("not found", { status: 404 });
        }) as typeof fetch,
        Effect.gen(function* () {
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          const updater = yield* DesktopEngineUpdater.DesktopEngineUpdater;

          yield* updater.checkAndUpdate;

          assert.equal(
            yield* updater.getActiveEnginePath,
            environment.path.join(environment.engineVersionsPath, "2.2.0", binaryName),
          );
        }),
      ),
      { MYIDE_ENGINE_MANIFEST_URL: manifestUrl },
    );
  });

  it.effect("accepts the dev2 manifest envelope and sends rollout identity headers", () => {
    const manifestUrl = "https://www.bahew.com/api/v1/client-updates/engine";
    const binaryUrl = "https://updates.example.test/ai-engine";
    const binaryBytes = textEncoder.encode("new-engine-binary");
    const binaryName = engineBinaryName();
    const key = `${process.platform}-${process.arch}`;
    const seenHeaders: Headers[] = [];

    return withUpdater(
      withFetch(
        (async (url, init) => {
          const rawUrl = String(url);
          if (rawUrl === manifestUrl) {
            seenHeaders.push(new Headers(init?.headers));
            return new Response(
              JSON.stringify({
                data: {
                  version: "2.3.0",
                  minAppVersion: "1.0.0",
                  protocolVersion: "app-server-v1",
                  binaries: {
                    [key]: {
                      url: binaryUrl,
                      sha256: NEW_ENGINE_BINARY_SHA256,
                      size: binaryBytes.byteLength,
                    },
                  },
                },
              }),
              { status: 200 },
            );
          }

          if (rawUrl === binaryUrl) {
            return new Response(binaryBytes, { status: 200 });
          }

          return new Response("not found", { status: 404 });
        }) as typeof fetch,
        Effect.gen(function* () {
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          const updater = yield* DesktopEngineUpdater.DesktopEngineUpdater;

          yield* updater.checkAndUpdate;

          assert.equal(
            yield* updater.getActiveEnginePath,
            environment.path.join(environment.engineVersionsPath, "2.3.0", binaryName),
          );
          assert.equal(seenHeaders[0]?.get("x-t3code-version"), "1.2.3");
          assert.equal(seenHeaders[0]?.get("x-t3code-engine-version"), "bundled");
          assert.equal(seenHeaders[0]?.get("x-t3code-platform"), process.platform);
          assert.equal(seenHeaders[0]?.get("x-t3code-arch"), process.arch);
          assert.equal(
            seenHeaders[0]?.get("x-t3code-installation-id"),
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          );
          assert.equal(seenHeaders[0]?.get("x-t3code-device-id"), "engine-device");
        }),
      ),
      { MYIDE_ENGINE_MANIFEST_URL: manifestUrl },
    );
  });

  it.effect("rejects engine updates with an incompatible protocol version", () => {
    const manifestUrl = "https://updates.example.test/engine-manifest.json";
    const key = `${process.platform}-${process.arch}`;

    return withUpdater(
      withFetch(
        (async (url) => {
          if (String(url) === manifestUrl) {
            return new Response(
              `{"version":"9.0.0","protocolVersion":"future-protocol","binaries":{"${key}":{"url":"https://updates.example.test/ai-engine","sha256":"${NEW_ENGINE_BINARY_SHA256}"}}}`,
              { status: 200 },
            );
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
        Effect.gen(function* () {
          const updater = yield* DesktopEngineUpdater.DesktopEngineUpdater;
          const error = yield* updater.checkAndUpdate.pipe(Effect.flip);

          assert.include(error.message, "unsupported protocol version");
          assert.equal(yield* updater.getCurrentVersion, "bundled");
        }),
      ),
      { MYIDE_ENGINE_MANIFEST_URL: manifestUrl },
    );
  });

  it.effect("rolls back to the previous downloaded engine version", () =>
    withUpdater(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const updater = yield* DesktopEngineUpdater.DesktopEngineUpdater;
        const binaryName = engineBinaryName();

        for (const version of ["2.0.0", "2.1.0"]) {
          const versionDir = environment.path.join(environment.engineVersionsPath, version);
          yield* fileSystem.makeDirectory(versionDir, { recursive: true });
          yield* fileSystem.writeFile(
            environment.path.join(versionDir, binaryName),
            textEncoder.encode(`engine-${version}`),
          );
        }
        yield* fileSystem.writeFileString(
          environment.path.join(environment.engineVersionsPath, "current_version"),
          "2.1.0\n",
        );

        assert.equal(yield* updater.rollback, true);
        assert.equal(yield* updater.getCurrentVersion, "2.0.0");
        assert.equal(
          yield* updater.getActiveEnginePath,
          environment.path.join(environment.engineVersionsPath, "2.0.0", binaryName),
        );
      }),
    ),
  );
});
