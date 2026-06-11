import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export const T3_BROWSER_TOOL_NAMESPACE = "t3_browser";
export const T3_BROWSER_EXTERNAL_TOOL_NAMESPACE = "t3_browser_external";

export const T3_BROWSER_TOOL_NAMES = [
  "browser_new_tab",
  "browser_list_tabs",
  "browser_select_tab",
  "browser_close_tab",
  "browser_goto",
  "browser_reload",
  "browser_back",
  "browser_forward",
  "browser_title",
  "browser_url",
  "browser_dom_snapshot",
  "browser_visible_dom",
  "browser_click",
  "browser_fill",
  "browser_type",
  "browser_press",
  "browser_screenshot",
  "browser_console_logs",
  "browser_evaluate_readonly",
  "browser_set_viewport",
  "browser_reset_viewport",
  "browser_set_visibility",
] as const;

export type T3BrowserToolName = (typeof T3_BROWSER_TOOL_NAMES)[number];

export const T3_BROWSER_EXTERNAL_TOOL_NAMES = T3_BROWSER_TOOL_NAMES.filter(
  (tool) =>
    tool !== "browser_set_viewport" &&
    tool !== "browser_reset_viewport" &&
    tool !== "browser_set_visibility",
);

export type T3BrowserExternalToolName = (typeof T3_BROWSER_EXTERNAL_TOOL_NAMES)[number];

