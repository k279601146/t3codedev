import {
  CommercialAccountUsageSchema,
  GatewayModelListResultSchema,
  SetLastUsedModelInputSchema,
} from "@t3tools/contracts";
import { resilientFetch } from "@t3tools/shared/Net";
import {
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeApiBaseUrlCandidates,
} from "@t3tools/shared/commercialEngine";
import { parseCommercialGatewayModelListResponse } from "@t3tools/shared/commercialEngineModels";
import { buildCommercialAccountUsageSnapshot } from "@t3tools/shared/commercialUsage";
import { createTtlMemoryCache } from "@t3tools/shared/ttlMemoryCache";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Crypto from "node:crypto";

import * as DesktopCommercialAuth from "../../settings/DesktopCommercialAuth.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const GATEWAY_MODEL_LIST_CACHE_TTL_MS = 5 * 60_000;
const COMMERCIAL_ACCOUNT_USAGE_CACHE_TTL_MS = 15_000;
const GATEWAY_CACHE_MAX_ENTRIES = 32;

type GatewayCacheKind = "models" | "usage";

const gatewayResponseCache = createTtlMemoryCache({ maxEntries: GATEWAY_CACHE_MAX_ENTRIES });

function gatewayTokenFingerprint(token: string): string {
  return Crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function gatewayCacheKey(input: {
  readonly kind: GatewayCacheKind;
  readonly baseUrl: string;
  readonly token: string;
}): string {
  return [
    input.kind,
    input.baseUrl.replace(/\/+$/, ""),
    gatewayTokenFingerprint(input.token),
  ].join("\u0000");
}

export const listGatewayModels = makeIpcMethod({
  channel: IpcChannels.LIST_GATEWAY_MODELS_CHANNEL,
  payload: Schema.Void,
  result: GatewayModelListResultSchema,
  handler: Effect.fn("desktop.ipc.gatewayModels.list")(function* () {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const credentials = yield* commercialAuth.getCredentials;

    if (Option.isNone(credentials)) {
      return [];
    }

    const { gatewayBaseUrl, ideJwt } = credentials.value;
    const baseUrl = gatewayBaseUrl || resolveCommercialEngineGatewayBaseUrl();
    const modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`;
    const nowMs = yield* Clock.currentTimeMillis;
    const cacheKey = gatewayCacheKey({ kind: "models", baseUrl, token: ideJwt });
    const cached = gatewayResponseCache.read<Array<{ id: string; name: string; provider: string }>>(
      cacheKey,
      nowMs,
    );
    if (cached) {
      return cached;
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        resilientFetch(modelsUrl, {
          headers: {
            Authorization: `Bearer ${ideJwt}`,
            "Content-Type": "application/json",
          },
          maxRetries: 2,
          timeoutMs: 10_000,
        }),
      catch: (cause) => GatewayModelsNetworkError({ cause }),
    });

    if (!response.ok) {
      return [];
    }

    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) => GatewayModelsNetworkError({ cause }),
    });

    const models = parseModelsResponse(body);
    gatewayResponseCache.write(cacheKey, models, GATEWAY_MODEL_LIST_CACHE_TTL_MS, nowMs);
    return models;
  }),
});

export const getCommercialAccountUsage = makeIpcMethod({
  channel: IpcChannels.GET_COMMERCIAL_ACCOUNT_USAGE_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(CommercialAccountUsageSchema),
  handler: Effect.fn("desktop.ipc.gatewayModels.getCommercialAccountUsage")(function* () {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const credentials = yield* commercialAuth.getCredentials;

    if (Option.isNone(credentials)) {
      return null;
    }

    const { gatewayBaseUrl, ideJwt } = credentials.value;
    const baseUrl = gatewayBaseUrl || resolveCommercialEngineGatewayBaseUrl();
    const nowMs = yield* Clock.currentTimeMillis;
    const cacheKey = gatewayCacheKey({ kind: "usage", baseUrl, token: ideJwt });
    const cached = gatewayResponseCache.read<CommercialAccountUsageSchema>(cacheKey, nowMs);
    if (cached) {
      return cached;
    }

    const accountUsage = yield* requestCommercialAccountUsageSnapshot(baseUrl, ideJwt);

    if (accountUsage === null) {
      return null;
    }

    const snapshot = buildCommercialAccountUsageSnapshot(accountUsage);
    gatewayResponseCache.write(cacheKey, snapshot, COMMERCIAL_ACCOUNT_USAGE_CACHE_TTL_MS, nowMs);
    return snapshot;
  }),
});

export const getLastUsedModel = makeIpcMethod({
  channel: IpcChannels.GET_LAST_USED_MODEL_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.gatewayModels.getLastUsed")(function* () {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const settings = yield* clientSettings.get;
    if (Option.isNone(settings)) return null;
    return settings.value.lastUsedModel ?? null;
  }),
});

export const setLastUsedModel = makeIpcMethod({
  channel: IpcChannels.SET_LAST_USED_MODEL_CHANNEL,
  payload: SetLastUsedModelInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.gatewayModels.setLastUsed")(function* (input) {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const current = yield* clientSettings.get;
    const base = Option.isSome(current) ? current.value : {};
    yield* clientSettings.set({ ...base, lastUsedModel: input.modelId } as never);
  }),
});

interface GatewayModelsNetworkError {
  readonly _tag: "GatewayModelsNetworkError";
  readonly cause: unknown;
}

function GatewayModelsNetworkError(options: { cause: unknown }): GatewayModelsNetworkError {
  return { _tag: "GatewayModelsNetworkError", cause: options.cause };
}

function requestCommercialAccountUsageSnapshot(
  gatewayBaseUrl: string,
  ideJwt: string,
): Effect.Effect<{ account: unknown; usage: unknown } | null, never> {
  return Effect.gen(function* () {
    for (const baseUrl of resolveCommercialEngineIdeApiBaseUrlCandidates(gatewayBaseUrl)) {
      const accountUrl = new URL("/api/v1/auth/me", baseUrl).toString();
      const usageUrl = new URL("/ide/api/usage", baseUrl).toString();
      const result = yield* requestCommercialAccountUsageFromBaseUrl(accountUrl, usageUrl, ideJwt);
      if (result !== null) return result;
    }

    return null;
  });
}

function requestCommercialAccountUsageFromBaseUrl(
  accountUrl: string,
  usageUrl: string,
  ideJwt: string,
): Effect.Effect<{ account: unknown; usage: unknown } | null, never> {
  return Effect.all(
    [requestGatewayJson(accountUrl, ideJwt), requestGatewayJson(usageUrl, ideJwt)],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([account, usage]) => ({ account, usage })),
    Effect.catch(() => Effect.succeed(null)),
  );
}

function requestGatewayJson(
  url: string,
  ideJwt: string,
): Effect.Effect<unknown, GatewayModelsNetworkError> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        resilientFetch(url, {
          headers: {
            Authorization: `Bearer ${ideJwt}`,
            "Content-Type": "application/json",
          },
          maxRetries: 2,
          timeoutMs: 10_000,
        }),
      catch: (cause) => GatewayModelsNetworkError({ cause }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
      return yield* Effect.fail(
        GatewayModelsNetworkError({
          cause: new Error(`Gateway returned ${response.status} ${contentType || "unknown"}.`),
        }),
      );
    }

    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) => GatewayModelsNetworkError({ cause }),
    });
  });
}

function parseModelsResponse(body: unknown): Array<{ id: string; name: string; provider: string }> {
  return [...(parseCommercialGatewayModelListResponse(body) ?? [])];
}
