import * as Crypto from "node:crypto";

import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";

export const SUPPORTED_ENGINE_PROTOCOL_VERSION = "app-server-v1";

const EngineIntegrityManifestDocument = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  protocolVersion: Schema.optionalKey(Schema.String),
  binaries: Schema.Record(Schema.String, Schema.String),
  signatures: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

type EngineIntegrityManifestDocument = typeof EngineIntegrityManifestDocument.Type;

const EngineIntegrityManifestJson = fromLenientJson(EngineIntegrityManifestDocument);
const decodeEngineIntegrityManifestJson = Schema.decodeEffect(EngineIntegrityManifestJson);

export class DesktopEngineIntegrityError extends Data.TaggedError("DesktopEngineIntegrityError")<{
  readonly enginePath: string;
  readonly reason: string;
}> {
  override get message() {
    return `Engine integrity check failed for ${this.enginePath}: ${this.reason}`;
  }
}

export interface DesktopEngineIntegrityShape {
  readonly ensure: (enginePath: string) => Effect.Effect<void, DesktopEngineIntegrityError>;
  readonly verifyHash: (input: {
    readonly enginePath: string;
    readonly expectedSha256: string;
  }) => Effect.Effect<void, DesktopEngineIntegrityError>;
}

export class DesktopEngineIntegrity extends Context.Service<
  DesktopEngineIntegrity,
  DesktopEngineIntegrityShape
>()("t3/desktop/EngineIntegrity") {}

const { logInfo: logIntegrityInfo, logWarning: logIntegrityWarning } =
  DesktopObservability.makeComponentLogger("desktop-engine-integrity");

function sha256(bytes: Uint8Array): string {
  return Crypto.createHash("sha256").update(bytes).digest("hex");
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

const readManifest = Effect.fn("desktop.engineIntegrity.readManifest")(function* (
  manifestPath: string,
): Effect.fn.Return<Option.Option<EngineIntegrityManifestDocument>, never, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  const raw = yield* fileSystem.readFileString(manifestPath).pipe(Effect.option);
  if (Option.isNone(raw)) {
    return Option.none();
  }
  return yield* decodeEngineIntegrityManifestJson(raw.value).pipe(
    Effect.map(Option.some),
    Effect.catch(() => Effect.succeed(Option.none<EngineIntegrityManifestDocument>())),
  );
});

const resolveManifest = Effect.fn("desktop.engineIntegrity.resolveManifest")(function* (
  enginePath: string,
): Effect.fn.Return<
  Option.Option<{
    readonly manifestPath: string;
    readonly manifest: EngineIntegrityManifestDocument;
  }>,
  never,
  DesktopEnvironment.DesktopEnvironment | FileSystem.FileSystem
> {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const sameDirectoryManifestPath = environment.path.join(
    environment.path.dirname(enginePath),
    "engine-manifest.json",
  );
  const candidates = [
    sameDirectoryManifestPath,
    ...environment.resolveResourcePathCandidates("engine-manifest.json"),
  ];

  for (const candidate of candidates) {
    const manifest = yield* readManifest(candidate).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );
    if (Option.isSome(manifest)) {
      return Option.some({ manifestPath: candidate, manifest: manifest.value });
    }
  }

  return Option.none();
});

