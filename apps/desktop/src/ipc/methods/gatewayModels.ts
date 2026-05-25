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
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopCommercialAuth from "../../settings/DesktopCommercialAuth.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

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

    return parseModelsResponse(body);
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
    const accountUsage = yield* requestCommercialAccountUsageSnapshot(
      gatewayBaseUrl || resolveCommercialEngineGatewayBaseUrl(),
      ideJwt,
    );

    if (accountUsage === null) {
      return null;
    }

    const { account, usage } = accountUsage;

    return {
      balance:
        readNumber(account, ["data", "user", "balance"]) ??
        readNumber(account, ["data", "balance"]),
      totalTokens: readNumber(usage, ["data", "total_tokens"]) ?? 0,
      todayTokens: readNumber(usage, ["data", "today_tokens"]),
      totalActualCost: readNumber(usage, ["data", "total_actual_cost"]),
      todayActualCost: readNumber(usage, ["data", "today_actual_cost"]),
    };
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

function readNumber(value: unknown, path: readonly string[]): number | null {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

interface RawModelEntry {
  id?: string;
  name?: string;
  owned_by?: string;
}

function parseModelsResponse(body: unknown): Array<{ id: string; name: string; provider: string }> {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const results: Array<{ id: string; name: string; provider: string }> = [];
  for (const entry of data as RawModelEntry[]) {
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;
    results.push({
      id: entry.id,
      name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
      provider: typeof entry.owned_by === "string" ? entry.owned_by : "unknown",
    });
  }
  return results;
}
