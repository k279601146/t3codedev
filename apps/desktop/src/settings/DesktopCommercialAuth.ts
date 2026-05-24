import {
  type DesktopCommercialAuthBrowserSignInInput,
  type DesktopCommercialAuthBrowserSignInCancelInput,
  type DesktopCommercialAuthSignInInput,
  type DesktopCommercialAuthState,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import {
  DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
  resolveCommercialEngineGatewayBaseUrl,
} from "@t3tools/shared/commercialEngine";
import { resilientFetch } from "@t3tools/shared/Net";
import * as Crypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off - OAuth PKCE desktop login needs a temporary loopback callback listener.
import * as Http from "node:http";
import type * as Net from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";

export interface DesktopCommercialAuthCredentials {
  readonly gatewayBaseUrl: string;
  readonly ideJwt: string;
}

interface CommercialAuthDocument {
  readonly version: number;
  readonly gatewayBaseUrl: string;
  readonly encryptedIdeJwt?: string;
  readonly authenticatedAt?: string | null;
  readonly tokenExpiresAt?: string | null;
  readonly userLabel?: string | null;
}

interface CommercialAuthStorageDocument {
  readonly version?: number;
  readonly gatewayBaseUrl?: string;
  readonly encryptedIdeJwt?: string;
  readonly authenticatedAt?: string | null;
  readonly tokenExpiresAt?: string | null;
  readonly userLabel?: string | null;
}

function resolveConfiguredGatewayBaseUrl(): string {
  return normalizeGatewayBaseUrl(resolveCommercialEngineGatewayBaseUrl(process.env));
}

const CommercialAuthDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  gatewayBaseUrl: Schema.optionalKey(Schema.String),
  encryptedIdeJwt: Schema.optionalKey(Schema.String),
  authenticatedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tokenExpiresAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  userLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const CommercialAuthDocumentJson = fromLenientJson(CommercialAuthDocumentSchema);
const decodeCommercialAuthDocumentJson = Schema.decodeEffect(CommercialAuthDocumentJson);
const encodeCommercialAuthDocumentJson = Schema.encodeEffect(CommercialAuthDocumentJson);

export class DesktopCommercialAuthWriteError extends Data.TaggedError(
  "DesktopCommercialAuthWriteError",
)<{
  readonly cause: PlatformError.PlatformError | Schema.SchemaError;
}> {
  override get message() {
    return `Failed to write desktop commercial auth: ${this.cause.message}`;
  }
}

export class DesktopCommercialAuthSecretDecodeError extends Data.TaggedError(
  "DesktopCommercialAuthSecretDecodeError",
)<{
  readonly cause: Encoding.EncodingError;
}> {
  override get message() {
    return "Failed to decode desktop commercial auth secret.";
  }
}

export class DesktopCommercialAuthExchangeError extends Data.TaggedError(
  "DesktopCommercialAuthExchangeError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error
      ? this.cause.message
      : "Failed to exchange web token for an IDE token.";
  }
}

export class DesktopCommercialAuthPKCEError extends Data.TaggedError(
  "DesktopCommercialAuthPKCEError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : "Failed to complete browser sign-in.";
  }
}

export type DesktopCommercialAuthGetCredentialsError =
  | DesktopCommercialAuthSecretDecodeError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError;

export type DesktopCommercialAuthSignInError =
  | DesktopCommercialAuthExchangeError
  | DesktopCommercialAuthPKCEError
  | DesktopCommercialAuthWriteError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageEncryptError;

export interface DesktopCommercialAuthShape {
  readonly getState: Effect.Effect<DesktopCommercialAuthState>;
  readonly getCredentials: Effect.Effect<
    Option.Option<DesktopCommercialAuthCredentials>,
    DesktopCommercialAuthGetCredentialsError
  >;
  readonly signIn: (
    input: DesktopCommercialAuthSignInInput,
  ) => Effect.Effect<DesktopCommercialAuthState, DesktopCommercialAuthSignInError>;
  readonly signInWithBrowser: (
    input: DesktopCommercialAuthBrowserSignInInput,
  ) => Effect.Effect<DesktopCommercialAuthState, DesktopCommercialAuthSignInError>;
  readonly cancelBrowserSignIn: (
    input: DesktopCommercialAuthBrowserSignInCancelInput,
  ) => Effect.Effect<void>;
  readonly signOut: Effect.Effect<DesktopCommercialAuthState, DesktopCommercialAuthWriteError>;
}

