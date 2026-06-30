import type {
  AutomationPermissionPolicyActionAuditIngestInput,
  AutomationPermissionPolicyActionAuditIngestResult,
  AutomationPermissionPolicyActionAuditListInput,
  AutomationPermissionPolicyActionAuditListResult,
  AutomationPermissionPolicyActionAuditError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface AutomationPermissionAuditServiceShape {
  readonly ingest: (
    input: AutomationPermissionPolicyActionAuditIngestInput,
  ) => Effect.Effect<
    AutomationPermissionPolicyActionAuditIngestResult,
    AutomationPermissionPolicyActionAuditError
  >;
  readonly list: (
    input: AutomationPermissionPolicyActionAuditListInput,
  ) => Effect.Effect<
    AutomationPermissionPolicyActionAuditListResult,
    AutomationPermissionPolicyActionAuditError
  >;
}

export class AutomationPermissionAuditService extends Context.Service<
  AutomationPermissionAuditService,
  AutomationPermissionAuditServiceShape
>()("t3/automationPermissionAudit/Services/AutomationPermissionAuditService") {}
