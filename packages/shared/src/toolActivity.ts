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
  readonly family?: DynamicToolFamily | undefined;
  readonly toolName?: string | undefined;
  readonly argumentsPreview?: string | undefined;
  readonly outputPreview?: string | undefined;
}

export type DynamicToolFamily =
  | "browser"
  | "external_browser"
  | "computer"
  | "command"
  | "file"
  | "search"
  | "mcp"
  | "other";

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
    case "command":
      return "命令";
    case "file":
      return "文件";
    case "search":
      return "搜索";
    case "mcp":
      return "MCP";
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

function summarizeStructuredArguments(value: unknown): string | undefined {
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
    "pattern",
    "path",
    "filePath",
    "relativePath",
    "filename",
    "expression",
    "command",
    "args",
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

function summarizeDynamicToolArguments(value: unknown): string | undefined {
  return summarizeStructuredArguments(value);
}

function summarizeTextOutput(value: string): string | undefined {
  const cleaned = stripTrailingExitCode(value) ?? value;
  const lines = cleaned
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return stringifyPreview(lines.slice(0, 3).join("\n"), 600);
}

function summarizeContentArray(value: readonly unknown[]): string | undefined {
  const textItems = value
    .map((entry) => {
      const text = asTrimmedString(entry);
      if (text) {
        return text;
      }
      const record = asRecord(entry);
      if (!record) {
        return undefined;
      }
      return asTrimmedString(record.text) ?? asTrimmedString(record.content);
    })
    .filter((entry): entry is string => entry !== undefined);
  return textItems.length > 0 ? summarizeTextOutput(textItems.join("\n")) : undefined;
}

function summarizeRawOutput(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return stringifyPreview(value, 600);
  }
  const totalFiles = typeof record.totalFiles === "number" ? record.totalFiles : undefined;
  if (totalFiles !== undefined && Number.isFinite(totalFiles)) {
    const suffix = record.truncated === true ? "+" : "";
    return `${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }
  if (Array.isArray(record.content)) {
    const contentSummary = summarizeContentArray(record.content);
    if (contentSummary) {
      return contentSummary;
    }
  }
  for (const key of [
    "content",
    "stdout",
    "stderr",
    "text",
    "message",
    "result",
    "aggregatedOutput",
  ]) {
    const text = asTrimmedString(record[key]);
    if (text) {
      return summarizeTextOutput(text);
    }
  }
  if (record.structuredContent !== undefined) {
    return stringifyPreview(record.structuredContent, 600);
  }
  return stringifyPreview(record, 600);
}

function detailFromPreviews(input: {
  readonly argumentsPreview?: string | undefined;
  readonly outputPreview?: string | undefined;
}): string | undefined {
  const detailParts = [
    input.argumentsPreview ? `参数: ${input.argumentsPreview}` : undefined,
    input.outputPreview ? `输出: ${input.outputPreview}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return detailParts.length > 0 ? detailParts.join("\n") : undefined;
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
  const detail = detailFromPreviews({ argumentsPreview, outputPreview });

  return {
    title,
    family,
    ...(toolName ? { toolName } : {}),
    ...(namespace ? { namespace } : {}),
    ...(argumentsPreview ? { argumentsPreview } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    ...(detail ? { detail } : {}),
  };
}

function isGenericToolTitle(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "tool" ||
    normalized === "tool call" ||
    normalized === "mcp tool call" ||
    normalized === "dynamic tool call"
  );
}

function extractToolName(data: Record<string, unknown> | undefined): string | undefined {
  const item = asRecord(data?.item);
  const rawInput = asRecord(data?.rawInput);
  const candidates = [
    data?.tool,
    data?.name,
    data?.kind,
    item?.tool,
    item?.name,
    item?.type,
    rawInput?.tool,
    rawInput?.name,
  ];
  return candidates.map((candidate) => asTrimmedString(candidate)).find(Boolean);
}

function titleFromToolName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function genericMcpTitle(title: string | undefined, fallbackSummary: string): string {
  if (!isGenericToolTitle(title)) {
    return title ?? fallbackSummary;
  }
  return fallbackSummary === "Tool" ? "MCP 工具调用" : fallbackSummary;
}

function extractSearchDetail(data: Record<string, unknown> | undefined): string | undefined {
  const rawInput = asRecord(data?.rawInput);
  const item = asRecord(data?.item);
  const action = asRecord(item?.action) ?? asRecord(data?.action) ?? asRecord(rawInput?.action);
  const query =
    asTrimmedString(rawInput?.query) ??
    asTrimmedString(rawInput?.pattern) ??
    asTrimmedString(rawInput?.searchTerm) ??
    asTrimmedString(item?.query) ??
    asTrimmedString(action?.query);
  if (query) {
    return query;
  }

  const url =
    asTrimmedString(rawInput?.url) ?? asTrimmedString(item?.url) ?? asTrimmedString(action?.url);
  const pattern = asTrimmedString(action?.pattern);
  if (url && pattern) {
    return `${pattern} ${url}`;
  }
  return url ?? pattern;
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
  const item = asRecord(data?.item);
  const inputValue = data?.rawInput ?? item?.arguments;
  const outputValue =
    data?.rawOutput ?? item?.result ?? (input.itemType === "command_execution" ? item : undefined);
  const argumentsPreview = summarizeStructuredArguments(inputValue);
  const outputPreview = summarizeRawOutput(outputValue);
  const action = classifyToolAction({
    itemType: input.itemType,
    title,
    data,
  });

  if (action === "command") {
    return {
      summary: "Ran command",
      family: "command",
      ...(command ? { detail: command } : {}),
      ...(outputPreview ? { outputPreview } : {}),
    };
  }

  if (action === "read") {
    if (primaryPath) {
      return {
        summary: "Read file",
        family: "file",
        detail: primaryPath,
      };
    }
    return {
      summary: "Read file",
      family: "file",
    };
  }

  if (action === "file_change") {
    return {
      summary: "Changed files",
      family: "file",
      ...(primaryPath ? { detail: primaryPath } : {}),
    };
  }

  if (action === "search") {
    const query = extractSearchDetail(data);
    const summary = input.itemType === "web_search" ? "Searched web" : "Searched files";
    return {
      summary,
      family: "search",
      ...(query ? { detail: query } : {}),
    };
  }

  const previewDetail = detailFromPreviews({ argumentsPreview, outputPreview });
  const toolName = extractToolName(data);
  const readableToolName = titleFromToolName(toolName);

  if (input.itemType === "mcp_tool_call") {
    return {
      summary: readableToolName
        ? `MCP ${readableToolName}`
        : genericMcpTitle(title, fallbackSummary),
      family: "mcp",
      ...(toolName ? { toolName } : {}),
      ...(argumentsPreview ? { argumentsPreview } : {}),
      ...(outputPreview ? { outputPreview } : {}),
      ...(previewDetail ? { detail: previewDetail } : {}),
    };
  }

  if (input.itemType === "dynamic_tool_call" || input.itemType === "collab_agent_tool_call") {
    return {
      summary: isGenericToolTitle(title)
        ? (readableToolName ?? "工具调用")
        : (title ?? fallbackSummary),
      family: "other",
      ...(toolName ? { toolName } : {}),
      ...(argumentsPreview ? { argumentsPreview } : {}),
      ...(outputPreview ? { outputPreview } : {}),
      ...(previewDetail ? { detail: previewDetail } : {}),
    };
  }

  if (detail && !isEquivalent(detail, title) && !isEquivalent(detail, fallbackSummary)) {
    return {
      summary: title ?? fallbackSummary,
      family: "other",
      detail,
    };
  }

  return {
    summary: title ?? fallbackSummary,
    family: "other",
  };
}
