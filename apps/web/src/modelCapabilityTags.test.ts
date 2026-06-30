import { ProviderDriverKind } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { describe, expect, it } from "vitest";

import {
  buildModelCapabilitySearchTokens,
  buildModelCapabilityTags,
  resolveDefaultModelSlugForModels,
} from "./modelCapabilityTags";

describe("model capability tags", () => {
  it("marks provider defaults before falling back to the first built-in model", () => {
    expect(
      resolveDefaultModelSlugForModels(
        [
          { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
          { slug: "gpt-5.4", name: "GPT-5.4" },
        ],
        ProviderDriverKind.make("codex"),
      ),
    ).toBe("gpt-5.4");

    expect(
      resolveDefaultModelSlugForModels(
        [
          { slug: "custom-model", name: "custom-model", isCustom: true },
          { slug: "provider-default", name: "Provider Default" },
        ],
        ProviderDriverKind.make("opencode"),
      ),
    ).toBe("provider-default");
  });

  it("derives visible labels from capabilities and model family names", () => {
    const tags = buildModelCapabilityTags({
      model: {
        slug: "gpt-5.4-mini-vision",
        name: "GPT-5.4 Mini Vision",
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              options: [{ id: "medium", label: "medium" }],
            },
            {
              id: "fastMode",
              label: "Fast mode",
              type: "boolean",
            },
          ],
        }),
      },
      defaultModelSlug: "gpt-5.4-mini-vision",
    });

    expect(tags.map((tag) => tag.label)).toEqual(["默认", "推理", "快速", "省额度", "视觉"]);
    expect(buildModelCapabilitySearchTokens(tags)).toContain("reasoning");
    expect(buildModelCapabilitySearchTokens(tags)).toContain("mini");
  });

  it("marks custom and long-context models", () => {
    expect(
      buildModelCapabilityTags({
        model: {
          slug: "vendor/custom-1m-context",
          name: "Custom 1M Context",
          isCustom: true,
        },
      }).map((tag) => tag.label),
    ).toEqual(["自定义", "长上下文"]);
  });
});