export const layer = Layer.effect(
  DesktopEngineIntegrity,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const config = yield* DesktopConfig.DesktopConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const startupDiagnostics = yield* DesktopObservability.DesktopStartupDiagnostics;

    const verifyHash: DesktopEngineIntegrityShape["verifyHash"] = Effect.fn(
      "desktop.engineIntegrity.verifyHash",
    )(function* ({ enginePath, expectedSha256 }) {
      const bytes = yield* fileSystem
        .readFile(enginePath)
        .pipe(
          Effect.mapError(
            () => new DesktopEngineIntegrityError({ enginePath, reason: "engine file not found" }),
          ),
        );
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== expectedSha256.toLowerCase()) {
        return yield* new DesktopEngineIntegrityError({
          enginePath,
          reason: `sha256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
        });
      }
    });

    const runEnsure = Effect.fn("desktop.engineIntegrity.ensure")(function* (enginePath: string) {
      const manifestResult = yield* resolveManifest(enginePath).pipe(
        Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
      );
      if (Option.isNone(manifestResult)) {
        if (!environment.isPackaged && enginePath === environment.engineBinaryPath) {
          yield* logIntegrityWarning(
            "engine integrity manifest not found in unpackaged runtime; verification skipped",
            { enginePath },
          );
          return;
        }
        return yield* new DesktopEngineIntegrityError({
          enginePath,
          reason: "engine integrity manifest not found",
        });
      }

      const protocolVersion = manifestResult.value.manifest.protocolVersion;
      if (protocolVersion !== undefined && protocolVersion !== SUPPORTED_ENGINE_PROTOCOL_VERSION) {
        return yield* new DesktopEngineIntegrityError({
          enginePath,
          reason: `unsupported protocol version: expected ${SUPPORTED_ENGINE_PROTOCOL_VERSION}, got ${protocolVersion}`,
        });
      }

      const binaryName = environment.path.basename(enginePath);
      const expectedSha256 = manifestResult.value.manifest.binaries[binaryName];
      if (!expectedSha256) {
        return yield* new DesktopEngineIntegrityError({
          enginePath,
          reason: `no sha256 entry for ${binaryName} in ${manifestResult.value.manifestPath}`,
        });
      }

      yield* verifyHash({ enginePath, expectedSha256 });
      const publicKey = Option.getOrUndefined(config.engineSignaturePublicKey);
      if (publicKey !== undefined) {
        const signature = manifestResult.value.manifest.signatures?.[binaryName];
        if (!signature) {
          return yield* new DesktopEngineIntegrityError({
            enginePath,
            reason: `no signature entry for ${binaryName} in ${manifestResult.value.manifestPath}`,
          });
        }
        const bytes = yield* fileSystem
          .readFile(enginePath)
          .pipe(
            Effect.mapError(
              () =>
                new DesktopEngineIntegrityError({ enginePath, reason: "engine file not found" }),
            ),
          );
        const validSignature = yield* Effect.try({
          try: () => verifyEd25519Signature({ bytes, signature, publicKey }),
          catch: (cause) =>
            new DesktopEngineIntegrityError({
              enginePath,
              reason: `signature verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        });
        if (!validSignature) {
          return yield* new DesktopEngineIntegrityError({
            enginePath,
            reason: "signature mismatch",
          });
        }
      }
      yield* logIntegrityInfo("engine integrity verified", {
        enginePath,
        manifestPath: manifestResult.value.manifestPath,
        protocolVersion: protocolVersion ?? null,
        signatureVerified: publicKey !== undefined,
      });
      yield* startupDiagnostics.record({
        event: "desktop.engine.integrity.verified",
        stage: "engine-integrity",
        details: {
          enginePath,
          manifestPath: manifestResult.value.manifestPath,
          protocolVersion: protocolVersion ?? null,
          signatureVerified: publicKey !== undefined,
        },
      });
    });

    return DesktopEngineIntegrity.of({
      verifyHash,
      ensure: (enginePath) =>
        runEnsure(enginePath).pipe(
          Effect.tapError((error) =>
            startupDiagnostics.record({
              event: "desktop.engine.integrity.failed",
              level: "ERROR",
              stage: "engine-integrity",
              details: {
                enginePath: error.enginePath,
                reason: error.reason,
                message: error.message,
              },
            }),
          ),
        ),
    });
  }),
);

export const layerTest = Layer.succeed(
  DesktopEngineIntegrity,
  DesktopEngineIntegrity.of({
    ensure: () => Effect.void,
    verifyHash: () => Effect.void,
  }),
);
