import type {
  Automation,
  AutomationId,
  AutomationListResult,
  AutomationRun,
  AutomationRunId,
  AutomationRunStatus,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../../persistence/Errors.ts";

export type AutomationRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export interface AutomationRepositoryShape {
  readonly list: () => Effect.Effect<AutomationListResult, AutomationRepositoryError>;
  readonly get: (
    id: AutomationId,
  ) => Effect.Effect<Automation | null, AutomationRepositoryError>;
  readonly listRuns: (
    automationId: AutomationId,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, AutomationRepositoryError>;
  readonly upsert: (
    automation: Automation,
  ) => Effect.Effect<Automation, AutomationRepositoryError>;
  readonly delete: (id: AutomationId, deletedAt: string) => Effect.Effect<void, AutomationRepositoryError>;
  readonly insertRun: (run: AutomationRun) => Effect.Effect<AutomationRun, AutomationRepositoryError>;
  readonly updateRun: (input: {
    readonly runId: AutomationRunId;
    readonly status?: AutomationRunStatus;
    readonly completedAt?: string | null;
    readonly resultThreadId?: ThreadId | null;
    readonly summary?: string | null;
    readonly error?: string | null;
    readonly archivedAt?: string | null;
    readonly readAt?: string | null;
    readonly updatedAt: string;
  }) => Effect.Effect<void, AutomationRepositoryError>;
  readonly archiveRun: (
    runId: AutomationRunId,
    archivedAt: string,
  ) => Effect.Effect<void, AutomationRepositoryError>;
  readonly markRunRead: (
    runId: AutomationRunId,
    readAt: string,
  ) => Effect.Effect<void, AutomationRepositoryError>;
  readonly getRunningRunByAutomationId: (
    automationId: AutomationId,
  ) => Effect.Effect<AutomationRun | null, AutomationRepositoryError>;
  readonly getRunningRunByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<AutomationRun | null, AutomationRepositoryError>;
  readonly updateAutomationScheduleState: (input: {
    readonly automationId: AutomationId;
    readonly nextRunAt: string | null;
    readonly lastRunAt?: string | null;
    readonly updatedAt: string;
  }) => Effect.Effect<void, AutomationRepositoryError>;
  readonly listDue: (now: string) => Effect.Effect<ReadonlyArray<Automation>, AutomationRepositoryError>;
}

export class AutomationRepository extends Context.Service<
  AutomationRepository,
  AutomationRepositoryShape
>()("t3/automations/Services/AutomationRepository") {}
