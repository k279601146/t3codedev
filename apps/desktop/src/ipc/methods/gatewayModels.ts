import {
  GatewayModelListResultSchema,
  SetLastUsedModelInputSchema,
} from "@t3tools/contracts";
import { resilientFetch } from "@t3tools/shared/Net";
import {
  resolveCommercialEngineGatewayBaseUrl,
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