export class DesktopCommercialAuth extends Context.Service<
  DesktopCommercialAuth,
  DesktopCommercialAuthShape
>()("t3/desktop/CommercialAuth") {}

function normalizeGatewayBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Gateway URL is required.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (cause) {
    throw new Error("Gateway URL must be an absolute HTTP(S) URL.", { cause });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Gateway URL must use HTTP or HTTPS.");
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function resolveAuthTokenEndpoint(gatewayBaseUrl: string): string {
  const url = new URL(gatewayBaseUrl);
  return new URL("/ide/auth/token", url.origin).toString();
}

function normalizeDocument(document: CommercialAuthStorageDocument): CommercialAuthDocument {
  const configuredGatewayBaseUrl = resolveConfiguredGatewayBaseUrl();
  const baseDocument = {
    version: document.version ?? 1,
    gatewayBaseUrl: document.gatewayBaseUrl?.trim() || configuredGatewayBaseUrl,
    authenticatedAt: document.authenticatedAt ?? null,
    tokenExpiresAt: document.tokenExpiresAt ?? null,
    userLabel: document.userLabel ?? null,
  };
  return document.encryptedIdeJwt
    ? {
        ...baseDocument,
        encryptedIdeJwt: document.encryptedIdeJwt,
      }
    : baseDocument;
}

function readDocument(
  fileSystem: FileSystem.FileSystem,
  authPath: string,
): Effect.Effect<CommercialAuthDocument> {
  return fileSystem.readFileString(authPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.succeed({
            version: 1,
            gatewayBaseUrl: resolveConfiguredGatewayBaseUrl(),
            authenticatedAt: null,
            tokenExpiresAt: null,
            userLabel: null,
          }),
        onSome: (raw) =>
          decodeCommercialAuthDocumentJson(raw).pipe(
            Effect.map(normalizeDocument),
            Effect.catch(() =>
              Effect.succeed({
                version: 1,
                gatewayBaseUrl: resolveConfiguredGatewayBaseUrl(),
                authenticatedAt: null,
                tokenExpiresAt: null,
                userLabel: null,
              }),
            ),
          ),
      }),
    ),
  );
}

