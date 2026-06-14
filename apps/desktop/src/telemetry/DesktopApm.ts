import { resilientFetch } from "@t3tools/shared/Net";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopCommercialAuth from "../settings/DesktopCommercialAuth.ts";
import * as DesktopEngineUpdater from "../engine/DesktopEngineUpdater.ts";
import * as DesktopInstallationIdentity from "./DesktopInstallationIdentity.ts";

export type DesktopApmEventType =
  | "session_start"
  | "session_end"
  | "ttft"
  | "error"
  | "install_heartbeat"
  | "app_launch"
  | "backend_ready"
  | "backend_start_failed"
  | "engine_crash"
  | "update"
  | "update_check_failed"
  | "update_download_failed"
  | "update_install_failed"
  | "engine_integrity_failed";

export interface DesktopApmEvent {
  readonly type: DesktopApmEventType;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly appVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly engineVersion: string;
  readonly installationId: string;
  readonly deviceId: string;
}

export interface DesktopApmShape {
  readonly track: (
    type: DesktopApmEventType,
    data: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>;
  readonly heartbeat: (reason: string) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void>;
}

export class DesktopApm extends Context.Service<DesktopApm, DesktopApmShape>()(
  "t3/desktop/DesktopApm",
) {}

const APM_BATCH_SIZE = 50;
const INSTALLATION_ENDPOINT_PATH = "/ide/api/installations/heartbeat";
const APM_ENDPOINT_PATH = "/ide/api/telemetry";
const OPERATIONAL_EVENT_TYPES = new Set<DesktopApmEventType>([
  "install_heartbeat",
  "app_launch",
  "backend_ready",
  "backend_start_failed",
  "engine_crash",
  "update_check_failed",
  "update_download_failed",
  "update_install_failed",
  "engine_integrity_failed",
]);

const { logWarning: logApmWarning } = DesktopObservability.makeComponentLogger("desktop-apm");

class DesktopApmUploadError extends Data.TaggedError("DesktopApmUploadError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : "Desktop APM upload failed.";
  }
}

function resolveApmEndpoint(gatewayBaseUrl: string): string {
  const url = new URL(gatewayBaseUrl);
  return new URL(APM_ENDPOINT_PATH, url.origin).toString();
}

function resolveInstallationEndpoint(gatewayBaseUrl: string): string {
  const url = new URL(gatewayBaseUrl);
  return new URL(INSTALLATION_ENDPOINT_PATH, url.origin).toString();
}

function consentKeyForEvent(
  type: DesktopApmEventType,
): "operationalTelemetry" | "crashReporting" | "usageAnalytics" {
  if (OPERATIONAL_EVENT_TYPES.has(type)) {
    return "operationalTelemetry";
  }
  return type === "error" ? "crashReporting" : "usageAnalytics";
}

function sanitizeEventData(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("token") ||
      normalizedKey.includes("jwt") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("prompt") ||
      normalizedKey.includes("path") ||
      normalizedKey.includes("code") ||
      normalizedKey.includes("log") ||
      normalizedKey.includes("output") ||
      normalizedKey.includes("terminal")
    ) {
      continue;
    }
    sanitized[key] = typeof value === "string" && value.length > 500 ? value.slice(0, 500) : value;
  }
  return sanitized;
}

