// @effect-diagnostics globalTimers:off globalTimersInEffect:off
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

import { isT3ComputerToolName, T3_COMPUTER_TOOL_NAMESPACE } from "../computerTools.ts";
import * as ComputerToolService from "../Services/ComputerToolService.ts";

const ENDPOINT_ENV = "T3CODE_COMPUTER_USE_ENDPOINT";
const TOKEN_ENV = "T3CODE_COMPUTER_USE_TOKEN";
const DEFAULT_TIMEOUT_MS = 30_000;

function textResponse(text: string, success = true): EffectCodexSchema.DynamicToolCallResponse {
  return {
    success,
    contentItems: [
      {
        type: "inputText",
        text,
      },
    ],
  };
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function postJson(
  endpoint: string,
  token: string,
  payload: EffectCodexSchema.DynamicToolCallParams,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/tool-call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `Computer host returned HTTP ${response.status}`;
      return textResponse(message, false);
    }
    return body as EffectCodexSchema.DynamicToolCallResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export const layer = Layer.effect(
  ComputerToolService.ComputerToolService,
  Effect.sync(() =>
    ComputerToolService.ComputerToolService.of({
      call: async (payload) => {
        if (payload.namespace !== T3_COMPUTER_TOOL_NAMESPACE) {
          return textResponse(
            `Unsupported dynamic tool namespace: ${payload.namespace ?? ""}`,
            false,
          );
        }
        if (!isT3ComputerToolName(payload.tool)) {
          return textResponse(`Unsupported T3 computer tool: ${payload.tool}`, false);
        }

        const endpoint = process.env[ENDPOINT_ENV];
        const token = process.env[TOKEN_ENV];
        if (!endpoint || !token) {
          return textResponse(
            "T3 computer automation host is unavailable. Start the desktop app with computer_use enabled.",
            false,
          );
        }

        try {
          return await postJson(endpoint, token, payload);
        } catch (error) {
          return textResponse(`Computer tool failed: ${normalizeError(error)}`, false);
        }
      },
    }),
  ),
);
