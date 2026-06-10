// @effect-diagnostics globalTimers:off globalTimersInEffect:off
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  isT3BrowserToolName,
  T3_BROWSER_TOOL_NAMESPACE,
} from "../browserTools.ts";
import * as BrowserToolService from "../Services/BrowserToolService.ts";

const ENDPOINT_ENV = "T3CODE_BROWSER_USE_ENDPOINT";
const TOKEN_ENV = "T3CODE_BROWSER_USE_TOKEN";
const DEFAULT_TIMEOUT_MS = 30_000;

function textResponse(
  text: string,
  success = true,
): EffectCodexSchema.DynamicToolCallResponse {
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

async function postJson(endpoint: string, token: string, payload: EffectCodexSchema.DynamicToolCallParams) {
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
          : `Browser host returned HTTP ${response.status}`;
      return textResponse(message, false);
    }
    return body as EffectCodexSchema.DynamicToolCallResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export const layer = Layer.effect(
  BrowserToolService.BrowserToolService,
  Effect.sync(() =>
    BrowserToolService.BrowserToolService.of({
      call: async (payload) => {
        if (payload.namespace !== T3_BROWSER_TOOL_NAMESPACE) {
          return textResponse(`Unsupported dynamic tool namespace: ${payload.namespace ?? ""}`, false);
        }
        if (!isT3BrowserToolName(payload.tool)) {
          return textResponse(`Unsupported T3 browser tool: ${payload.tool}`, false);
        }

        const endpoint = process.env[ENDPOINT_ENV];
        const token = process.env[TOKEN_ENV];
        if (!endpoint || !token) {
          return textResponse(
            "T3 browser automation host is unavailable. Start the desktop app with browser_use enabled.",
            false,
          );
        }

        try {
          return await postJson(endpoint, token, payload);
        } catch (error) {
          return textResponse(`Browser tool failed: ${normalizeError(error)}`, false);
        }
      },
    }),
  ),
);
