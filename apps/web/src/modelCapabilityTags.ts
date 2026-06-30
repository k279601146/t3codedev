import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelCapabilities,
  type ProviderDriverKind,
} from "@t3tools/contracts";

export type ModelCapabilityTagKind =
  | "custom"
  | "default"
  | "economy"
  | "fast"
  | "longContext"
  | "reasoning"
  | "vision";

export interface ModelCapabilityTag {
  readonly kind: ModelCapabilityTagKind;
  readonly label: string;
}

export interface ModelCapabilityTagModel {
  readonly slug: string;
  readonly name: string;
  readonly isCustom?: boolean;
  readonly capabilities?: ModelCapabilities | null;
}

const REASONING_DESCRIPTOR_IDS = new Set(["reasoningEffort", "effort", "reasoning", "variant"]);
const THINKING_DESCRIPTOR_IDS = new Set(["thinking"]);
const FAST_DESCRIPTOR_IDS = new Set(["fastMode"]);
const ECONOMY_WORDS = ["mini", "haiku", "flash", "nano", "small", "lite", "economy"];
const VISION_WORDS = ["vision", "visual", "image", "multimodal", "vl"];
const LONG_CONTEXT_PATTERNS = [/\b1m\b/u, /\b[2-9]\d{2}k\b/u, /long[-_ ]?context/u];

function normalizeModelText(model: Pick<ModelCapabilityTagModel, "name" | "slug">): string {
  return `${model.slug} ${model.name}`.toLowerCase();
}

function hasAnyWord(value: string, words: ReadonlyArray<string>): boolean {
  return words.some((word) => value.includes(word));
}

function hasAnyPattern(value: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function hasDescriptor(
  capabilities: ModelCapabilities | null | undefined,
  ids: ReadonlySet<string>,
): boolean {
  return Boolean(capabilities?.optionDescriptors?.some((descriptor) => ids.has(descriptor.id)));
}

function pushUnique(tags: ModelCapabilityTag[], tag: ModelCapabilityTag): void {
  if (!tags.some((candidate) => candidate.kind === tag.kind)) {
    tags.push(tag);
  }
}

export function resolveDefaultModelSlugForModels(
  models: ReadonlyArray<ModelCapabilityTagModel>,
  driverKind: ProviderDriverKind,
): string | null {
  const providerDefault = DEFAULT_MODEL_BY_PROVIDER[driverKind];
  if (providerDefault && models.some((model) => model.slug === providerDefault)) {
    return providerDefault;
  }
  return models.find((model) => !model.isCustom)?.slug ?? models[0]?.slug ?? null;
}

export function buildModelCapabilityTags(input: {
  readonly model: ModelCapabilityTagModel;
  readonly defaultModelSlug?: string | null;
}): ReadonlyArray<ModelCapabilityTag> {
  const tags: ModelCapabilityTag[] = [];
  const text = normalizeModelText(input.model);
  const capabilities = input.model.capabilities ?? null;

  if (input.defaultModelSlug && input.model.slug === input.defaultModelSlug) {
    pushUnique(tags, { kind: "default", label: "默认" });
  }
  if (input.model.isCustom) {
    pushUnique(tags, { kind: "custom", label: "自定义" });
  }
  if (
    hasDescriptor(capabilities, REASONING_DESCRIPTOR_IDS) ||
    hasDescriptor(capabilities, THINKING_DESCRIPTOR_IDS)
  ) {
    pushUnique(tags, { kind: "reasoning", label: "推理" });
  }
  if (hasDescriptor(capabilities, FAST_DESCRIPTOR_IDS)) {
    pushUnique(tags, { kind: "fast", label: "快速" });
  }
  if (hasAnyWord(text, ECONOMY_WORDS)) {
    pushUnique(tags, { kind: "economy", label: "省额度" });
  }
  if (hasAnyWord(text, VISION_WORDS)) {
    pushUnique(tags, { kind: "vision", label: "视觉" });
  }
  if (hasAnyPattern(text, LONG_CONTEXT_PATTERNS)) {
    pushUnique(tags, { kind: "longContext", label: "长上下文" });
  }

  return tags;
}

export function buildModelCapabilitySearchTokens(
  tags: ReadonlyArray<ModelCapabilityTag>,
): ReadonlyArray<string> {
  const tokens: string[] = [];
  for (const tag of tags) {
    tokens.push(tag.label);
    if (tag.kind === "economy") {
      tokens.push("mini", "fast", "cheap");
    } else if (tag.kind === "reasoning") {
      tokens.push("thinking", "reasoning");
    } else if (tag.kind === "fast") {
      tokens.push("fast", "speed");
    } else if (tag.kind === "vision") {
      tokens.push("image", "multimodal");
    } else if (tag.kind === "longContext") {
      tokens.push("context", "long");
    }
  }
  return tokens;
}
