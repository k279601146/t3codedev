import * as Crypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export interface DesktopInstallationIdentityShape {
  readonly installationId: Effect.Effect<string>;
  readonly deviceId: Effect.Effect<string>;
}

export class DesktopInstallationIdentity extends Context.Service<
  DesktopInstallationIdentity,
  DesktopInstallationIdentityShape
>()("t3/desktop/InstallationIdentity") {}

const INSTALLATION_ID_PATTERN = /^[0-9a-f]{32}$/;

function normalizeInstallationId(raw: string): string | null {
  const normalized = raw.trim().replace(/-/g, "").toLowerCase();
  return INSTALLATION_ID_PATTERN.test(normalized) ? normalized : null;
}

const makeNewInstallationId = Random.nextUUIDv4.pipe(
  Effect.map((value) => value.replace(/-/g, "").toLowerCase()),
);

function makeDeviceId(environment: DesktopEnvironment.DesktopEnvironmentShape): string {
  return Crypto.createHash("sha256")
    .update(`${environment.baseDir}:${environment.platform}:${environment.processArch}`)
    .digest("hex")
    .slice(0, 24);
}

export const layer = Layer.effect(
  DesktopInstallationIdentity,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const cachedInstallationId = yield* Ref.make<string | null>(null);
    const cachedDeviceId = makeDeviceId(environment);

    const readOrCreateInstallationId = Effect.gen(function* () {
      const cached = yield* Ref.get(cachedInstallationId);
      if (cached !== null) {
        return cached;
      }

      const existing = yield* fileSystem.readFileString(environment.installationIdPath).pipe(
        Effect.map(normalizeInstallationId),
        Effect.catch(() => Effect.succeed(null)),
      );
      if (existing !== null) {
        yield* Ref.set(cachedInstallationId, existing);
        return existing;
      }

      const next = yield* makeNewInstallationId;
      yield* fileSystem
        .makeDirectory(environment.path.dirname(environment.installationIdPath), {
          recursive: true,
        })
        .pipe(Effect.catch(() => Effect.void));
      yield* fileSystem
        .writeFileString(environment.installationIdPath, `${next}\n`)
        .pipe(Effect.catch(() => Effect.void));
      yield* Ref.set(cachedInstallationId, next);
      return next;
    });

    return DesktopInstallationIdentity.of({
      installationId: readOrCreateInstallationId,
      deviceId: Effect.succeed(cachedDeviceId),
    });
  }),
);

export const layerTest = (input?: { readonly installationId?: string; readonly deviceId?: string }) =>
  Layer.succeed(DesktopInstallationIdentity, {
    installationId: Effect.succeed(input?.installationId ?? "testinstallationid000000000000"),
    deviceId: Effect.succeed(input?.deviceId ?? "test-device-id"),
  } satisfies DesktopInstallationIdentityShape);
