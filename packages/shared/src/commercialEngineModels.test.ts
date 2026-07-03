import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { parseCommercialGatewayModelListResponse } from "./commercialEngineModels.ts";

function compatibility(input: {
  readonly hasCodexModelInfoFields?: boolean;
  readonly missingNativeApplyPatchFields?: ReadonlyArray<string>;
  readonly nativeApplyPatchReady?: boolean;
}) {
  return {
    hasCodexModelInfoFields: input.hasCodexModelInfoFields ?? false,
    missingNativeApplyPatchFields: input.missingNativeApplyPatchFields ?? [
      "slug",
      "display_name",
      "shell_type",
      "visibility",
      "supported_in_api",
      "base_instructions",
      "truncation_policy",
      "supports_parallel_tool_calls",
      "apply_patch_tool_type",
    ],
    nativeApplyPatchReady: input.nativeApplyPatchReady ?? false,
  };
}

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
        {
          id: "gpt-5.4",
          name: "GPT 5.4",
          provider: "openai",
          codexCompatibility: compatibility({}),
        },
        {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          provider: "anthropic",
          codexCompatibility: compatibility({
            hasCodexModelInfoFields: true,
            missingNativeApplyPatchFields: [
              "slug",
              "shell_type",
              "visibility",
              "supported_in_api",
              "base_instructions",
              "truncation_policy",
              "supports_parallel_tool_calls",
              "apply_patch_tool_type",
            ],
          }),
        },
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
      [
        {
          id: "gemini-2.5-flash",
          name: "gemini-2.5-flash",
          provider: "unknown",
          codexCompatibility: compatibility({}),
        },
      ],
    );
  });

  it("preserves Codex ModelInfo apply_patch metadata from a models response", () => {
    assert.deepEqual(
      parseCommercialGatewayModelListResponse({
        models: [
          {
            slug: "myservice/gpt-code",
            display_name: "GPT Code",
            provider: "myservice",
            shell_type: "unified_exec",
            visibility: "list",
            supported_in_api: true,
            base_instructions: "You are a coding agent.",
            truncation_policy: { type: "auto" },
            supports_parallel_tool_calls: true,
            apply_patch_tool_type: "freeform",
          },
        ],
      }),
      [
        {
          id: "myservice/gpt-code",
          name: "GPT Code",
          provider: "myservice",
          applyPatchToolType: "freeform",
          codexCompatibility: compatibility({
            hasCodexModelInfoFields: true,
            missingNativeApplyPatchFields: [],
            nativeApplyPatchReady: true,
          }),
        },
      ],
    );
  });

  it("returns null when the gateway shape is not a model list", () => {
    assert.equal(parseCommercialGatewayModelListResponse({ data: {} }), null);
    assert.equal(parseCommercialGatewayModelListResponse(null), null);
  });
});
