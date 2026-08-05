import * as Crypto from "node:crypto";

import { resilientFetch } from "@t3tools/shared/Net";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopInstallationIdentity from "../telemetry/DesktopInstallationIdentity.ts";
import { SUPPORTED_ENGINE_PROTOCOL_VERSION } from "./DesktopEngineIntegrity.ts";

const ENGINE_UPDATE_STARTUP_DELAY = Duration.minutes(5);
const ENGINE_UPDATE_POLL_INTERVAL = Duration.days(1);
const ENGINE_DOWNLOAD_TIMEOUT_MS = 120_000;
const ENGINE_MANIFEST_TIMEOUT_MS = 15_000;
const MAX_ENGINE_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const CURRENT_ENGINE_VERSION_FILE = "current_version";
const ENGINE_MANIFEST_FILE = "engine-manifest.json";
const BUNDLED_ENGINE_VERSION = "bundled";

const EngineManifestBinary = Schema.Struct({
  url: Schema.String,
  sha256: Schema.String,
  signature: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.Number),
});

const EngineManifest = Schema.Struct({
  version: Schema.String,
  minAppVersion: Schema.optionalKey(Schema.String),
  protocolVersion: Schema.optionalKey(Schema.String),
  engineName: Schema.optionalKey(Schema.String),
  upstream: Schema.optionalKey(Schema.String),
  upstreamVersion: Schema.optionalKey(Schema.String),
  build: Schema.optionalKey(Schema.String),
  binaries: Schema.Record(Schema.String, EngineManifestBinary),
});

type EngineManifest = typeof EngineManifest.Type;
type EngineManifestBinary = typeof EngineManifestBinary.Type;

const decodeEngineManifest = Schema.decodeUnknownEffect(EngineManifest);
const encodeEngineIntegrityManifestJson = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.String,
      protocolVersion: Schema.optionalKey(Schema.String),
      binaries: Schema.Record(Schema.String, Schema.String),
      signatures: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);

export class DesktopEngineUpdateError extends Data.TaggedError("DesktopEngineUpdateError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {
  override get message() {
    return `Engine update failed: ${this.reason}`;
  }
}

export interface DesktopEngineUpdaterShape {
  readonly getCurrentVersion: Effect.Effect<string>;
  readonly getActiveEnginePath: Effect.Effect<string>;
  readonly checkAndUpdate: Effect.Effect<void, DesktopEngineUpdateError>;
  readonly rollback: Effect.Effect<boolean, DesktopEngineUpdateError>;
  readonly configure: Effect.Effect<void, never, Scope.Scope>;
}

export class DesktopEngineUpdater extends Context.Service<
  DesktopEngineUpdater,
  DesktopEngineUpdaterShape
>()("t3/desktop/EngineUpdater") {}

const {
  logInfo: logEngineUpdaterInfo,
  logWarning: logEngineUpdaterWarning,
  logError: logEngineUpdaterError,
} = DesktopObservability.makeComponentLogger("desktop-engine-updater");

function getEngineBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "ai-engine.exe" : "ai-engine";
}

function platformKey(input: { readonly platform: NodeJS.Platform; readonly arch: string }): string {
  return `${input.platform}-${input.arch}`;
}

function parseVersionParts(version: string): readonly number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a: string, b: string): number {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function sha256(bytes: Uint8Array): string {
  return Crypto.createHash("sha256").update(bytes).digest("hex");
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter((entry) => entry[1] !== undefined));
}

