export type ComposerPluginMentionId = "Browser" | "Chrome" | "Computer";

export interface ComposerPluginMention {
  readonly id: ComposerPluginMentionId;
  readonly token: `@${ComposerPluginMentionId}`;
  readonly label: string;
  readonly menuLabel: string;
  readonly description: string;
  readonly kind: "browser" | "chrome" | "computer";
  readonly iconSvg: string;
}

type BuiltinComposerPluginId = "browser_use" | "browser_use_external" | "computer_use";

interface BuiltinComposerPluginCapability extends ComposerPluginMention {
  readonly builtinPluginId: BuiltinComposerPluginId;
  readonly requiresPairing?: boolean;
}

const BROWSER_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>`;
const COMPUTER_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="12" x="3" y="4" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>`;
const CHROME_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M21.17 8H12"/><path d="M3.95 6.06 8.54 14"/><path d="m10.88 21.94 4.59-7.94"/></svg>`;

const BUILTIN_COMPOSER_PLUGIN_CAPABILITIES: readonly BuiltinComposerPluginCapability[] = [
  {
    builtinPluginId: "browser_use",
    id: "Browser",
    token: "@Browser",
    label: "Browser",
    menuLabel: "浏览器",
    description: "Control the in-app browser with Codex",
    kind: "browser",
    iconSvg: BROWSER_ICON_SVG,
  },
  {
    builtinPluginId: "browser_use_external",
    requiresPairing: true,
    id: "Chrome",
    token: "@Chrome",
    label: "Chrome",
    menuLabel: "Chrome",
    description: "Control Chrome with Codex",
    kind: "chrome",
    iconSvg: CHROME_ICON_SVG,
  },
  {
    builtinPluginId: "computer_use",
    id: "Computer",
    token: "@Computer",
    label: "电脑",
    menuLabel: "电脑",
    description: "Control Windows apps from Codex",
    kind: "computer",
    iconSvg: COMPUTER_ICON_SVG,
  },
];

export const COMPOSER_PLUGIN_MENTIONS: readonly ComposerPluginMention[] =
  BUILTIN_COMPOSER_PLUGIN_CAPABILITIES.map(
    ({ builtinPluginId: _builtinPluginId, requiresPairing: _requiresPairing, ...mention }) =>
      mention,
  );

const MENTIONS_BY_ID = new Map(COMPOSER_PLUGIN_MENTIONS.map((mention) => [mention.id, mention]));
const MENTIONS_BY_LOWER_TOKEN = new Map(
  COMPOSER_PLUGIN_MENTIONS.map((mention) => [mention.id.toLowerCase(), mention]),
);

export function getComposerPluginMention(value: string): ComposerPluginMention | null {
  const normalized = value.startsWith("@") ? value.slice(1) : value;
  return MENTIONS_BY_ID.get(normalized as ComposerPluginMentionId) ?? null;
}

export function getComposerPluginMentionCaseInsensitive(
  value: string,
): ComposerPluginMention | null {
  const normalized = value.startsWith("@") ? value.slice(1) : value;
  return MENTIONS_BY_LOWER_TOKEN.get(normalized.toLowerCase()) ?? null;
}

export function getVisibleComposerPluginMentions(options?: {
  readonly includeChrome?: boolean;
}): readonly ComposerPluginMention[] {
  const capabilities = options?.includeChrome
    ? BUILTIN_COMPOSER_PLUGIN_CAPABILITIES
    : BUILTIN_COMPOSER_PLUGIN_CAPABILITIES.filter((capability) => capability.id !== "Chrome");
  return capabilities.map(
    ({ builtinPluginId: _builtinPluginId, requiresPairing: _requiresPairing, ...mention }) =>
      mention,
  );
}

export function searchComposerPluginMentions(
  query: string,
  options?: { readonly includeChrome?: boolean },
): readonly ComposerPluginMention[] {
  const mentions = getVisibleComposerPluginMentions(options);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return mentions;
  return mentions.filter((mention) =>
    [mention.id, mention.label, mention.menuLabel, mention.description].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function isLikelyDesktopAppMention(value: string): boolean {
  const normalized = value.startsWith("@") ? value.slice(1) : value;
  return /^[A-Z][A-Za-z0-9_-]{1,40}$/.test(normalized) && !normalized.includes(".");
}
