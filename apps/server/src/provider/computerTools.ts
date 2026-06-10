import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export const T3_COMPUTER_TOOL_NAMESPACE = "t3_computer";
export const T3_COMPUTER_CONFIRMATION_REQUIRED_PREFIX = "T3_COMPUTER_CONFIRMATION_REQUIRED:";

export const T3_COMPUTER_TOOL_NAMES = [
  "computer_state",
  "computer_screenshot",
  "computer_move_mouse",
  "computer_click",
  "computer_double_click",
  "computer_drag",
  "computer_scroll",
  "computer_type",
  "computer_press",
  "computer_hotkey",
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
    name: "computer_move_mouse",
    description: "Move the mouse cursor to a desktop coordinate.",
    inputSchema: objectSchema(coordinateProperties, ["x", "y"]),
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
    name: "computer_double_click",
    description: "Double-click at the current cursor position or a desktop coordinate.",
    inputSchema: objectSchema({
      ...coordinateProperties,
      button: { type: "string", enum: ["left", "middle", "right"] },
    }),
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
    name: "computer_scroll",
    description: "Scroll at the current cursor position or a desktop coordinate.",
    inputSchema: objectSchema({
      ...coordinateProperties,
      deltaX: { type: "number" },
      deltaY: { type: "number" },
    }),
  },
  {
    name: "computer_type",
    description: "Type text into the currently focused desktop application.",
    inputSchema: objectSchema({ text: { type: "string" } }, ["text"]),
  },
  {
    name: "computer_press",
    description: "Press one keyboard key in the currently focused desktop application.",
    inputSchema: objectSchema({ key: { type: "string" } }, ["key"]),
  },
  {
    name: "computer_hotkey",
    description: "Press a keyboard shortcut, such as Ctrl+L or Alt+Tab.",
    inputSchema: objectSchema({ keys: { type: "array", items: { type: "string" } } }, ["keys"]),
  },
  {
    name: "computer_wait",
    description: "Wait for a short duration.",
    inputSchema: objectSchema({ durationMs: { type: "number" } }),
  },
];

export function buildT3ComputerDynamicTools(): ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec> {
  return computerToolSpecs.map((tool) => ({
    ...tool,
    namespace: T3_COMPUTER_TOOL_NAMESPACE,
  }));
}

export function isT3ComputerToolName(value: string): value is T3ComputerToolName {
  return T3_COMPUTER_TOOL_NAMES.includes(value as T3ComputerToolName);
}

export function isT3ComputerInputToolName(value: string): value is T3ComputerToolName {
  return (
    value === "computer_click" ||
    value === "computer_double_click" ||
    value === "computer_drag" ||
    value === "computer_scroll" ||
    value === "computer_type" ||
    value === "computer_press" ||
    value === "computer_hotkey"
  );
}

export type T3ComputerDynamicTool = EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec;
