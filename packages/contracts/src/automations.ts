import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "./orchestration.ts";

export const AutomationId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationId"));
export type AutomationId = typeof AutomationId.Type;

export const AutomationRunId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationRunId"));
export type AutomationRunId = typeof AutomationRunId.Type;

export const AutomationStatus = Schema.Literals(["enabled", "paused"]);
export type AutomationStatus = typeof AutomationStatus.Type;

export const AutomationRunStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const AutomationInboxFilter = Schema.Literals(["unread", "all"]);
export type AutomationInboxFilter = typeof AutomationInboxFilter.Type;

export const AutomationSchedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("interval"),
    minutes: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    weekday: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
    time: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("cron"),
    expression: TrimmedNonEmptyString,
  }),
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

export const AutomationRunMode = Schema.Literals(["worktree", "local"]);
export type AutomationRunMode = typeof AutomationRunMode.Type;

export const AutomationTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project"),
    projectId: ProjectId,
    runMode: AutomationRunMode,
    baseBranch: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("thread"),
    threadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("conversation"),
  }),
]);
export type AutomationTarget = typeof AutomationTarget.Type;

export const Automation = Schema.Struct({
  id: AutomationId,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  status: AutomationStatus,
  schedule: AutomationSchedule,
  target: AutomationTarget,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Automation = typeof Automation.Type;

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  status: AutomationRunStatus,
  trigger: Schema.Literals(["scheduled", "manual"]),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  resultThreadId: Schema.NullOr(ThreadId),
  summary: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(IsoDateTime),
  readAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AutomationRun = typeof AutomationRun.Type;

export const AutomationListInput = Schema.Struct({
  inbox: Schema.optional(AutomationInboxFilter),
});
export type AutomationListInput = typeof AutomationListInput.Type;

export const AutomationListResult = Schema.Struct({
  automations: Schema.Array(Automation),
  runs: Schema.Array(AutomationRun),
});
export type AutomationListResult = typeof AutomationListResult.Type;

export const AutomationGetInput = Schema.Struct({
  id: AutomationId,
});
export type AutomationGetInput = typeof AutomationGetInput.Type;

export const AutomationGetResult = Schema.Struct({
  automation: Automation,
  runs: Schema.Array(AutomationRun),
});
export type AutomationGetResult = typeof AutomationGetResult.Type;

export const AutomationUpsertInput = Schema.Struct({
  id: Schema.optional(AutomationId),
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  status: AutomationStatus,
  schedule: AutomationSchedule,
  target: AutomationTarget,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type AutomationUpsertInput = typeof AutomationUpsertInput.Type;

export const AutomationDeleteInput = Schema.Struct({
  id: AutomationId,
});
export type AutomationDeleteInput = typeof AutomationDeleteInput.Type;

export const AutomationRunNowInput = Schema.Struct({
  id: AutomationId,
});
export type AutomationRunNowInput = typeof AutomationRunNowInput.Type;

export const AutomationArchiveRunInput = Schema.Struct({
  runId: AutomationRunId,
});
export type AutomationArchiveRunInput = typeof AutomationArchiveRunInput.Type;

export const AutomationMarkRunReadInput = Schema.Struct({
  runId: AutomationRunId,
});
export type AutomationMarkRunReadInput = typeof AutomationMarkRunReadInput.Type;

export const AutomationStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: AutomationListResult,
  }),
  Schema.Struct({
    kind: Schema.Literal("changed"),
    revision: NonNegativeInt,
    snapshot: AutomationListResult,
  }),
]);
export type AutomationStreamEvent = typeof AutomationStreamEvent.Type;

export class AutomationServiceError extends Schema.TaggedErrorClass<AutomationServiceError>()(
  "AutomationServiceError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
