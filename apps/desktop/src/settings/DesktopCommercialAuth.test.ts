import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopCommercialAuth from "./DesktopCommercialAuth.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function makeSafeStorageLayer(input: { readonly available: boolean }) {
  return Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
    isEncryptionAvailable: Effect.succeed(input.available),
    encryptString: (value) => Effect.succeed(textEncoder.encode(`enc:${value}`)),
    decryptString: (value) => {
      const decoded = textDecoder.decode(value);
      if (!decoded.startsWith("enc:")) {
        return Effect.fail(
          new ElectronSafeStorage.ElectronSafeStorageDecryptError({
            cause: new Error("invalid secret"),
          }),
        );
      }
      return Effect.succeed(decoded.slice("enc:".length));
    },
  } satisfies ElectronSafeStorage.ElectronSafeStorageShape);
}

function makeLayer(baseDir: string, options?: { readonly safeStorageAvailable?: boolean }) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
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

  return DesktopCommercialAuth.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(makeSafeStorageLayer({ available: options?.safeStorageAvailable ?? true })),
    Layer.provideMerge(
      Layer.succeed(ElectronShell.ElectronShell, {
        openExternal: () => Effect.succeed(true),
        copyText: () => Effect.void,
      } satisfies ElectronShell.ElectronShellShape),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withCommercialAuth = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopCommercialAuth.DesktopCommercialAuth>,
  options?: { readonly safeStorageAvailable?: boolean },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-commercial-auth-test-",
    });
    return yield* effect.pipe(Effect.provide(makeLayer(baseDir, options)));
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

describe("DesktopCommercialAuth", () => {
  it.effect("exchanges a web token and persists only an encrypted IDE JWT", () =>
    withCommercialAuth(
      withFetch(
        (async (url, init) => {
          assert.equal(url, "http://localhost:8080/ide/auth/token");
          const headers = init?.headers as Record<string, string> | undefined;
          assert.equal(headers?.Authorization, "Bearer web-jwt");
          return new Response(
            JSON.stringify({
              code: 0,
              message: "success",
              data: {
                access_token: "ide-jwt",
                expires_in: 3600,
                user: { email: "dev@example.com" },
              },
            }),
            { status: 200 },
          );
        }) as typeof fetch,
        Effect.gen(function* () {
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          const fileSystem = yield* FileSystem.FileSystem;
          const auth = yield* DesktopCommercialAuth.DesktopCommercialAuth;

          const state = yield* auth.signIn({
            gatewayBaseUrl: "http://localhost:8080/v1",
            webAccessToken: "web-jwt",
          });

          assert.isTrue(state.signedIn);
          assert.equal(state.gatewayBaseUrl, "http://localhost:8080/v1");
          assert.equal(state.userLabel, "dev@example.com");
          assert.deepEqual(
            yield* auth.getCredentials,
            Option.some({
              gatewayBaseUrl: "http://localhost:8080/v1",
              ideJwt: "ide-jwt",
            }),
          );

          const persisted = yield* fileSystem.readFileString(environment.commercialAuthPath);
          assert.include(persisted, "http://localhost:8080/v1");
          assert.include(persisted, "ZW5jOmlkZS1qd3Q=");
          assert.equal(persisted.includes("ide-jwt"), false);
          assert.equal(persisted.includes("web-jwt"), false);
        }),
      ),
    ),
  );

  it.effect("signs out without forgetting the gateway URL", () =>
    withCommercialAuth(
      withFetch(
        (async () =>
          new Response(
            JSON.stringify({
              data: { access_token: "ide-jwt", expires_in: 3600 },
            }),
            { status: 200 },
          )) as typeof fetch,
        Effect.gen(function* () {
          const auth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
          yield* auth.signIn({
            gatewayBaseUrl: "https://api.example.com/v1",
            webAccessToken: "web-jwt",
          });

          const state = yield* auth.signOut;
          assert.equal(state.gatewayBaseUrl, "https://api.example.com/v1");
          assert.isFalse(state.signedIn);
          assert.isTrue(Option.isNone(yield* auth.getCredentials));
        }),
      ),
    ),
  );

  it.effect("retries transient gateway token exchange failures", () =>
    withCommercialAuth(
      withFetch(
        (() => {
          let attempts = 0;
          return (async () => {
            attempts += 1;
            if (attempts === 1) {
              return new Response("busy", { status: 503 });
            }
            return new Response(
              JSON.stringify({
                data: { access_token: "ide-jwt", expires_in: 3600 },
              }),
              { status: 200 },
            );
          }) as typeof fetch;
        })(),
        Effect.gen(function* () {
          const auth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
          const state = yield* auth.signIn({
            gatewayBaseUrl: "https://api.example.com/v1",
            webAccessToken: "web-jwt",
          });

          assert.isTrue(state.signedIn);
          assert.deepEqual(
            yield* auth.getCredentials,
            Option.some({
              gatewayBaseUrl: "https://api.example.com/v1",
              ideJwt: "ide-jwt",
            }),
          );
        }),
      ),
    ),
  );
});
