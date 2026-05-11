import * as Schema from "effect/Schema";

export const LayoutMode = Schema.Literals(["codex", "cursor"]);
export type LayoutMode = typeof LayoutMode.Type;