function normalizeManifestPayload(raw: unknown): unknown {
  const payload =
    typeof raw === "object" &&
    raw !== null &&
    "data" in raw &&
    typeof (raw as { readonly data?: unknown }).data === "object" &&
    (raw as { readonly data?: unknown }).data !== null
      ? (raw as { readonly data: unknown }).data
      : raw;

  if (typeof payload !== "object" || payload === null) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const download =
    typeof record.download === "object" && record.download !== null
      ? (record.download as Record<string, unknown>)
      : null;
  const platform = platformKey({
    platform: process.platform,
    arch: process.arch,
  });
  const binaries =
    typeof record.binaries === "object" && record.binaries !== null
      ? record.binaries
      : download
        ? {
            [platform]: compactRecord({
              url: stringFromRecord(download, "url") ?? stringFromRecord(record, "download_url"),
              sha256: stringFromRecord(download, "sha256") ?? stringFromRecord(record, "sha256"),
              signature:
                stringFromRecord(download, "signature") ?? stringFromRecord(record, "signature"),
              size: numberFromRecord(download, "size"),
            }),
          }
        : undefined;

  return compactRecord({
    version:
      stringFromRecord(record, "version") ??
      stringFromRecord(record, "latest_version") ??
      stringFromRecord(record, "latestVersion"),
    minAppVersion:
      stringFromRecord(record, "minAppVersion") ?? stringFromRecord(record, "min_app_version"),
    protocolVersion:
      stringFromRecord(record, "protocolVersion") ?? stringFromRecord(record, "protocol_version"),
    engineName: stringFromRecord(record, "engineName") ?? stringFromRecord(record, "engine_name"),
    upstream: stringFromRecord(record, "upstream"),
    upstreamVersion:
      stringFromRecord(record, "upstreamVersion") ?? stringFromRecord(record, "upstream_version"),
    build: stringFromRecord(record, "build"),
    binaries,
  });
}

function verifyEd25519Signature(input: {
  readonly bytes: Uint8Array;
  readonly signature: string;
  readonly publicKey: string;
}): boolean {
  const key = input.publicKey.includes("BEGIN")
    ? input.publicKey
    : Crypto.createPublicKey({
        key: Buffer.from(input.publicKey, "base64"),
        format: "der",
        type: "spki",
      });
  return Crypto.verify(null, Buffer.from(input.bytes), key, Buffer.from(input.signature, "base64"));
}

function assertTrustedDownloadUrl(rawUrl: string, isDevelopment: boolean): void {
  const url = new URL(rawUrl);
  if (url.protocol === "https:") return;

  const localHttpAllowed =
    isDevelopment &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (!localHttpAllowed) {
    throw new Error("engine update downloads must use HTTPS");
  }
}

function isNoEngineUpdateBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;

  try {
    const payload = JSON.parse(trimmed) as unknown;
    if (typeof payload === "object" && payload !== null && "detail" in payload) {
      return (payload as { readonly detail?: unknown }).detail === "No engine update";
    }
  } catch {
    return false;
  }

  return false;
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  headers?: Readonly<Record<string, string>>,
): Promise<unknown | null> {
  const response = await resilientFetch(
    url,
    headers === undefined ? { timeoutMs } : { timeoutMs, headers },
  );
  if (response.status === 404) {
    const body = await response.text();
    if (isNoEngineUpdateBody(body)) {
      return null;
    }
    throw new Error(body.trim().length > 0 ? `HTTP 404: ${body.trim()}` : "HTTP 404");
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.json();
}

async function fetchBinary(url: string, timeoutMs: number): Promise<Uint8Array> {
  const response = await resilientFetch(url, { timeoutMs });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ENGINE_DOWNLOAD_BYTES) {
    throw new Error("download exceeded maximum engine size");
  }
  return bytes;
}

