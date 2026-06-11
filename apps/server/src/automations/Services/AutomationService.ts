import type {
  Automation,
  AutomationArchiveRunInput,
  AutomationDeleteInput,
  AutomationGetInput,
  AutomationGetResult,
  AutomationListInput,
  AutomationListResult,
  AutomationMarkRunReadInput,
  AutomationRunNowInput,
  AutomationServiceError,
  AutomationStreamEvent,
  AutomationUpsertInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

export interface AutomationServiceShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly list: (input: AutomationListInput) => Effect.Effect<AutomationListResult, AutomationServiceError>;
  readonly get: (input: AutomationGetInput) => Effect.Effect<AutomationGetResult, AutomationServiceError>;
  readonly upsert: (input: AutomationUpsertInput) => Effect.Effect<Automation, AutomationServiceError>;
  readonly delete: (input: AutomationDeleteInput) => Effect.Effect<void, AutomationServiceError>;
  readonly runNow: (input: AutomationRunNowInput) => Effect.Effect<AutomationListResult, AutomationServiceError>;
  readonly archiveRun: (
    input: AutomationArchiveRunInput,
  ) => Effect.Effect<AutomationListResult, AutomationServiceError>;
  readonly markRunRead: (
    input: AutomationMarkRunReadInput,
  ) => Effect.Effect<AutomationListResult, AutomationServiceError>;
  readonly stream: Stream.Stream<AutomationStreamEvent, AutomationServiceError>;
}

export class AutomationService extends Context.Service<AutomationService, AutomationServiceShape>()(
  "t3/automations/Services/AutomationService",
) {}
