import type { ToolLifecycleItemType } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCommandValue(value: unknown): string | undefined {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function stripTrailingExitCode(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code \d+>)\s*$/iu.exec(trimmed);
  const output = match?.groups?.output?.trim() ?? trimmed;
  return output.length > 0 ? output : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const backtickMatch = /`([^`]+)`/u.exec(title);
  return backtickMatch?.[1]?.trim() || undefined;
}

function extractToolCommand(data: Record<string, unknown> | undefined, title: string | undefined) {
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  const itemResult = asRecord(item?.result);
  const rawInput = asRecord(data?.rawInput);
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
    normalizeCommandValue(rawInput?.command),
  ];
  const direct = candidates.find((candidate) => candidate !== undefined);
  if (direct) {
    return direct;
  }
  const executable = asTrimmedString(rawInput?.executable);
  const args = normalizeCommandValue(rawInput?.args);
  if (executable && args) {
    return `${executable} ${args}`;
  }
  if (executable) {
    return executable;
  }
  return extractCommandFromTitle(title);
}

function maybePathLike(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    /\.(?:[a-z0-9]{1,12})$/iu.test(value)
  ) {
    return value;
  }
  return undefined;
}

function collectPaths(value: unknown, paths: string[], seen: Set<string>, depth: number): void {
  if (depth > 4 || paths.length >= 8) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, paths, seen, depth + 1);
      if (paths.length >= 8) {
        return;
      }
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of ["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]) {
    const candidate = maybePathLike(asTrimmedString(record[key]));
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
    if (paths.length >= 8) {
      return;
    }
  }
  for (const nestedKey of ["locations", "item", "input", "result", "rawInput", "data", "changes"]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectPaths(record[nestedKey], paths, seen, depth + 1);
    if (paths.length >= 8) {
      return;
    }
  }
}

function extractPrimaryPath(data: Record<string, unknown> | undefined): string | undefined {
  const paths: string[] = [];
  collectPaths(data, paths, new Set<string>(), 0);
  return paths[0];
}

function normalizeEquivalentValue(value: string | undefined): string | undefined {
  const trimmed = asTrimmedString(value);
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/\s+/gu, " ")
    .replace(/\s+(?:complete|completed|started)\s*$/iu, "")
    .trim();
}

function isEquivalent(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeEquivalentValue(left)?.toLowerCase();
  const normalizedRight = normalizeEquivalentValue(right)?.toLowerCase();
  return normalizedLeft !== undefined && normalizedLeft === normalizedRight;
}

function classifyToolAction(input: {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}): "command" | "read" | "file_change" | "search" | "other" {
  const itemType = input.itemType ?? undefined;
  const kind = asTrimmedString(input.data?.kind)?.toLowerCase();
  const title = asTrimmedString(input.title)?.toLowerCase();
  if (itemType === "command_execution" || kind === "execute" || title === "terminal") {
    return "command";
  }
  if (kind === "read" || title === "read file") {
    return "read";
  }
  if (
    itemType === "file_change" ||
    kind === "edit" ||
    kind === "move" ||
    kind === "delete" ||
    kind === "write"
  ) {
    return "file_change";
  }
  if (itemType === "web_search" || kind === "search" || title === "find" || title === "grep") {
    return "search";
  }
  return "other";
}

export interface ToolActivityPresentationInput {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | null | undefined;
  readonly detail?: string | null | undefined;
  readonly data?: unknown;
  readonly fallbackSummary?: string | null | undefined;
}

export interface ToolActivityPresentation {
  readonly summary: string;
  readonly detail?: string | undefined;
}

export type DynamicToolFamily = "browser" | "external_browser" | "computer" | "other";

export interface DynamicToolActivityInput {
  readonly tool?: unknown;
  readonly namespace?: unknown;
  readonly arguments?: unknown;
  readonly contentItems?: unknown;
  readonly success?: unknown;
  readonly status?: unknown;
}

export interface DynamicToolActivityPresentation {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly family: DynamicToolFamily;
  readonly toolName?: string | undefined;
  readonly namespace?: string | undefined;
  readonly argumentsPreview?: string | undefined;
  readonly outputPreview?: string | undefined;
}

const DYNAMIC_TOOL_ACTION_LABELS: Readonly<Record<string, string>> = {
  browser_new_tab: "打开标签页",
  browser_list_tabs: "列出标签页",
  browser_select_tab: "选择标签页",
  browser_close_tab: "关闭标签页",
  browser_goto: "打开页面",
  browser_reload: "刷新页面",
  browser_back: "后退",
  browser_forward: "前进",
  browser_title: "读取标题",
  browser_url: "读取地址",
  browser_dom_snapshot: "读取页面快照",
  browser_visible_dom: "读取可见元素",
  browser_click: "点击元素",
  browser_fill: "填写输入框",
  browser_type: "输入文本",
  browser_press: "按键",
  browser_screenshot: "截图",
  browser_console_logs: "读取控制台",
  browser_evaluate_readonly: "执行只读脚本",
  browser_set_viewport: "设置视口",
  browser_reset_viewport: "重置视口",
  browser_set_visibility: "切换可见性",
  computer_state: "读取状态",
  computer_screenshot: "截图",
  computer_list_apps: "列出应用",
  computer_list_windows: "列出窗口",
  computer_select_window: "选择窗口",
  computer_activate_window: "激活窗口",
  computer_window_screenshot: "窗口截图",
  computer_get_window_state: "读取窗口状态",
  computer_accessibility_snapshot: "读取可访问性树",
  computer_focus_app: "聚焦应用",
  computer_move_mouse: "移动鼠标",
  computer_move_mouse_window: "窗口内移动鼠标",
  computer_click: "点击",
  computer_click_element: "点击元素",
  computer_click_window: "窗口内点击",
  computer_double_click: "双击",
  computer_double_click_window: "窗口内双击",
  computer_drag: "拖拽",
  computer_drag_window: "窗口内拖拽",
  computer_scroll: "滚动",
  computer_scroll_window: "窗口内滚动",
  computer_type: "输入文本",
  computer_type_window: "窗口内输入文本",
  computer_press: "按键",
  computer_press_window: "窗口内按键",
  computer_hotkey: "快捷键",
  computer_hotkey_window: "窗口内快捷键",
  computer_set_value: "设置控件值",
  computer_perform_secondary_action: "执行辅助操作",
  computer_wait: "等待",
};

function dynamicToolFamily(
  namespace: string | undefined,
  toolName: string | undefined,
): DynamicToolFamily {
  if (namespace === "t3_browser") {
    return "browser";
  }
  if (namespace === "t3_browser_external") {
    return "external_browser";
  }
  if (namespace === "t3_computer") {
    return "computer";
  }
  if (toolName?.startsWith("browser_")) {
    return "browser";
  }
  if (toolName?.startsWith("computer_")) {
    return "computer";
  }
  return "other";
}

function dynamicToolFamilyLabel(family: DynamicToolFamily): string {
  switch (family) {
    case "browser":
      return "浏览器";
    case "external_browser":
      return "外部浏览器";
    case "computer":
      return "电脑控制";
    default:
      return "工具";
  }
}

function fallbackDynamicToolAction(toolName: string | undefined): string {
  if (!toolName) {
    return "调用";
  }
  return toolName
    .replace(/^(?:browser|computer)_/u, "")
    .split("_")
    .filter((part) => part.length > 0)
    .join(" ");
}

function stringifyPreview(value: unknown, maxLength = 280): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value, null, 2);
          } catch {
            return String(value);
          }
        })();
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength).trimEnd()}...` : trimmed;
}

