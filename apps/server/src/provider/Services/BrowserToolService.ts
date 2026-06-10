import * as Context from "effect/Context";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export interface BrowserToolServiceShape {
  readonly call: (
    payload: EffectCodexSchema.DynamicToolCallParams,
  ) => Promise<EffectCodexSchema.DynamicToolCallResponse>;
}

export class BrowserToolService extends Context.Service<BrowserToolService, BrowserToolServiceShape>()(
  "t3/server/BrowserToolService",
) {}