const toEngineUpdateError = (cause: unknown): DesktopEngineUpdateError =>
  cause instanceof DesktopEngineUpdateError
    ? cause
    : new DesktopEngineUpdateError({
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

const writeVersionManifest = Effect.fn("desktop.engineUpdater.writeVersionManifest")(
  function* (input: {
    readonly versionDir: string;
    readonly binaryName: string;
    readonly version: string;
    readonly sha256: string;
    readonly protocolVersion?: string;
    readonly signature?: string;
  }): Effect.fn.Return<void, never, FileSystem.FileSystem> {
    const fileSystem = yield* FileSystem.FileSystem;
    const encoded = yield* encodeEngineIntegrityManifestJson({
      version: input.version,
      ...(input.protocolVersion ? { protocolVersion: input.protocolVersion } : {}),
      binaries: {
        [input.binaryName]: input.sha256,
      },
      ...(input.signature
        ? {
            signatures: {
              [input.binaryName]: input.signature,
            },
          }
        : {}),
    }).pipe(Effect.orDie);
    yield* fileSystem
      .writeFileString(`${input.versionDir}/${ENGINE_MANIFEST_FILE}`, `${encoded}\n`)
      .pipe(Effect.ignore);
  },
);

export const layer = Layer.effect(
  DesktopEngineUpdater,
  Effect.gen(function* () {
    const config = yield* DesktopConfig.DesktopConfig;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const installationIdentity = yield* DesktopInstallationIdentity.DesktopInstallationIdentity;
    const binaryName = getEngineBinaryName(environment.platform);
    const currentVersionPath = environment.path.join(
      environment.engineVersionsPath,
      CURRENT_ENGINE_VERSION_FILE,
    );

    const getCurrentVersion = fileSystem.readFileString(currentVersionPath).pipe(
      Effect.map((value) => value.trim() || BUNDLED_ENGINE_VERSION),
      Effect.orElseSucceed(() => BUNDLED_ENGINE_VERSION),
    );

    const getEnginePathForVersion = (version: string): string =>
      version === BUNDLED_ENGINE_VERSION
        ? environment.engineBinaryPath
        : environment.path.join(environment.engineVersionsPath, version, binaryName);

    const getActiveEnginePath = Effect.gen(function* () {
      const version = yield* getCurrentVersion;
      const candidate = getEnginePathForVersion(version);
      if (version === BUNDLED_ENGINE_VERSION) {
        return candidate;
      }
      const exists = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      return exists ? candidate : environment.engineBinaryPath;
    });

    const cleanupOldVersions = Effect.fn("desktop.engineUpdater.cleanupOldVersions")(function* (
      keepVersion: string,
    ) {
      const entries = yield* fileSystem
        .readDirectory(environment.engineVersionsPath)
        .pipe(Effect.orElseSucceed(() => []));
      const versions = entries
        .filter((entry) => entry !== CURRENT_ENGINE_VERSION_FILE && entry !== keepVersion)
        .sort();
      while (versions.length > 1) {
        const removed = versions.shift();
        if (removed) {
          yield* fileSystem
            .remove(environment.path.join(environment.engineVersionsPath, removed), {
              recursive: true,
              force: true,
            })
            .pipe(Effect.ignore);
        }
      }
    });

    const applyUpdate = Effect.fn("desktop.engineUpdater.applyUpdate")(function* (
      manifest: EngineManifest,
      binary: EngineManifestBinary,
    ): Effect.fn.Return<void, DesktopEngineUpdateError> {
      return yield* Effect.gen(function* () {
        yield* Effect.try({
          try: () => assertTrustedDownloadUrl(binary.url, environment.isDevelopment),
          catch: (cause) =>
            new DesktopEngineUpdateError({ reason: "untrusted download URL", cause }),
        });
        if (binary.size !== undefined && binary.size > MAX_ENGINE_DOWNLOAD_BYTES) {
          return yield* new DesktopEngineUpdateError({ reason: "manifest binary is too large" });
        }

        const bytes = yield* Effect.tryPromise({
          try: () => fetchBinary(binary.url, ENGINE_DOWNLOAD_TIMEOUT_MS),
          catch: (cause) => new DesktopEngineUpdateError({ reason: "download failed", cause }),
        });
        const actualSha256 = sha256(bytes);
        if (actualSha256 !== binary.sha256.toLowerCase()) {
          return yield* new DesktopEngineUpdateError({
            reason: `sha256 mismatch: expected ${binary.sha256}, got ${actualSha256}`,
          });
        }
        const signaturePublicKey = Option.getOrUndefined(config.engineSignaturePublicKey);
        if (signaturePublicKey !== undefined) {
          if (!binary.signature) {
            return yield* new DesktopEngineUpdateError({
              reason: "manifest binary is missing required signature",
            });
          }
          const validSignature = yield* Effect.try({
            try: () =>
              verifyEd25519Signature({
                bytes,
                signature: binary.signature ?? "",
                publicKey: signaturePublicKey,
              }),
            catch: (cause) =>
              new DesktopEngineUpdateError({ reason: "signature verification failed", cause }),
          });
          if (!validSignature) {
            return yield* new DesktopEngineUpdateError({ reason: "signature mismatch" });
          }
        }

        const versionDir = environment.path.join(environment.engineVersionsPath, manifest.version);
        const tmpPath = environment.path.join(
          environment.engineVersionsPath,
          `${manifest.version}.tmp`,
        );
        const finalPath = environment.path.join(versionDir, binaryName);
        yield* fileSystem.makeDirectory(environment.engineVersionsPath, { recursive: true });
        yield* fileSystem.remove(tmpPath, { force: true }).pipe(Effect.ignore);
        yield* fileSystem.writeFile(tmpPath, bytes);
        yield* fileSystem.makeDirectory(versionDir, { recursive: true });
        yield* fileSystem.rename(tmpPath, finalPath);
        yield* fileSystem.chmod(finalPath, 0o755).pipe(Effect.ignore);
        yield* writeVersionManifest({
          versionDir,
          binaryName,
          version: manifest.version,
          sha256: actualSha256,
          ...(manifest.protocolVersion ? { protocolVersion: manifest.protocolVersion } : {}),
          ...(binary.signature ? { signature: binary.signature } : {}),
        }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));
        yield* fileSystem.writeFileString(currentVersionPath, `${manifest.version}\n`);
        yield* cleanupOldVersions(manifest.version);
        yield* logEngineUpdaterInfo("engine updated", {
          version: manifest.version,
          path: finalPath,
        });
      }).pipe(Effect.mapError(toEngineUpdateError));
    });

    const checkAndUpdate = Effect.gen(function* () {
      const manifestUrl = Option.getOrUndefined(config.engineManifestUrl);
      if (manifestUrl === undefined) {
        yield* logEngineUpdaterInfo("engine update manifest not configured");
        return;
      }

      const currentVersion = yield* getCurrentVersion;
      const installationId = yield* installationIdentity.installationId;
      const deviceId = yield* installationIdentity.deviceId;
      const rawManifest = yield* Effect.tryPromise({
        try: () =>
          fetchJson(manifestUrl, ENGINE_MANIFEST_TIMEOUT_MS, {
            "x-t3code-version": environment.appVersion,
            "x-t3code-engine-version": currentVersion,
            "x-t3code-platform": environment.platform,
            "x-t3code-arch": environment.processArch,
            "x-t3code-installation-id": installationId,
            "x-t3code-device-id": deviceId,
          }),
        catch: (cause) => new DesktopEngineUpdateError({ reason: "manifest fetch failed", cause }),
      });
      if (rawManifest === null) {
        yield* logEngineUpdaterInfo("engine update manifest reports no update");
        return;
      }
      const manifest = yield* decodeEngineManifest(normalizeManifestPayload(rawManifest)).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopEngineUpdateError({ reason: `invalid manifest: ${cause.message}`, cause }),
        ),
      );

      if (
        manifest.protocolVersion !== undefined &&
        manifest.protocolVersion !== SUPPORTED_ENGINE_PROTOCOL_VERSION
      ) {
        return yield* new DesktopEngineUpdateError({
          reason: `unsupported protocol version: expected ${SUPPORTED_ENGINE_PROTOCOL_VERSION}, got ${manifest.protocolVersion}`,
        });
      }

      if (
        manifest.minAppVersion !== undefined &&
        compareVersions(environment.appVersion, manifest.minAppVersion) < 0
      ) {
        yield* logEngineUpdaterWarning("engine update skipped because app is too old", {
          appVersion: environment.appVersion,
          minAppVersion: manifest.minAppVersion,
          engineVersion: manifest.version,
        });
        return;
      }

      if (
        currentVersion !== BUNDLED_ENGINE_VERSION &&
        compareVersions(currentVersion, manifest.version) >= 0
      ) {
        yield* logEngineUpdaterInfo("engine already up to date", {
          currentVersion,
          latestVersion: manifest.version,
        });
        return;
      }

      const key = platformKey({
        platform: environment.platform,
        arch: environment.processArch,
      });
      const binary = manifest.binaries[key];
      if (!binary) {
        yield* logEngineUpdaterWarning("engine manifest has no binary for current platform", {
          platform: key,
          version: manifest.version,
        });
        return;
      }

      yield* applyUpdate(manifest, binary);
    }).pipe(Effect.withSpan("desktop.engineUpdater.checkAndUpdate"));

    const rollback = Effect.gen(function* () {
      const currentVersion = yield* getCurrentVersion;
      const entries = yield* fileSystem
        .readDirectory(environment.engineVersionsPath)
        .pipe(Effect.orElseSucceed(() => []));
      const versions = entries
        .filter(
          (entry) =>
            entry !== CURRENT_ENGINE_VERSION_FILE &&
            !entry.endsWith(".tmp") &&
            entry !== BUNDLED_ENGINE_VERSION,
        )
        .sort(compareVersions);

      const currentIndex = versions.indexOf(currentVersion);
      const previousVersion =
        currentIndex > 0
          ? versions[currentIndex - 1]
          : versions.filter((version) => version !== currentVersion).at(-1);
      const rollbackVersion = previousVersion ?? BUNDLED_ENGINE_VERSION;

      const previousPath = getEnginePathForVersion(rollbackVersion);
      const exists = yield* fileSystem.exists(previousPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return false;
      }

      yield* fileSystem.makeDirectory(environment.engineVersionsPath, { recursive: true });
      yield* fileSystem.writeFileString(currentVersionPath, `${rollbackVersion}\n`);
      yield* logEngineUpdaterWarning("engine rolled back", {
        fromVersion: currentVersion,
        toVersion: rollbackVersion,
        path: previousPath,
      });
      return true;
    }).pipe(
      Effect.mapError(toEngineUpdateError),
      Effect.withSpan("desktop.engineUpdater.rollback"),
    );

    const configure = Effect.gen(function* () {
      yield* Effect.sleep(ENGINE_UPDATE_STARTUP_DELAY).pipe(
        Effect.andThen(checkAndUpdate),
        Effect.catch((error) => logEngineUpdaterError(error.message)),
        Effect.forkScoped,
      );
      yield* Effect.sleep(ENGINE_UPDATE_POLL_INTERVAL).pipe(
        Effect.andThen(checkAndUpdate),
        Effect.forever,
        Effect.catch((error) => logEngineUpdaterError(error.message)),
        Effect.forkScoped,
      );
    });

    return DesktopEngineUpdater.of({
      getCurrentVersion,
      getActiveEnginePath,
      checkAndUpdate,
      rollback,
      configure,
    });
  }),
);

export const layerTest = (input?: {
  readonly activeEnginePath?: string;
  readonly currentVersion?: string;
}) =>
  Layer.succeed(
    DesktopEngineUpdater,
    DesktopEngineUpdater.of({
      getCurrentVersion: Effect.succeed(input?.currentVersion ?? BUNDLED_ENGINE_VERSION),
      getActiveEnginePath: Effect.succeed(input?.activeEnginePath ?? ""),
      checkAndUpdate: Effect.void,
      rollback: Effect.succeed(false),
      configure: Effect.void,
    }),
  );
