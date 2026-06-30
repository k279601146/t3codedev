import type { ProviderInstanceId } from "@t3tools/contracts";
import { providerModelKey } from "../../modelOrdering";

export interface ModelPickerSectionItem {
  readonly instanceId: ProviderInstanceId;
  readonly slug: string;
  readonly isCustom?: boolean;
  readonly isDefaultModel?: boolean;
}

export interface ModelPickerSection<T> {
  readonly key: string;
  readonly label: string | null;
  readonly items: ReadonlyArray<T>;
}

function sectionKeyForItem<T extends ModelPickerSectionItem>(
  item: T,
  favoriteModelKeys: ReadonlySet<string>,
  economyRecommendationModelKeys: ReadonlySet<string>,
): string {
  const modelKey = providerModelKey(item.instanceId, item.slug);
  if (favoriteModelKeys.has(modelKey)) return "favorites";
  if (economyRecommendationModelKeys.has(modelKey)) return "economy";
  if (item.isDefaultModel) return "recommended";
  if (item.isCustom) return "custom";
  return "all";
}

function sectionLabel(key: string): string | null {
  if (key === "favorites") return "收藏";
  if (key === "economy") return "省额度推荐";
  if (key === "recommended") return "推荐";
  if (key === "custom") return "自定义";
  if (key === "all") return "全部模型";
  return null;
}

export function buildModelPickerSections<T extends ModelPickerSectionItem>(
  items: ReadonlyArray<T>,
  options: {
    readonly favoriteModelKeys: ReadonlySet<string>;
    readonly economyRecommendationModelKeys?: ReadonlySet<string>;
    readonly showSections: boolean;
  },
): ReadonlyArray<ModelPickerSection<T>> {
  if (!options.showSections) {
    return [{ key: "results", label: null, items }];
  }

  const sections = new Map<string, T[]>();
  const economyRecommendationModelKeys =
    options.economyRecommendationModelKeys ?? new Set<string>();
  for (const item of items) {
    const key = sectionKeyForItem(
      item,
      options.favoriteModelKeys,
      economyRecommendationModelKeys,
    );
    const sectionItems = sections.get(key) ?? [];
    sectionItems.push(item);
    sections.set(key, sectionItems);
  }

  return ["favorites", "economy", "recommended", "all", "custom"]
    .map((key) => {
      const sectionItems = sections.get(key) ?? [];
      return { key, label: sectionLabel(key), items: sectionItems };
    })
    .filter((section) => section.items.length > 0);
}