const writeDocument = Effect.fn("desktop.commercialAuth.writeDocument")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly authPath: string;
  readonly document: CommercialAuthDocument;
}): Effect.fn.Return<void, PlatformError.PlatformError | Schema.SchemaError> {
  const directory = input.path.dirname(input.authPath);
  const suffix = (yield* Random.nextUUIDv4).replace(/-/g, "");
  const tempPath = `${input.authPath}.${process.pid}.${suffix}.tmp`;
  const encoded = yield* encodeCommercialAuthDocumentJson(input.document);
  yield* input.fileSystem.makeDirectory(directory, { recursive: true });
  yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`);
  yield* input.fileSystem.rename(tempPath, input.authPath);
});

function decodeSecretBytes(
  encoded: string,
): Effect.Effect<Uint8Array, DesktopCommercialAuthSecretDecodeError> {
  return Effect.fromResult(Encoding.decodeBase64(encoded)).pipe(
    Effect.mapError((cause) => new DesktopCommercialAuthSecretDecodeError({ cause })),
  );
}

interface IDETokenExchangeResult {
  readonly accessToken: string;
  readonly expiresIn: number | null;
  readonly userLabel: string | null;
}

interface PKCEAuthorizationCode {
  readonly code: string;
  readonly redirectUri: string;
}

const IDE_CLIENT_ID = "t3code-desktop";
const PKCE_CALLBACK_HOST = "127.0.0.1";
const PKCE_CALLBACK_PATH = "/callback";
const PKCE_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const activePKCESignIns = new Map<string, () => void>();

function getObjectProperty(record: unknown, key: string): unknown {
  return typeof record === "object" && record !== null
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

function readString(record: unknown, key: string): string | null {
  const value = getObjectProperty(record, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveUserLabel(user: unknown): string | null {
  return (
    readString(user, "display_name") ??
    readString(user, "displayName") ??
    readString(user, "username") ??
    readString(user, "email")
  );
}

function parseExchangePayload(payload: unknown): IDETokenExchangeResult {
  const data = getObjectProperty(payload, "data") ?? payload;
  const accessToken = readString(data, "access_token");
  if (!accessToken) {
    throw new Error("Gateway response did not include an IDE access token.");
  }

  const expiresInRaw = getObjectProperty(data, "expires_in");
  const expiresIn =
    typeof expiresInRaw === "number" && Number.isFinite(expiresInRaw) ? expiresInRaw : null;

  return {
    accessToken,
    expiresIn,
    userLabel: resolveUserLabel(getObjectProperty(data, "user")),
  };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function makePKCEVerifier(): string {
  return base64Url(Crypto.randomBytes(32));
}

function makePKCEChallenge(verifier: string): string {
  return Crypto.createHash("sha256").update(verifier).digest("base64url");
}

function makeDeviceId(environment: DesktopEnvironment.DesktopEnvironmentShape): string {
  return Crypto.createHash("sha256")
    .update(`${environment.baseDir}:${process.platform}:${process.arch}`)
    .digest("hex")
    .slice(0, 24);
}

function resolveAuthAuthorizeEndpoint(gatewayBaseUrl: string): string {
  const url = new URL(gatewayBaseUrl);
  return new URL("/ide/auth/authorize", url.origin).toString();
}

function buildAuthorizeUrl(input: {
  readonly gatewayBaseUrl: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
}): string {
  const url = new URL(resolveAuthAuthorizeEndpoint(input.gatewayBaseUrl));
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("client_id", IDE_CLIENT_ID);
  return url.toString();
}

function signInSuccessHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Signed in to T3 Code</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: start center;
        background: #fff;
        color: #050505;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        margin-top: 17vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .icon {
        width: 62px;
        height: 62px;
        display: grid;
        place-items: center;
        border: 1px solid #e8e8e8;
        border-radius: 14px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
      }
      .mark {
        width: 30px;
        height: 30px;
        border: 3px solid currentColor;
        border-radius: 999px;
        position: relative;
      }
      .mark::before {
        content: "";
        position: absolute;
        left: 7px;
        top: 9px;
        width: 5px;
        height: 5px;
        border-left: 2px solid currentColor;
        border-bottom: 2px solid currentColor;
      }
      .mark::after {
        content: "";
        position: absolute;
        right: 7px;
        top: 14px;
        width: 8px;
        height: 2px;
        background: currentColor;
        border-radius: 999px;
      }
      h1 {
        margin: 24px 0 0;
        font-size: 32px;
        line-height: 1.2;
        font-weight: 500;
        letter-spacing: 0;
      }
      p {
        margin: 18px 0 0;
        color: #555;
        font-size: 15px;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #050505; color: #fafafa; }
        .icon { border-color: #242424; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35); }
        p { color: #b8b8b8; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="icon" aria-hidden="true"><div class="mark"></div></div>
      <h1>Signed in to T3 Code</h1>
      <p>You may now close this page</p>
    </main>
  </body>
</html>`;
}

function serverAddressPort(address: string | Net.AddressInfo | null): number {
  if (typeof address === "object" && address !== null) {
    return address.port;
  }
  throw new Error("Could not reserve a local OAuth callback port.");
}

