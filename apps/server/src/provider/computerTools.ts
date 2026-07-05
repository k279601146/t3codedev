import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export const T3_COMPUTER_TOOL_NAMESPACE = "t3_computer";
export const T3_COMPUTER_CONFIRMATION_REQUIRED_PREFIX = "T3_COMPUTER_CONFIRMATION_REQUIRED:";

export const T3_COMPUTER_TOOL_NAMES = [
  "computer_state",
  "computer_screenshot",
  "computer_list_apps",
  "computer_list_windows",
  "computer_select_window",
  "computer_activate_window",
  "computer_window_screenshot",
  "computer_get_window_state",
  "computer_accessibility_snapshot",
  "computer_focus_app",
  "computer_move_mouse",
  "computer_move_mouse_window",
  "computer_click",
  "computer_click_element",
  "computer_click_window",
  "computer_double_click",
  "computer_double_click_window",
  "computer_drag",
  "computer_drag_window",
  "computer_scroll",
  "computer_scroll_window",
  "computer_type",
  "computer_type_window",
  "computer_press",
  "computer_press_window",
  "computer_hotkey",
  "computer_hotkey_window",
  "computer_set_value",
  "computer_perform_secondary_action",
  "computer_wait",
] as const;

export type T3ComputerToolName = (typeof T3_COMPUTER_TOOL_NAMES)[number];

