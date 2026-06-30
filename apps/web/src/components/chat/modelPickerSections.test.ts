import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { providerModelKey } from "../../modelOrdering";
import { buildModelPickerSections } from "./modelPickerSections";

const INSTANCE_ID = ProviderInstanceId.make("codex");

describe("model picker sections", () => {
  it("groups favorites, defaults, normal models and custom models in scan order", () => {
    const sections = buildModelPickerSections(
      [
        { instanceId: INSTANCE_ID, slug: "gpt-5.4-mini" },
        { instanceId: INSTANCE_ID, slug: "gpt-5.4", isDefaultModel: true },
        { instanceId: INSTANCE_ID, slug: "local-model", isCustom: true },
        { instanceId: INSTANCE_ID, slug: "gpt-5.3-codex" },
      ],
      {
        favoriteModelKeys: new Set([providerModelKey(INSTANCE_ID, "gpt-5.4-mini")]),
        showSections: true,
      },
    );

    expect(
      sections.map((section) => [section.label, section.items.map((item) => item.slug)]),
    ).toEqual([
      ["收藏", ["gpt-5.4-mini"]],
      ["推荐", ["gpt-5.4"]],
      ["全部模型", ["gpt-5.3-codex"]],
      ["自定义", ["local-model"]],
    ]);
  });

  it("places economy recommendations before defaults without duplicating favorites", () => {
    const sections = buildModelPickerSections(
      [
        { instanceId: INSTANCE_ID, slug: "gpt-5.4-mini" },
        { instanceId: INSTANCE_ID, slug: "claude-haiku-4-5" },
        { instanceId: INSTANCE_ID, slug: "gpt-5.4", isDefaultModel: true },
        { instanceId: INSTANCE_ID, slug: "gpt-5.3-codex" },
      ],
      {
        favoriteModelKeys: new Set([providerModelKey(INSTANCE_ID, "gpt-5.4-mini")]),
        economyRecommendationModelKeys: new Set([
          providerModelKey(INSTANCE_ID, "gpt-5.4-mini"),
          providerModelKey(INSTANCE_ID, "claude-haiku-4-5"),
        ]),
        showSections: true,
      },
    );

    expect(
      sections.map((section) => [section.label, section.items.map((item) => item.slug)]),
    ).toEqual([
      ["收藏", ["gpt-5.4-mini"]],
      ["省额度推荐", ["claude-haiku-4-5"]],
      ["推荐", ["gpt-5.4"]],
      ["全部模型", ["gpt-5.3-codex"]],
    ]);
  });

  it("returns one unlabeled section when grouping is disabled", () => {
    const sections = buildModelPickerSections([{ instanceId: INSTANCE_ID, slug: "gpt-5.4" }], {
      favoriteModelKeys: new Set(),
      showSections: false,
    });

    expect(sections).toEqual([
      {
        key: "results",
        label: null,
        items: [{ instanceId: INSTANCE_ID, slug: "gpt-5.4" }],
      },
    ]);
  });
});