function waitForPKCECallback(
  openAuthorizeUrl: (authorizeUrl: string) => Promise<boolean>,
  input: {
    readonly gatewayBaseUrl: string;
    readonly codeChallenge: string;
    readonly requestId?: string;
  },
): Promise<PKCEAuthorizationCode> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = Http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://${PKCE_CALLBACK_HOST}`);
      if (requestUrl.pathname !== PKCE_CALLBACK_PATH) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      if (error || !code) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Sign-in failed</title><p>Sign-in failed.</p>");
        finish(
          null,
          new Error(
            error ? `Gateway authorization failed: ${error}` : "Missing authorization code.",
          ),
        );
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(signInSuccessHtml());
      finish({ code, redirectUri }, null);
    });

    // @effect-diagnostics-next-line globalTimers:off - This timeout is tied to a Node HTTP server created inside the same Promise.
    const timeout = setTimeout(() => {
      finish(null, new Error("Timed out waiting for browser sign-in."));
    }, PKCE_LOGIN_TIMEOUT_MS);

    let redirectUri = "";
    const closeServer = () => {
      clearTimeout(timeout);
      if (input.requestId) {
        activePKCESignIns.delete(input.requestId);
      }
      if (server.listening) {
        server.close();
      }
    };

    const finish = (result: PKCEAuthorizationCode | null, error: Error | null) => {
      if (settled) return;
      settled = true;
      closeServer();
      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error("Browser sign-in did not return an authorization code."));
      }
    };

    server.once("error", (error) => {
      finish(null, error);
    });

    if (input.requestId) {
      activePKCESignIns.set(input.requestId, () => {
        finish(null, new Error("Browser sign-in cancelled."));
      });
    }

    server.listen(0, PKCE_CALLBACK_HOST, () => {
      redirectUri = `http://${PKCE_CALLBACK_HOST}:${serverAddressPort(server.address())}${PKCE_CALLBACK_PATH}`;
      const authorizeUrl = buildAuthorizeUrl({
        gatewayBaseUrl: input.gatewayBaseUrl,
        codeChallenge: input.codeChallenge,
        redirectUri,
      });
      void openAuthorizeUrl(authorizeUrl).then(
        (opened) => {
          if (!opened) {
            finish(null, new Error("Could not open the browser for gateway sign-in."));
          }
        },
        (error: unknown) => {
          finish(null, error instanceof Error ? error : new Error("Could not open the browser."));
        },
      );
    });
  });
}

function exchangeWebTokenForIDEToken(
  input: DesktopCommercialAuthSignInInput,
): Effect.Effect<IDETokenExchangeResult, DesktopCommercialAuthExchangeError> {
  return Effect.tryPromise({
    try: async () => {
      const gatewayBaseUrl = resolveConfiguredGatewayBaseUrl();
      const webAccessToken = input.webAccessToken.trim();
      if (webAccessToken.length === 0) {
        throw new Error("Web access token is required.");
      }

      const response = await resilientFetch(resolveAuthTokenEndpoint(gatewayBaseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${webAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          access_token: webAccessToken,
          client_id: "t3code-desktop",
          client_version: "desktop",
        }),
        maxRetries: 2,
        timeoutMs: 30_000,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = readString(payload, "message") ?? readString(payload, "error");
        throw new Error(message ?? `Gateway token exchange failed with HTTP ${response.status}.`);
      }

      return parseExchangePayload(payload);
    },
    catch: (cause) => new DesktopCommercialAuthExchangeError({ cause }),
  });
}

function exchangePKCECodeForIDEToken(input: {
  readonly gatewayBaseUrl: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly clientVersion: string;
  readonly platform: string;
  readonly deviceId: string;
}): Effect.Effect<IDETokenExchangeResult, DesktopCommercialAuthExchangeError> {
  return Effect.tryPromise({
    try: async () => {
      const gatewayBaseUrl = normalizeGatewayBaseUrl(input.gatewayBaseUrl);
      const response = await resilientFetch(resolveAuthTokenEndpoint(gatewayBaseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: input.code,
          code_verifier: input.codeVerifier,
          client_id: IDE_CLIENT_ID,
          client_version: input.clientVersion,
          platform: input.platform,
          device_id: input.deviceId,
        }),
        maxRetries: 2,
        timeoutMs: 30_000,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = readString(payload, "message") ?? readString(payload, "error");
        throw new Error(message ?? `Gateway token exchange failed with HTTP ${response.status}.`);
      }

      return parseExchangePayload(payload);
    },
    catch: (cause) => new DesktopCommercialAuthExchangeError({ cause }),
  });
}

