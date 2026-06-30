import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { parseCommercialGatewayModelListResponse } from "./commercialEngineModels.ts";

describe("commercialEngineModels", () => {
  it("normalizes OpenAI-compatible gateway model entries", () => {
    assert.deepEqual(
      parseCommercialGatewayModelListResponse({
        data: [
          { id: " gpt-5.4 ", name: "GPT 5.4", owned_by: "openai" },
          { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", provider: "anthropic" },
        ],
      }),
      [
        { id: "gpt-5.4", name: "GPT 5.4", provider: "openai" },
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
      ],
    );
  });

  it("deduplicates ids and falls back to stable display fields", () => {
    assert.deepEqual(
      parseCommercialGatewayModelListResponse({
        data: [
          { id: "gemini-2.5-flash", name: " " },
          { id: "gemini-2.5-flash", name: "Duplicate" },
          { id: "" },
          { name: "missing id" },
          null,
        ],
      }),
      [{ id: "gemini-2.5-flash", name: "gemini-2.5-flash", provider: "unknown" }],
    );
  });

  it("returns null when the gateway shape is not a model list", () => {
    assert.equal(parseCommercialGatewayModelListResponse({ data: {} }), null);
    assert.equal(parseCommercialGatewayModelListResponse(null), null);
  });
});
