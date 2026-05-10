import {
  type DesktopCommercialAuthSignInInput,
  type DesktopCommercialAuthState,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import {
  DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
  resolveCommercialEngineGatewayBaseUrl,
} from "@t3tools/shared/commercialEngine";
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

export type DesktopCommercialAuthGetCredentialsError =
  | DesktopCommercialAuthSecretDecodeError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError;

export type DesktopCommercialAuthSignInError =
  | DesktopCommercialAuthExchangeError
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
  const baseDocument = {
    version: document.version ?? 1,
    gatewayBaseUrl: document.gatewayBaseUrl?.trim() || resolveCommercialEngineGatewayBaseUrl({}),
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
            gatewayBaseUrl: DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
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
                gatewayBaseUrl: DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
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

function exchangeWebTokenForIDEToken(
  input: DesktopCommercialAuthSignInInput,
): Effect.Effect<IDETokenExchangeResult, DesktopCommercialAuthExchangeError> {
  return Effect.tryPromise({
    try: async () => {
      const gatewayBaseUrl = normalizeGatewayBaseUrl(input.gatewayBaseUrl);
      const webAccessToken = input.webAccessToken.trim();
      if (webAccessToken.length === 0) {
        throw new Error("Web access token is required.");
      }

      const response = await fetch(resolveAuthTokenEndpoint(gatewayBaseUrl), {
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
        const gatewayBaseUrl = normalizeGatewayBaseUrl(input.gatewayBaseUrl);
        const exchanged = yield* exchangeWebTokenForIDEToken({
          ...input,
          gatewayBaseUrl,
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
            gatewayBaseUrl: request.gatewayBaseUrl,
            signedIn: true,
            authenticatedAt: "2026-05-10T00:00:00.000Z",
          })),
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
