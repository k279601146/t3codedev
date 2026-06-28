import assert from "node:assert/strict";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Test simulates the OAuth loopback callback served by DesktopCommercialAuth.
import * as Http from "node:http";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import {
  COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV,
  COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV,
} from "@t3tools/shared/commercialEngine";
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

function makeLayer(
  baseDir: string,
  options?: { readonly safeStorageAvailable?: boolean; readonly openedUrls?: string[] },
) {
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
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ BAHEW_HOME: baseDir })),
    ),
  );

  return DesktopCommercialAuth.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(makeSafeStorageLayer({ available: options?.safeStorageAvailable ?? true })),
    Layer.provideMerge(
      Layer.succeed(ElectronShell.ElectronShell, {
        openExternal: (url) =>
          Effect.sync(() => {
            options?.openedUrls?.push(String(url));
            const parsed = new URL(String(url));
            const redirectUri = parsed.searchParams.get("redirect_uri");
            if (redirectUri) {
              // @effect-diagnostics-next-line globalTimers:off - Test schedules the synthetic browser callback after the server starts listening.
              setTimeout(() => {
                const callbackUrl = new URL(redirectUri);
                callbackUrl.searchParams.set("code", "pkce-code");
                const request = Http.get(callbackUrl, (response) => {
                  response.resume();
                });
                request.on("error", () => undefined);
              }, 0);
            }
            return true;
          }),
        openPath: () => Effect.succeed(true),
        revealPath: () => Effect.succeed(true),
        copyText: () => Effect.void,
        writeShortcutLink: () => Effect.succeed(false),
      } satisfies ElectronShell.ElectronShellShape),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withCommercialAuth = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopCommercialAuth.DesktopCommercialAuth>,
  options?: { readonly safeStorageAvailable?: boolean; readonly openedUrls?: string[] },
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

const withGatewayBaseUrl = <A, E, R>(gatewayBaseUrl: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env[COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV];
      process.env[COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV] = gatewayBaseUrl;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env[COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV];
        } else {
          process.env[COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV] = previous;
        }
      }),
  );

const withWebAuthBaseUrl = <A, E, R>(webAuthBaseUrl: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env[COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV];
      process.env[COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV] = webAuthBaseUrl;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env[COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV];
        } else {
          process.env[COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV] = previous;
        }
      }),
  );

describe("DesktopCommercialAuth", () => {
  it.effect("exchanges a web token and persists only an encrypted IDE JWT", () =>
    withGatewayBaseUrl(
      "http://localhost:8080/v1",
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

            assert.equal(state.signedIn, true);
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
            assert.match(persisted, /http:\/\/localhost:8080\/v1/);
            assert.match(persisted, /ZW5jOmlkZS1qd3Q=/);
            assert.equal(persisted.includes("ide-jwt"), false);
            assert.equal(persisted.includes("web-jwt"), false);
          }),
        ),
      ),
    ),
  );

  it.effect("signs out without forgetting the gateway URL", () =>
    withGatewayBaseUrl(
      "https://api.example.com/v1",
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
            assert.equal(state.signedIn, false);
            assert.equal(Option.isNone(yield* auth.getCredentials), true);
          }),
        ),
      ),
    ),
  );

  it.effect("uses configured auth endpoints instead of stale persisted URLs", () => {
    const openedUrls: string[] = [];
    return withGatewayBaseUrl(
      "https://gateway.example.com/v1",
      withWebAuthBaseUrl(
        "https://app.example.com",
        withCommercialAuth(
          withFetch(
            (async (url) => {
              assert.equal(url, "https://gateway.example.com/ide/auth/token");
              return new Response(
                JSON.stringify({
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
              const path = environment.path;

              yield* fileSystem.makeDirectory(path.dirname(environment.commercialAuthPath), {
                recursive: true,
              });
              yield* fileSystem.writeFileString(
                environment.commercialAuthPath,
                JSON.stringify({
                  version: 1,
                  gatewayBaseUrl: "https://old-gateway.example.test/v1",
                  webAuthBaseUrl: "https://old-auth.example.test",
                  encryptedIdeJwt: "ZW5jOm9sZC1qd3Q=",
                  authenticatedAt: "2026-05-10T00:00:00.000Z",
                  tokenExpiresAt: null,
                  userLabel: "Old account",
                }),
              );

              const loaded = yield* auth.getState;
              assert.equal(loaded.gatewayBaseUrl, "https://gateway.example.com/v1");
              assert.equal(loaded.webAuthBaseUrl, "https://app.example.com");

              const state = yield* auth.signInWithBrowser({
                gatewayBaseUrl: "https://old-gateway.example.test/v1",
                webAuthBaseUrl: "https://old-auth.example.test",
              });

              assert.equal(state.gatewayBaseUrl, "https://gateway.example.com/v1");
              assert.equal(state.webAuthBaseUrl, "https://app.example.com");
              assert.equal(openedUrls.length, 1);
              const authorizeUrl = new URL(openedUrls[0]!);
              assert.equal(authorizeUrl.origin, "https://app.example.com");
              assert.equal(authorizeUrl.pathname, "/ide/auth/authorize");
            }),
          ),
          { openedUrls },
        ),
      ),
    );
  });

  it.effect("retries transient gateway token exchange failures", () =>
    withGatewayBaseUrl(
      "https://api.example.com/v1",
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

            assert.equal(state.signedIn, true);
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
    ),
  );

  it.effect("opens dev2 for browser authorization and exchanges the code against sub2api", () => {
    const openedUrls: string[] = [];
    return withGatewayBaseUrl(
      "https://gateway.example.com/v1",
      withWebAuthBaseUrl(
        "https://app.example.com",
        withCommercialAuth(
          withFetch(
            (async (url, init) => {
              assert.equal(url, "https://gateway.example.com/ide/auth/token");
              const body = JSON.parse(String(init?.body));
              assert.equal(body.code, "pkce-code");
              assert.equal(body.client_id, "t3code-desktop");
              return new Response(
                JSON.stringify({
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
              const auth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
              const state = yield* auth.signInWithBrowser({
                gatewayBaseUrl: "https://gateway.example.com/v1",
                webAuthBaseUrl: "https://app.example.com",
              });

              assert.equal(state.signedIn, true);
              assert.equal(state.gatewayBaseUrl, "https://gateway.example.com/v1");
              assert.equal(state.webAuthBaseUrl, "https://app.example.com");
              assert.equal(openedUrls.length, 1);
              const authorizeUrl = new URL(openedUrls[0]!);
              assert.equal(authorizeUrl.origin, "https://app.example.com");
              assert.equal(authorizeUrl.pathname, "/ide/auth/authorize");
            }),
          ),
          { openedUrls },
        ),
      ),
    );
  });
});