const objectSchema = (properties: Record<string, unknown>, required: ReadonlyArray<string> = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const tabIdProperty = {
  type: "string",
  description: "Optional browser tab id. The selected tab is used when omitted.",
};

const timeoutProperty = {
  type: "number",
  description: "Optional timeout in milliseconds.",
};

const selectorProperty = {
  type: "string",
  description: "CSS selector for the target element.",
};

const browserToolSpecs: ReadonlyArray<{
  readonly name: T3BrowserToolName;
  readonly description: string;
  readonly inputSchema: unknown;
}> = [
  {
    name: "browser_new_tab",
    description: "Create a new T3 in-app browser tab and optionally navigate it to a URL.",
    inputSchema: objectSchema({
      url: { type: "string", description: "Optional URL to open in the new tab." },
      visible: { type: "boolean", description: "Whether to show the browser window." },
    }),
  },
  {
    name: "browser_list_tabs",
    description: "List open T3 in-app browser tabs.",
    inputSchema: objectSchema({}),
  },
  {
    name: "browser_select_tab",
    description: "Select an existing T3 in-app browser tab.",
    inputSchema: objectSchema({ tabId: { type: "string" } }, ["tabId"]),
  },
  {
    name: "browser_close_tab",
    description: "Close an existing T3 in-app browser tab.",
    inputSchema: objectSchema({ tabId: { type: "string" } }, ["tabId"]),
  },
  {
    name: "browser_goto",
    description: "Navigate a T3 in-app browser tab to a URL.",
    inputSchema: objectSchema(
      {
        tabId: tabIdProperty,
        url: { type: "string" },
        timeoutMs: timeoutProperty,
      },
      ["url"],
    ),
  },
  {
    name: "browser_reload",
    description: "Reload the current page in a T3 in-app browser tab.",
    inputSchema: objectSchema({ tabId: tabIdProperty, timeoutMs: timeoutProperty }),
  },
  {
    name: "browser_back",
    description: "Navigate a T3 in-app browser tab back.",
    inputSchema: objectSchema({ tabId: tabIdProperty, timeoutMs: timeoutProperty }),
  },
  {
    name: "browser_forward",
    description: "Navigate a T3 in-app browser tab forward.",
    inputSchema: objectSchema({ tabId: tabIdProperty, timeoutMs: timeoutProperty }),
  },
  {
    name: "browser_title",
    description: "Read the current page title from a T3 in-app browser tab.",
    inputSchema: objectSchema({ tabId: tabIdProperty }),
  },
  {
    name: "browser_url",
    description: "Read the current URL from a T3 in-app browser tab.",
    inputSchema: objectSchema({ tabId: tabIdProperty }),
  },
  {
    name: "browser_dom_snapshot",
    description: "Read a compact text snapshot of the current DOM.",
    inputSchema: objectSchema({ tabId: tabIdProperty }),
  },
  {
    name: "browser_visible_dom",
    description: "Read visible interactive elements from the current page.",
    inputSchema: objectSchema({ tabId: tabIdProperty }),
  },
  {
    name: "browser_click",
    description: "Click an element by selector or a viewport coordinate.",
    inputSchema: objectSchema({
      tabId: tabIdProperty,
      selector: selectorProperty,
      x: { type: "number" },
      y: { type: "number" },
      button: { type: "string", enum: ["left", "middle", "right"] },
      timeoutMs: timeoutProperty,
    }),
  },
  {
    name: "browser_fill",
    description: "Replace the value of an input-like element.",
    inputSchema: objectSchema(
      {
        tabId: tabIdProperty,
        selector: selectorProperty,
        value: { type: "string" },
        timeoutMs: timeoutProperty,
      },
      ["selector", "value"],
    ),
  },
  {
    name: "browser_type",
    description: "Type text into the focused element or an element matched by selector.",
    inputSchema: objectSchema(
      {
        tabId: tabIdProperty,
        selector: selectorProperty,
        text: { type: "string" },
        timeoutMs: timeoutProperty,
      },
      ["text"],
    ),
  },
  {
    name: "browser_press",
    description: "Press a keyboard key in the current page.",
    inputSchema: objectSchema(
      {
        tabId: tabIdProperty,
        selector: selectorProperty,
        key: { type: "string", description: "Electron accelerator or DOM key, such as Enter." },
        timeoutMs: timeoutProperty,
      },
      ["key"],
    ),
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of the current page.",
    inputSchema: objectSchema({
      tabId: tabIdProperty,
      fullPage: { type: "boolean" },
    }),
  },
  {
    name: "browser_console_logs",
    description: "Read recent console logs from the current page.",
    inputSchema: objectSchema({
      tabId: tabIdProperty,
      limit: { type: "number" },
    }),
  },
  {
    name: "browser_evaluate_readonly",
    description: "Evaluate read-only JavaScript in the current page and return JSON-serializable data.",
    inputSchema: objectSchema(
      {
        tabId: tabIdProperty,
        expression: { type: "string" },
      },
      ["expression"],
    ),
  },
  {
    name: "browser_set_viewport",
    description: "Set the viewport size for a T3 in-app browser tab.",
    inputSchema: objectSchema(
      {
        tabId: tabIdProperty,
        width: { type: "number" },
        height: { type: "number" },
      },
      ["width", "height"],
    ),
  },
  {
    name: "browser_reset_viewport",
    description: "Reset the viewport size for a T3 in-app browser tab.",
    inputSchema: objectSchema({ tabId: tabIdProperty }),
  },
  {
    name: "browser_set_visibility",
    description: "Show or hide the T3 in-app browser automation window.",
    inputSchema: objectSchema({ visible: { type: "boolean" } }, ["visible"]),
  },
];

export function buildT3BrowserDynamicToolsForNamespace(
  namespace: string,
  toolNames: ReadonlyArray<T3BrowserToolName> = T3_BROWSER_TOOL_NAMES,
): ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec> {
  const selectedNames = new Set<T3BrowserToolName>(toolNames);
  return browserToolSpecs
    .filter((tool) => selectedNames.has(tool.name))
    .map((tool) => ({
      ...tool,
      namespace,
    }));
}

export function buildT3BrowserDynamicTools(): ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec> {
  return buildT3BrowserDynamicToolsForNamespace(T3_BROWSER_TOOL_NAMESPACE);
}

export function buildT3BrowserExternalDynamicTools(): ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec> {
  return buildT3BrowserDynamicToolsForNamespace(
    T3_BROWSER_EXTERNAL_TOOL_NAMESPACE,
    T3_BROWSER_EXTERNAL_TOOL_NAMES,
  ).map((tool) => ({
    ...tool,
    description: tool.description
      .replaceAll("T3 in-app browser", "T3 external Chrome browser")
      .replaceAll("current page", "current Chrome page"),
  }));
}

export function isT3BrowserToolName(value: string): value is T3BrowserToolName {
  return T3_BROWSER_TOOL_NAMES.includes(value as T3BrowserToolName);
}

export function isT3BrowserExternalToolName(value: string): value is T3BrowserExternalToolName {
  return T3_BROWSER_EXTERNAL_TOOL_NAMES.includes(value as T3BrowserExternalToolName);
}

export type T3BrowserDynamicTool = EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec;