function toState(document: CommercialAuthDocument): DesktopCommercialAuthState {
  return {
    gatewayBaseUrl: document.gatewayBaseUrl,
    signedIn: document.encryptedIdeJwt !== undefined,
    authenticatedAt: document.authenticatedAt ?? null,
    tokenExpiresAt: document.tokenExpiresAt ?? null,
    userLabel: document.userLabel ?? null,
  };
}

export const layer = Layer.effect(
  DesktopCommercialAuth,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
    const shell = yield* ElectronShell.ElectronShell;
    const shellContext = yield* Effect.context<ElectronShell.ElectronShell>();
    const runShellPromise = Effect.runPromiseWith(shellContext);

    const writeAuthDocument = (document: CommercialAuthDocument) =>
      writeDocument({
        fileSystem,
        path,
        authPath: environment.commercialAuthPath,
        document,
      }).pipe(Effect.mapError((cause) => new DesktopCommercialAuthWriteError({ cause })));

    return DesktopCommercialAuth.of({
      getState: readDocument(fileSystem, environment.commercialAuthPath).pipe(
        Effect.map(toState),
        Effect.withSpan("desktop.commercialAuth.getState"),
      ),
      getCredentials: Effect.gen(function* () {
        const document = yield* readDocument(fileSystem, environment.commercialAuthPath);
        const encoded = Option.fromNullishOr(document.encryptedIdeJwt);
        if (Option.isNone(encoded) || !(yield* safeStorage.isEncryptionAvailable)) {
          return Option.none<DesktopCommercialAuthCredentials>();
        }

        const secretBytes = yield* decodeSecretBytes(encoded.value);
        return Option.some({
          gatewayBaseUrl: document.gatewayBaseUrl,
          ideJwt: yield* safeStorage.decryptString(secretBytes),
        });
      }).pipe(Effect.withSpan("desktop.commercialAuth.getCredentials")),
      signIn: Effect.fn("desktop.commercialAuth.signIn")(function* (input) {
        const gatewayBaseUrl = resolveConfiguredGatewayBaseUrl();
        const exchanged = yield* exchangeWebTokenForIDEToken({
          ...input,
        });

        if (!(yield* safeStorage.isEncryptionAvailable)) {
          return yield* new ElectronSafeStorage.ElectronSafeStorageAvailabilityError({
            cause: new Error("safeStorage encryption is unavailable"),
          });
        }

        const now = yield* DateTime.now;
        const tokenExpiresAt =
          exchanged.expiresIn !== null && exchanged.expiresIn > 0
            ? DateTime.formatIso(DateTime.add(now, { seconds: exchanged.expiresIn }))
            : null;
        const document: CommercialAuthDocument = {
          version: 1,
          gatewayBaseUrl,
          encryptedIdeJwt: Encoding.encodeBase64(
            yield* safeStorage.encryptString(exchanged.accessToken),
          ),
          authenticatedAt: DateTime.formatIso(now),
          tokenExpiresAt,
          userLabel: exchanged.userLabel,
        };

        yield* writeAuthDocument(document);
        return toState(document);
      }),
      signInWithBrowser: Effect.fn("desktop.commercialAuth.signInWithBrowser")(function* (input) {
        const gatewayBaseUrl = resolveConfiguredGatewayBaseUrl();
        const codeVerifier = makePKCEVerifier();
        const codeChallenge = makePKCEChallenge(codeVerifier);
        const authorization = yield* Effect.tryPromise({
          try: () =>
            waitForPKCECallback(
              (authorizeUrl) => runShellPromise(shell.openExternal(authorizeUrl)),
              input.requestId
                ? {
                    gatewayBaseUrl,
                    codeChallenge,
                    requestId: input.requestId,
                  }
                : {
                    gatewayBaseUrl,
                    codeChallenge,
                  },
            ),
          catch: (cause) => new DesktopCommercialAuthPKCEError({ cause }),
        });
        const exchanged = yield* exchangePKCECodeForIDEToken({
          gatewayBaseUrl,
          code: authorization.code,
          codeVerifier,
          clientVersion: environment.appVersion,
          platform: process.platform,
          deviceId: makeDeviceId(environment),
        });

        if (!(yield* safeStorage.isEncryptionAvailable)) {
          return yield* new ElectronSafeStorage.ElectronSafeStorageAvailabilityError({
            cause: new Error("safeStorage encryption is unavailable"),
          });
        }

        const now = yield* DateTime.now;
        const tokenExpiresAt =
          exchanged.expiresIn !== null && exchanged.expiresIn > 0
            ? DateTime.formatIso(DateTime.add(now, { seconds: exchanged.expiresIn }))
            : null;
        const document: CommercialAuthDocument = {
          version: 1,
          gatewayBaseUrl,
          encryptedIdeJwt: Encoding.encodeBase64(
            yield* safeStorage.encryptString(exchanged.accessToken),
          ),
          authenticatedAt: DateTime.formatIso(now),
          tokenExpiresAt,
          userLabel: exchanged.userLabel,
        };

        yield* writeAuthDocument(document);
        return toState(document);
      }),
      cancelBrowserSignIn: Effect.fn("desktop.commercialAuth.cancelBrowserSignIn")(
        function* (input) {
          yield* Effect.sync(() => {
            activePKCESignIns.get(input.requestId)?.();
          });
        },
      ),
      signOut: Effect.gen(function* () {
        const document = yield* readDocument(fileSystem, environment.commercialAuthPath);
        const nextDocument: CommercialAuthDocument = {
          version: document.version,
          gatewayBaseUrl: document.gatewayBaseUrl,
          authenticatedAt: null,
          tokenExpiresAt: null,
          userLabel: null,
        };
        yield* writeAuthDocument(nextDocument);
        return toState(nextDocument);
      }).pipe(Effect.withSpan("desktop.commercialAuth.signOut")),
    });
  }),
);

