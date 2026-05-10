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

export type DesktopApmEventType =
  | "session_start"
  | "session_end"
  | "ttft"
  | "error"
  | "engine_crash"
  | "update";

export interface DesktopApmEvent {
  readonly type: DesktopApmEventType;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly appVersion: string;
  readonly platform: NodeJS.Platform;
  readonly engineVersion: string;
}

export interface DesktopApmShape {
  readonly track: (
    type: DesktopApmEventType,
    data: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void>;
}

export class DesktopApm extends Context.Service<DesktopApm, DesktopApmShape>()(
  "t3/desktop/DesktopApm",
) {}

const APM_BATCH_SIZE = 50;
const APM_ENDPOINT_PATH = "/ide/api/telemetry";

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

function consentKeyForEvent(type: DesktopApmEventType): "crashReporting" | "usageAnalytics" {
  return type === "engine_crash" || type === "error" ? "crashReporting" : "usageAnalytics";
}

export const layer = Layer.effect(
  DesktopApm,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const engineUpdater = yield* DesktopEngineUpdater.DesktopEngineUpdater;
    const queue = yield* Ref.make<ReadonlyArray<DesktopApmEvent>>([]);

    const hasConsent = (type: DesktopApmEventType) =>
      clientSettings.get.pipe(
        Effect.map((settings) =>
          Option.match(settings, {
            onNone: () => false,
            onSome: (value) => value.telemetryConsent[consentKeyForEvent(type)] === true,
          }),
        ),
      );

    const flush = Effect.gen(function* () {
      const credentials = yield* commercialAuth.getCredentials.pipe(
        Effect.catch(() =>
          logApmWarning("desktop apm credentials unavailable").pipe(
            Effect.as(Option.none<DesktopCommercialAuth.DesktopCommercialAuthCredentials>()),
          ),
        ),
      );
      if (Option.isNone(credentials)) {
        return;
      }

      const events = yield* Ref.getAndSet(queue, []);
      if (events.length === 0) {
        return;
      }

      yield* Effect.tryPromise({
        try: () =>
          resilientFetch(resolveApmEndpoint(credentials.value.gatewayBaseUrl), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${credentials.value.ideJwt}`,
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
          data,
          appVersion: environment.appVersion,
          platform: process.platform,
          engineVersion: yield* engineUpdater.getCurrentVersion,
        };
        const size = yield* Ref.updateAndGet(queue, (current) => [...current, event]);
        if (size.length >= APM_BATCH_SIZE) {
          yield* flush;
        }
      });

    yield* Effect.addFinalizer(() => flush.pipe(Effect.ignore));

    return DesktopApm.of({
      track,
      flush,
    });
  }),
);

export const layerNoop = Layer.succeed(DesktopApm, {
  track: () => Effect.void,
  flush: Effect.void,
} satisfies DesktopApmShape);