function summarizeDynamicToolArguments(value: unknown): string | undefined {
  const args = asRecord(value);
  if (!args) {
    return stringifyPreview(value);
  }
  const preferredKeys = [
    "url",
    "selector",
    "text",
    "value",
    "key",
    "keys",
    "app",
    "windowId",
    "element_index",
    "x",
    "y",
    "query",
    "expression",
  ];
  const parts: string[] = [];
  for (const key of preferredKeys) {
    if (!(key in args)) {
      continue;
    }
    const preview = stringifyPreview(args[key], 80);
    if (!preview) {
      continue;
    }
    parts.push(`${key}: ${preview.replace(/\s+/gu, " ")}`);
    if (parts.length >= 4) {
      break;
    }
  }
  return parts.length > 0 ? parts.join(", ") : stringifyPreview(args);
}

function summarizeDynamicToolContentItems(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const textItems = value
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) {
        return undefined;
      }
      if (item.type === "inputText") {
        return asTrimmedString(item.text);
      }
      if (item.type === "inputImage") {
        return "已返回图片";
      }
      return undefined;
    })
    .filter((entry): entry is string => entry !== undefined);
  if (textItems.length === 0) {
    return undefined;
  }
  return stringifyPreview(textItems.join("\n"), 600);
}

export function deriveDynamicToolActivityPresentation(
  input: DynamicToolActivityInput,
): DynamicToolActivityPresentation | undefined {
  const toolName = asTrimmedString(input.tool);
  const namespace = asTrimmedString(input.namespace);
  if (!toolName && !namespace) {
    return undefined;
  }

  const family = dynamicToolFamily(namespace, toolName);
  const action =
    (toolName ? DYNAMIC_TOOL_ACTION_LABELS[toolName] : undefined) ??
    fallbackDynamicToolAction(toolName);
  const familyLabel = dynamicToolFamilyLabel(family);
  const title = family === "other" ? action : `${familyLabel}${action}`;
  const argumentsPreview = summarizeDynamicToolArguments(input.arguments);
  const outputPreview = summarizeDynamicToolContentItems(input.contentItems);
  const detailParts = [
    argumentsPreview ? `参数: ${argumentsPreview}` : undefined,
    outputPreview ? `输出: ${outputPreview}` : undefined,
  ].filter((part): part is string => part !== undefined);

  return {
    title,
    family,
    ...(toolName ? { toolName } : {}),
    ...(namespace ? { namespace } : {}),
    ...(argumentsPreview ? { argumentsPreview } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    ...(detailParts.length > 0 ? { detail: detailParts.join("\n") } : {}),
  };
}

export function deriveToolActivityPresentation(
  input: ToolActivityPresentationInput,
): ToolActivityPresentation {
  const title = asTrimmedString(input.title);
  const detail = stripTrailingExitCode(asTrimmedString(input.detail));
  const fallbackSummary = asTrimmedString(input.fallbackSummary) ?? "Tool";
  const data = asRecord(input.data);
  const command = extractToolCommand(data, title);
  const primaryPath = extractPrimaryPath(data);
  const action = classifyToolAction({
    itemType: input.itemType,
    title,
    data,
  });

  if (action === "command") {
    return {
      summary: "Ran command",
      ...(command ? { detail: command } : {}),
    };
  }

  if (action === "read") {
    if (primaryPath) {
      return {
        summary: "Read file",
        detail: primaryPath,
      };
    }
    return {
      summary: "Read file",
    };
  }

  if (action === "file_change") {
    return {
      summary: "Changed files",
      ...(primaryPath ? { detail: primaryPath } : {}),
    };
  }

  if (action === "search") {
    const query =
      asTrimmedString(asRecord(data?.rawInput)?.query) ??
      asTrimmedString(asRecord(data?.rawInput)?.pattern) ??
      asTrimmedString(asRecord(data?.rawInput)?.searchTerm);
    return {
      summary: "Searched files",
      ...(query ? { detail: query } : {}),
    };
  }

  if (detail && !isEquivalent(detail, title) && !isEquivalent(detail, fallbackSummary)) {
    return {
      summary: title ?? fallbackSummary,
      detail,
    };
  }

  return {
    summary: title ?? fallbackSummary,
  };
}
