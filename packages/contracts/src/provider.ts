import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ApprovalRequestId,
  EventId,
  IsoDateTime,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "./baseSchemas.ts";
import {
  ChatAttachment,
  ModelSelection,
  ORCHESTRATION_GOAL_OBJECTIVE_MAX_CHARS,
  OrchestrationGoal,
  OrchestrationGoalStatus,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderApprovalPolicy,
  ProviderInteractionMode,
  ProviderRequestKind,
  ProviderSandboxMode,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "./orchestration.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./providerInstance.ts";

const ProviderSessionStatus = Schema.Literals([
  "connecting",
  "ready",
  "running",
  "error",
  "closed",
]);

export const ProviderSession = Schema.Struct({
  provider: ProviderDriverKind,
  // Optional during the driver/instance migration. Once every producer
  // populates it (post-slice-4), routing flips to instance-id-only and the
  // legacy `provider` field is removed.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  status: ProviderSessionStatus,
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSession = typeof ProviderSession.Type;

export const ProviderSessionStartInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.optional(ProviderDriverKind),
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  resumeCursor: Schema.optional(Schema.Unknown),
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  runtimeMode: RuntimeMode,
});
export type ProviderSessionStartInput = typeof ProviderSessionStartInput.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderReasoningSummary = Schema.Literals(["auto", "concise", "detailed", "none"]);
export type ProviderReasoningSummary = typeof ProviderReasoningSummary.Type;

export const ProviderPersonality = Schema.Literals(["none", "friendly", "pragmatic"]);
export type ProviderPersonality = typeof ProviderPersonality.Type;

export const ProviderSandboxPolicy = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("dangerFullAccess"),
  }),
  Schema.Struct({
    type: Schema.Literal("readOnly"),
    networkAccess: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("workspaceWrite"),
    networkAccess: Schema.optionalKey(Schema.Boolean),
    writableRoots: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
    excludeSlashTmp: Schema.optionalKey(Schema.Boolean),
    excludeTmpdirEnvVar: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("externalSandbox"),
    networkAccess: Schema.optionalKey(Schema.Literals(["restricted", "enabled"])),
  }),
]);
export type ProviderSandboxPolicy = typeof ProviderSandboxPolicy.Type;

export const ProviderThreadSettingsUpdateInput = Schema.Struct({
  threadId: ThreadId,
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  approvalPolicy: Schema.optional(Schema.NullOr(ProviderApprovalPolicy)),
  sandboxPolicy: Schema.optional(Schema.NullOr(ProviderSandboxPolicy)),
  permissionProfileId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  personality: Schema.optional(Schema.NullOr(ProviderPersonality)),
  reasoningSummary: Schema.optional(Schema.NullOr(ProviderReasoningSummary)),
  serviceTier: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ProviderThreadSettingsUpdateInput = typeof ProviderThreadSettingsUpdateInput.Type;

export const ProviderThreadSettingsUpdateResult = Schema.Struct({
  threadId: ThreadId,
  updated: Schema.Boolean,
});
export type ProviderThreadSettingsUpdateResult = typeof ProviderThreadSettingsUpdateResult.Type;

export class ProviderThreadSettingsUpdateError extends Schema.TaggedErrorClass<ProviderThreadSettingsUpdateError>()(
  "ProviderThreadSettingsUpdateError",
  {
    threadId: ThreadId,
    reason: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Provider thread settings update failed for ${this.threadId}: ${this.reason}`;
  }
}

export const ProviderSteerTurnInput = Schema.Struct({
  threadId: ThreadId,
  expectedTurnId: TurnId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
});
export type ProviderSteerTurnInput = typeof ProviderSteerTurnInput.Type;

export const ProviderTurnStartResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  resumeCursor: Schema.optional(Schema.Unknown),
});
export type ProviderTurnStartResult = typeof ProviderTurnStartResult.Type;

export const ProviderTurnSteerResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
});
export type ProviderTurnSteerResult = typeof ProviderTurnSteerResult.Type;

export const ProviderInterruptTurnInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
});
export type ProviderInterruptTurnInput = typeof ProviderInterruptTurnInput.Type;

export const ProviderStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderStopSessionInput = typeof ProviderStopSessionInput.Type;

export const ProviderRespondToRequestInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
});
export type ProviderRespondToRequestInput = typeof ProviderRespondToRequestInput.Type;

export const ProviderRespondToUserInputInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
});
export type ProviderRespondToUserInputInput = typeof ProviderRespondToUserInputInput.Type;

export const ProviderGoalSetInput = Schema.Struct({
  threadId: ThreadId,
  objective: TrimmedNonEmptyString.check(
    Schema.isMaxLength(ORCHESTRATION_GOAL_OBJECTIVE_MAX_CHARS),
  ),
  status: Schema.optional(OrchestrationGoalStatus),
});
export type ProviderGoalSetInput = typeof ProviderGoalSetInput.Type;

export const ProviderGoalStatusSetInput = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationGoalStatus,
});
export type ProviderGoalStatusSetInput = typeof ProviderGoalStatusSetInput.Type;

export const ProviderGoalClearInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderGoalClearInput = typeof ProviderGoalClearInput.Type;

export const ProviderGoalGetInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderGoalGetInput = typeof ProviderGoalGetInput.Type;

export const ProviderGoalSetResult = Schema.Struct({
  threadId: ThreadId,
  goal: OrchestrationGoal,
});
export type ProviderGoalSetResult = typeof ProviderGoalSetResult.Type;

export const ProviderGoalGetResult = Schema.Struct({
  threadId: ThreadId,
  goal: Schema.NullOr(OrchestrationGoal),
});
export type ProviderGoalGetResult = typeof ProviderGoalGetResult.Type;

export const ProviderGoalClearResult = Schema.Struct({
  threadId: ThreadId,
  cleared: Schema.Boolean,
});
export type ProviderGoalClearResult = typeof ProviderGoalClearResult.Type;

const ProviderEventKind = Schema.Literals(["session", "notification", "request", "error"]);

export const ProviderEvent = Schema.Struct({
  id: EventId,
  kind: ProviderEventKind,
  provider: ProviderDriverKind,
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  threadId: ThreadId,
  createdAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  turnId: Schema.optional(TurnId),
  itemId: Schema.optional(ProviderItemId),
  requestId: Schema.optional(ApprovalRequestId),
  requestKind: Schema.optional(ProviderRequestKind),
  textDelta: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown),
});
export type ProviderEvent = typeof ProviderEvent.Type;
