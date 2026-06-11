import * as Context from "effect/Context";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export interface BrowserExternalToolServiceShape {
  readonly call: (
    payload: EffectCodexSchema.DynamicToolCallParams,
  ) => Promise<EffectCodexSchema.DynamicToolCallResponse>;
}

export class BrowserExternalToolService extends Context.Service<
  BrowserExternalToolService,
  BrowserExternalToolServiceShape
>()("t3/server/BrowserExternalToolService") {}