export const layerTest = (input?: {
  readonly gatewayBaseUrl?: string;
  readonly ideJwt?: string;
  readonly state?: Partial<DesktopCommercialAuthState>;
}) =>
  Layer.effect(
    DesktopCommercialAuth,
    Effect.gen(function* () {
      const stateRef = yield* Ref.make<DesktopCommercialAuthState>({
        gatewayBaseUrl: input?.gatewayBaseUrl ?? DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
        signedIn: input?.ideJwt !== undefined,
        authenticatedAt: null,
        tokenExpiresAt: null,
        userLabel: null,
        ...input?.state,
      });
      const credentialRef = yield* Ref.make(
        input?.ideJwt
          ? Option.some({
              gatewayBaseUrl: input.gatewayBaseUrl ?? DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
              ideJwt: input.ideJwt,
            })
          : Option.none<DesktopCommercialAuthCredentials>(),
      );

      return DesktopCommercialAuth.of({
        getState: Ref.get(stateRef),
        getCredentials: Ref.get(credentialRef),
        signIn: (request) =>
          Ref.updateAndGet(stateRef, (previous) => ({
            ...previous,
            signedIn: true,
            authenticatedAt: "2026-05-10T00:00:00.000Z",
          })),
        signInWithBrowser: (request) =>
          Ref.updateAndGet(stateRef, (previous) => ({
            ...previous,
            signedIn: true,
            authenticatedAt: "2026-05-10T00:00:00.000Z",
          })),
        cancelBrowserSignIn: () => Effect.void,
        signOut: Ref.updateAndGet(stateRef, (previous) => ({
          ...previous,
          signedIn: false,
          authenticatedAt: null,
          tokenExpiresAt: null,
          userLabel: null,
        })),
      });
    }),
  );
