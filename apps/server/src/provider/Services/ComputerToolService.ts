import * as Context from "effect/Context";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export interface ComputerToolServiceShape {
  readonly call: (
    payload: EffectCodexSchema.DynamicToolCallParams,
  ) => Promise<EffectCodexSchema.DynamicToolCallResponse>;
}

export class ComputerToolService extends Context.Service<
  ComputerToolService,
  ComputerToolServiceShape
>()("t3/server/ComputerToolService") {}
