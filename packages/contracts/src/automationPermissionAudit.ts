import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION = 1 as const;
export const AutomationPermissionPolicyActionAuditSchemaVersion =
  Schema.Literal(AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION);
export type AutomationPermissionPolicyActionAuditSchemaVersion =
  typeof AutomationPermissionPolicyActionAuditSchemaVersion.Type;

export const AutomationPermissionAuditSource = Schema.Literals(["chrome", "computer"]);
export type AutomationPermissionAuditSource = typeof AutomationPermissionAuditSource.Type;

export const AutomationPermissionAuditDecision = Schema.Literals(["allow", "block"]);
export type AutomationPermissionAuditDecision = typeof AutomationPermissionAuditDecision.Type;

export const AutomationPermissionPolicyActionKind = Schema.Literals([
  "chrome-downgrade-persistent-host",
  "computer-clear-persistent-apps",
]);
export type AutomationPermissionPolicyActionKind =
  typeof AutomationPermissionPolicyActionKind.Type;

export const AutomationPermissionPolicyActionAuditResult = Schema.Literals([
  "success",
  "failure",
]);
export type AutomationPermissionPolicyActionAuditResult =
  typeof AutomationPermissionPolicyActionAuditResult.Type;

export const AutomationPermissionPolicyActionAuditResultFilter = Schema.Literals([
  "all",
  "success",
  "failure",
]);
export type AutomationPermissionPolicyActionAuditResultFilter =
  typeof AutomationPermissionPolicyActionAuditResultFilter.Type;

export const AutomationPermissionPolicyActionAuditTimeRange = Schema.Literals([
  "all",
  "24h",
  "7d",
]);
export type AutomationPermissionPolicyActionAuditTimeRange =
  typeof AutomationPermissionPolicyActionAuditTimeRange.Type;

export const AutomationPermissionPolicyActionAuditActorKind = Schema.Literals([
  "local-user",
  "team-user",
]);
export type AutomationPermissionPolicyActionAuditActorKind =
  typeof AutomationPermissionPolicyActionAuditActorKind.Type;

export const AutomationPermissionPolicyActionAuditPolicySource = Schema.Literals([
  "local",
  "team",
]);
export type AutomationPermissionPolicyActionAuditPolicySource =
  typeof AutomationPermissionPolicyActionAuditPolicySource.Type;

export const AutomationPermissionPolicyActionAuditPersistenceScope = Schema.Literals([
  "local-browser",
  "server-audit-log",
]);
export type AutomationPermissionPolicyActionAuditPersistenceScope =
  typeof AutomationPermissionPolicyActionAuditPersistenceScope.Type;

export const AutomationPermissionPolicyActionAuditEventId = TrimmedNonEmptyString;
export type AutomationPermissionPolicyActionAuditEventId =
  typeof AutomationPermissionPolicyActionAuditEventId.Type;

export const AutomationPermissionPolicyActionAuditCursor = TrimmedNonEmptyString;
export type AutomationPermissionPolicyActionAuditCursor =
  typeof AutomationPermissionPolicyActionAuditCursor.Type;

export const AutomationPermissionPolicyActionAuditContext = Schema.Struct({
  actor: Schema.Struct({
    kind: AutomationPermissionPolicyActionAuditActorKind,
    id: Schema.NullOr(TrimmedNonEmptyString),
    label: Schema.NullOr(TrimmedNonEmptyString),
  }),
  device: Schema.Struct({
    id: TrimmedNonEmptyString,
    label: Schema.NullOr(TrimmedNonEmptyString),
  }),
  workspace: Schema.Struct({
    id: Schema.NullOr(TrimmedNonEmptyString),
    label: Schema.NullOr(TrimmedNonEmptyString),
  }),
  policy: Schema.Struct({
    source: AutomationPermissionPolicyActionAuditPolicySource,
    version: TrimmedNonEmptyString,
  }),
  persistence: Schema.Struct({
    scope: AutomationPermissionPolicyActionAuditPersistenceScope,
    syncedAt: Schema.NullOr(IsoDateTime),
  }),
});
export type AutomationPermissionPolicyActionAuditContext =
  typeof AutomationPermissionPolicyActionAuditContext.Type;