export const layer = Layer.effect(
  DesktopApm,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const engineUpdater = yield* DesktopEngineUpdater.DesktopEngineUpdater;
    const identity = yield* DesktopInstallationIdentity.DesktopInstallationIdentity;
    const queue = yield* Ref.make<ReadonlyArray<DesktopApmEvent>>([]);

    const hasConsent = (type: DesktopApmEventType) =>
      clientSettings.get.pipe(
        Effect.map((settings) =>
          Option.match(settings, {
            onNone: () => consentKeyForEvent(type) === "operationalTelemetry",
            onSome: (value) => value.telemetryConsent[consentKeyForEvent(type)] === true,
          }),
        ),
      );

    const resolveUploadTarget = Effect.gen(function* () {
      const state = yield* commercialAuth.getState;
      const credentials = yield* commercialAuth.getCredentials.pipe(
        Effect.catch(() =>
          logApmWarning("desktop apm credentials unavailable").pipe(
            Effect.as(Option.none<DesktopCommercialAuth.DesktopCommercialAuthCredentials>()),
          ),
        ),
      );
      return {
        gatewayBaseUrl: Option.match(credentials, {
          onNone: () => state.gatewayBaseUrl,
          onSome: (value) => value.gatewayBaseUrl,
        }),
        authorization: Option.match(credentials, {
          onNone: () => undefined,
          onSome: (value) => `Bearer ${value.ideJwt}`,
        }),
      };
    });

    const flush = Effect.gen(function* () {
      const events = yield* Ref.getAndSet(queue, []);
      if (events.length === 0) {
        return;
      }
      const target = yield* resolveUploadTarget;

      yield* Effect.tryPromise({
        try: () =>
          resilientFetch(resolveApmEndpoint(target.gatewayBaseUrl), {
            method: "POST",
            headers: {
              ...(target.authorization ? { Authorization: target.authorization } : {}),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ events }),
            maxRetries: 2,
            timeoutMs: 10_000,
          }).then((response) => {
            if (!response.ok) {
              throw new Error(`APM upload failed with HTTP ${response.status}.`);
            }
          }),
        catch: (cause) => new DesktopApmUploadError({ cause }),
      }).pipe(
        Effect.catch((cause) =>
          Ref.update(queue, (current) => [...events, ...current].slice(0, APM_BATCH_SIZE)).pipe(
            Effect.andThen(
              logApmWarning("desktop apm flush failed", {
                detail: cause.message,
              }),
            ),
          ),
        ),
      );
    });

    const track: DesktopApmShape["track"] = (type, data) =>
      Effect.gen(function* () {
        if (!(yield* hasConsent(type))) {
          return;
        }
        const event: DesktopApmEvent = {
          type,
          timestamp: DateTime.formatIso(yield* DateTime.now),
          data: sanitizeEventData(data),
          appVersion: environment.appVersion,
          platform: process.platform,
          arch: process.arch,
          engineVersion: yield* engineUpdater.getCurrentVersion,
          installationId: yield* identity.installationId,
          deviceId: yield* identity.deviceId,
        };
        const size = yield* Ref.updateAndGet(queue, (current) => [...current, event]);
        if (size.length >= APM_BATCH_SIZE) {
          yield* flush;
        }
      });

    const heartbeat: DesktopApmShape["heartbeat"] = (reason) =>
      Effect.gen(function* () {
        if (!(yield* hasConsent("install_heartbeat"))) {
          return;
        }
        const target = yield* resolveUploadTarget;
        const engineVersion = yield* engineUpdater.getCurrentVersion;
        const payload = {
          installation_id: yield* identity.installationId,
          device_id: yield* identity.deviceId,
          app_version: environment.appVersion,
          platform: process.platform,
          arch: process.arch,
          channel: environment.branding.stageLabel,
          engine_version: engineVersion,
          reason,
        };
        yield* Effect.tryPromise({
          try: () =>
            resilientFetch(resolveInstallationEndpoint(target.gatewayBaseUrl), {
              method: "POST",
              headers: {
                ...(target.authorization ? { Authorization: target.authorization } : {}),
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
              maxRetries: 2,
              timeoutMs: 10_000,
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`Installation heartbeat failed with HTTP ${response.status}.`);
              }
            }),
          catch: (cause) => new DesktopApmUploadError({ cause }),
        }).pipe(
          Effect.catch((cause) =>
            logApmWarning("desktop installation heartbeat failed", {
              detail: cause.message,
            }),
          ),
        );
      });

    yield* Effect.addFinalizer(() => flush.pipe(Effect.ignore));

    return DesktopApm.of({
      track,
      heartbeat,
      flush,
    });
  }),
);

export const layerNoop = Layer.succeed(DesktopApm, {
  track: () => Effect.void,
  heartbeat: () => Effect.void,
  flush: Effect.void,
} satisfies DesktopApmShape);
