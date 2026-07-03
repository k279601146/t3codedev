import * as Schema from "effect/Schema";

export const ProviderPersonality = Schema.Literals(["none", "friendly", "pragmatic"]);
export type ProviderPersonality = typeof ProviderPersonality.Type;