const objectSchema = (
  properties: Record<string, unknown>,
  required: ReadonlyArray<string> = [],
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const coordinateProperties = {
  x: { type: "number", description: "Desktop virtual-screen X coordinate in physical pixels." },
  y: { type: "number", description: "Desktop virtual-screen Y coordinate in physical pixels." },
};

const windowIdProperty = {
  windowId: {
    type: "string",
    description:
      "Window id returned by computer_list_windows, computer_list_apps, or computer_select_window.",
  },
};

const elementIndexProperty = {
  element_index: {
    type: "number",
    description:
      "Element index from the latest computer_get_window_state or computer_accessibility_snapshot result with includeText=true.",
  },
};

const windowCoordinateProperties = {
  ...windowIdProperty,
  x: { type: "number", description: "Window-relative X coordinate in screenshot pixels." },
  y: { type: "number", description: "Window-relative Y coordinate in screenshot pixels." },
};

const computerToolSpecs: ReadonlyArray<{
  readonly name: T3ComputerToolName;
  readonly description: string;
  readonly inputSchema: unknown;
}> = [
  {
    name: "computer_state",
    description:
      "Read the current desktop automation state, displays, cursor, and foreground window.",
    inputSchema: objectSchema({}),
  },
  {
    name: "computer_screenshot",
    description: "Capture a screenshot of the Windows virtual desktop.",
    inputSchema: objectSchema({}),
  },
  {
    name: "computer_list_apps",
    description:
      "List visible Windows apps and their targetable windows. Use this before choosing a desktop app/window target.",
    inputSchema: objectSchema({ query: { type: "string" } }),
  },
  {
    name: "computer_list_windows",
    description:
      "List visible targetable Windows app windows. Returns window ids, titles, process names, and screen bounds.",
    inputSchema: objectSchema({ query: { type: "string" } }),
  },
  {
    name: "computer_select_window",
    description:
      "Select a target window by id without activating it. Use the returned selectedWindow for later window tools.",
    inputSchema: objectSchema(windowIdProperty, ["windowId"]),
  },
  {
    name: "computer_activate_window",
    description: "Restore and activate a selected target window by id.",
    inputSchema: objectSchema(windowIdProperty, ["windowId"]),
  },
  {
    name: "computer_window_screenshot",
    description:
      "Capture a screenshot of a target window by id. Coordinates in the returned screenshot are window-relative. The response reports the real captureMethod and any fallbackReason.",
    inputSchema: objectSchema(windowIdProperty, ["windowId"]),
  },
  {
    name: "computer_get_window_state",
    description:
      "Capture official-style state for a target window: canonical window, optional screenshot array, and optional UI Automation accessibility tree with element indexes. Use includeText=true before element_index actions.",
    inputSchema: objectSchema({
      ...windowIdProperty,
      includeScreenshot: {
        type: "boolean",
        description: "Whether to include a window screenshot. Defaults to true.",
      },
      includeText: {
        type: "boolean",
        description: "Whether to include accessibility tree text and element indexes. Defaults to false.",
      },
    }, ["windowId"]),
  },
  {
    name: "computer_accessibility_snapshot",
    description:
      "Read a target window's UI Automation accessibility tree and stable element indexes for the latest snapshot without taking a screenshot.",
    inputSchema: objectSchema(windowIdProperty, ["windowId"]),
  },
  {
    name: "computer_focus_app",
    description:
      "Bring a visible Windows app window to the foreground by matching its app name, process name, or window title. Use this before screenshots or input when the prompt mentions @AppName or a target desktop app.",
    inputSchema: objectSchema({ app: { type: "string" } }, ["app"]),
  },
  {
    name: "computer_move_mouse",
    description: "Move the mouse cursor to a desktop coordinate.",
    inputSchema: objectSchema(coordinateProperties, ["x", "y"]),
  },
  {
    name: "computer_move_mouse_window",
    description: "Move the mouse cursor to a coordinate relative to a target window.",
    inputSchema: objectSchema(windowCoordinateProperties, ["windowId", "x", "y"]),
  },
  {
    name: "computer_click",
    description: "Click at the current cursor position or a desktop coordinate.",
    inputSchema: objectSchema({
      ...coordinateProperties,
      button: { type: "string", enum: ["left", "middle", "right"] },
    }),
  },
  {
    name: "computer_click_element",
    description:
      "Click an element by element_index from the latest accessibility snapshot for a target window. Prefer coordinate clicks when screenshot coordinates are clear.",
    inputSchema: objectSchema({
      ...windowIdProperty,
      ...elementIndexProperty,
      button: { type: "string", enum: ["left", "middle", "right"] },
      click_count: { type: "number" },
    }, ["windowId", "element_index"]),
  },
  {
    name: "computer_click_window",
    description: "Click a coordinate relative to a target window.",
    inputSchema: objectSchema({
      ...windowCoordinateProperties,
      button: { type: "string", enum: ["left", "middle", "right"] },
    }, ["windowId", "x", "y"]),
  },
  {
    name: "computer_double_click",
    description: "Double-click at the current cursor position or a desktop coordinate.",
    inputSchema: objectSchema({
      ...coordinateProperties,
      button: { type: "string", enum: ["left", "middle", "right"] },
    }),
  },
  {
    name: "computer_double_click_window",
    description: "Double-click a coordinate relative to a target window.",
    inputSchema: objectSchema({
      ...windowCoordinateProperties,
      button: { type: "string", enum: ["left", "middle", "right"] },
    }, ["windowId", "x", "y"]),
  },
  {
    name: "computer_drag",
    description: "Drag the mouse from one desktop coordinate to another.",
    inputSchema: objectSchema(
      {
        fromX: { type: "number" },
        fromY: { type: "number" },
        toX: { type: "number" },
        toY: { type: "number" },
        durationMs: { type: "number" },
      },
      ["fromX", "fromY", "toX", "toY"],
    ),
  },
  {
    name: "computer_drag_window",
    description: "Drag from one window-relative coordinate to another in a target window.",
    inputSchema: objectSchema(
      {
        ...windowIdProperty,
        fromX: { type: "number" },
        fromY: { type: "number" },
        toX: { type: "number" },
        toY: { type: "number" },
        durationMs: { type: "number" },
      },
      ["windowId", "fromX", "fromY", "toX", "toY"],
    ),
  },
  {
    name: "computer_scroll",
    description: "Scroll at the current cursor position or a desktop coordinate.",
    inputSchema: objectSchema({
      ...coordinateProperties,
      deltaX: { type: "number" },
      deltaY: { type: "number" },
    }),
  },
  {
    name: "computer_scroll_window",
    description: "Scroll from a coordinate relative to a target window.",
    inputSchema: objectSchema({
      ...windowCoordinateProperties,
      deltaX: { type: "number" },
      deltaY: { type: "number" },
    }, ["windowId", "x", "y"]),
  },
  {
    name: "computer_type",
    description: "Type text into the currently focused desktop application.",
    inputSchema: objectSchema({ text: { type: "string" } }, ["text"]),
  },
  {
    name: "computer_type_window",
    description: "Activate a target window and type text into its focused control.",
    inputSchema: objectSchema({ ...windowIdProperty, text: { type: "string" } }, [
      "windowId",
      "text",
    ]),
  },
  {
    name: "computer_press",
    description: "Press one keyboard key in the currently focused desktop application.",
    inputSchema: objectSchema({ key: { type: "string" } }, ["key"]),
  },
  {
    name: "computer_press_window",
    description: "Activate a target window and press one keyboard key.",
    inputSchema: objectSchema({ ...windowIdProperty, key: { type: "string" } }, [
      "windowId",
      "key",
    ]),
  },
  {
    name: "computer_hotkey",
    description: "Press a keyboard shortcut, such as Ctrl+L or Alt+Tab.",
    inputSchema: objectSchema({ keys: { type: "array", items: { type: "string" } } }, ["keys"]),
  },
  {
    name: "computer_hotkey_window",
    description: "Activate a target window and press a keyboard shortcut.",
    inputSchema: objectSchema(
      { ...windowIdProperty, keys: { type: "array", items: { type: "string" } } },
      ["windowId", "keys"],
    ),
  },
  {
    name: "computer_set_value",
    description:
      "Replace the value of an editable element by element_index from the latest accessibility snapshot for a target window.",
    inputSchema: objectSchema(
      {
        ...windowIdProperty,
        ...elementIndexProperty,
        value: { type: "string" },
      },
      ["windowId", "element_index", "value"],
    ),
  },
  {
    name: "computer_perform_secondary_action",
    description:
      "Invoke a supported secondary accessibility action on an indexed element, such as Invoke, Toggle, Select, Expand, Collapse, Raise, Scroll Up, or Scroll Down.",
    inputSchema: objectSchema(
      {
        ...windowIdProperty,
        ...elementIndexProperty,
        action: { type: "string" },
      },
      ["windowId", "element_index", "action"],
    ),
  },
  {
    name: "computer_wait",
    description: "Wait for a short duration.",
    inputSchema: objectSchema({ durationMs: { type: "number" } }),
  },
];

export function buildT3ComputerDynamicTools(): ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec> {
  return [
    {
      type: "namespace",
      name: T3_COMPUTER_TOOL_NAMESPACE,
      description: "T3 Windows desktop automation tools.",
      tools: computerToolSpecs.map((tool) => ({
        ...tool,
        type: "function",
      })),
    },
  ];
}

export function isT3ComputerToolName(value: string): value is T3ComputerToolName {
  return T3_COMPUTER_TOOL_NAMES.includes(value as T3ComputerToolName);
}

export function isT3ComputerInputToolName(value: string): value is T3ComputerToolName {
  return (
    value === "computer_click" ||
    value === "computer_click_element" ||
    value === "computer_click_window" ||
    value === "computer_double_click" ||
    value === "computer_double_click_window" ||
    value === "computer_drag" ||
    value === "computer_drag_window" ||
    value === "computer_scroll" ||
    value === "computer_scroll_window" ||
    value === "computer_type" ||
    value === "computer_type_window" ||
    value === "computer_press" ||
    value === "computer_press_window" ||
    value === "computer_hotkey" ||
    value === "computer_hotkey_window" ||
    value === "computer_set_value" ||
    value === "computer_perform_secondary_action"
  );
}

export type T3ComputerDynamicTool = EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec;