export const AutomationPermissionPolicyActionAuditEvent = Schema.Struct({
  schemaVersion: AutomationPermissionPolicyActionAuditSchemaVersion,
  id: AutomationPermissionPolicyActionAuditEventId,
  source: AutomationPermissionAuditSource,
  actionKind: AutomationPermissionPolicyActionKind,
  actionLabel: TrimmedNonEmptyString,
  targetLabel: TrimmedNonEmptyString,
  targetId: TrimmedNonEmptyString,
  result: AutomationPermissionPolicyActionAuditResult,
  occurredAt: IsoDateTime,
  detail: Schema.NullOr(TrimmedNonEmptyString),
  context: Schema.NullOr(AutomationPermissionPolicyActionAuditContext),
});
export type AutomationPermissionPolicyActionAuditEvent =
  typeof AutomationPermissionPolicyActionAuditEvent.Type;

export const AutomationPermissionPolicyActionAuditFilters = Schema.Struct({
  result: AutomationPermissionPolicyActionAuditResultFilter,
  query: Schema.String,
  timeRange: AutomationPermissionPolicyActionAuditTimeRange,
  now: IsoDateTime,
});
export type AutomationPermissionPolicyActionAuditFilters =
  typeof AutomationPermissionPolicyActionAuditFilters.Type;

export const AutomationPermissionPolicyActionAuditExport = Schema.Struct({
  schemaVersion: AutomationPermissionPolicyActionAuditSchemaVersion,
  exportedAt: IsoDateTime,
  total: NonNegativeInt,
  events: Schema.Array(AutomationPermissionPolicyActionAuditEvent),
});
export type AutomationPermissionPolicyActionAuditExport =
  typeof AutomationPermissionPolicyActionAuditExport.Type;

export const AutomationPermissionPolicyActionAuditIngestInput = Schema.Struct({
  events: Schema.Array(AutomationPermissionPolicyActionAuditEvent),
  idempotencyKey: Schema.optionalKey(TrimmedNonEmptyString),
});
export type AutomationPermissionPolicyActionAuditIngestInput =
  typeof AutomationPermissionPolicyActionAuditIngestInput.Type;

export const AutomationPermissionPolicyActionAuditIngestResult = Schema.Struct({
  accepted: NonNegativeInt,
  ignored: NonNegativeInt,
  syncedAt: IsoDateTime,
});
export type AutomationPermissionPolicyActionAuditIngestResult =
  typeof AutomationPermissionPolicyActionAuditIngestResult.Type;

export const AutomationPermissionPolicyActionAuditListInput = Schema.Struct({
  source: Schema.optionalKey(AutomationPermissionAuditSource),
  result: Schema.optionalKey(AutomationPermissionPolicyActionAuditResult),
  query: Schema.optionalKey(TrimmedNonEmptyString),
  occurredAfter: Schema.optionalKey(IsoDateTime),
  occurredBefore: Schema.optionalKey(IsoDateTime),
  limit: Schema.optionalKey(PositiveInt),
  cursor: Schema.optionalKey(AutomationPermissionPolicyActionAuditCursor),
});
export type AutomationPermissionPolicyActionAuditListInput =
  typeof AutomationPermissionPolicyActionAuditListInput.Type;

export const AutomationPermissionPolicyActionAuditListResult = Schema.Struct({
  events: Schema.Array(AutomationPermissionPolicyActionAuditEvent),
  nextCursor: Schema.NullOr(AutomationPermissionPolicyActionAuditCursor),
  total: Schema.optionalKey(NonNegativeInt),
});
export type AutomationPermissionPolicyActionAuditListResult =
  typeof AutomationPermissionPolicyActionAuditListResult.Type;

export class AutomationPermissionPolicyActionAuditError extends Schema.TaggedErrorClass<AutomationPermissionPolicyActionAuditError>()(
  "AutomationPermissionPolicyActionAuditError",
  {
    kind: Schema.Literals(["invalid-event", "storage-unavailable", "query-failed"]),
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
