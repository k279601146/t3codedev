import {
  getComposerPluginMentionCaseInsensitive,
  isLikelyDesktopAppMention,
} from "./composerPluginMentions";

const LAUNCH_MENTION_REGEX = /(^|\s)@([^\s@]+)(?=\s|$)/g;
const PLUGIN_LAUNCH_CONTEXT_START = "<plugin_launch_context>";
const PLUGIN_LAUNCH_CONTEXT_END = "</plugin_launch_context>";
const TRAILING_PLUGIN_LAUNCH_CONTEXT_PATTERN =
  /\n{0,2}<plugin_launch_context>\n[\s\S]*?\n<\/plugin_launch_context>\s*$/;

function uniqueValues(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export function buildComposerPluginLaunchContext(prompt: string): string | null {
  const pluginMentions: string[] = [];
  const desktopAppMentions: string[] = [];

  for (const match of prompt.matchAll(LAUNCH_MENTION_REGEX)) {
    const mention = match[2] ?? "";
    if (!mention) continue;
    const plugin = getComposerPluginMentionCaseInsensitive(mention);
    if (plugin) {
      pluginMentions.push(plugin.id);
      continue;
    }
    if (isLikelyDesktopAppMention(mention)) {
      desktopAppMentions.push(mention);
    }
  }

  const plugins = uniqueValues(pluginMentions);
  const apps = uniqueValues(desktopAppMentions);
  if (plugins.length === 0 && apps.length === 0) {
    return null;
  }

  const lines = [PLUGIN_LAUNCH_CONTEXT_START];
  if (plugins.includes("Browser")) {
    lines.push("- @Browser: use the T3 in-app browser tools for web navigation and page checks.");
  }
  if (plugins.includes("Computer")) {
    lines.push(
      "- @Computer: use T3 computer_use; prefer computer_list_windows, computer_select_window, then computer_get_window_state. Use includeText=true when element_index targeting is useful, then use window-scoped input tools or computer_click_element/computer_set_value.",
    );
  }
  if (plugins.includes("Chrome")) {
    lines.push(
      "- @Chrome: use computer_list_windows with query \"Chrome\", select the matching Chrome window, then computer_get_window_state. Prefer browser_use for normal webpage automation; use computer_use only for Chrome app UI or extension UI.",
    );
  }
  for (const appName of apps) {
    lines.push(
      `- @${appName}: treat this as a desktop app target; use computer_list_windows with query "${appName}", select the matching window, then computer_get_window_state. Use includeText=true before element_index actions.`,
    );
  }
  lines.push(PLUGIN_LAUNCH_CONTEXT_END);
  return lines.join("\n");
}

export function appendComposerPluginLaunchContext(prompt: string): string {
  const context = buildComposerPluginLaunchContext(prompt);
  return context ? `${prompt.trimEnd()}\n\n${context}` : prompt;
}

export function stripTrailingComposerPluginLaunchContext(prompt: string): string {
  const match = TRAILING_PLUGIN_LAUNCH_CONTEXT_PATTERN.exec(prompt);
  if (!match) {
    return prompt;
  }
  return prompt.slice(0, match.index).replace(/\n+$/, "");
}
