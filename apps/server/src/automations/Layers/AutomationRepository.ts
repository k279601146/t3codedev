import {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  AutomationRunStatus,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../../persistence/Errors.ts";
import {
  AutomationRepository,
  type AutomationRepositoryShape,
} from "../Services/AutomationRepository.ts";

interface AutomationRow {
  readonly automationId: string;
  readonly title: string;
  readonly prompt: string;
  readonly status: string;
  readonly scheduleJson: string;
  readonly targetJson: string;
  readonly modelSelectionJson: string;
  readonly runtimeMode: string;
  readonly interactionMode: string;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AutomationRunRow {
  readonly runId: string;
  readonly automationId: string;
  readonly status: string;
  readonly triggerKind: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly resultThreadId: string | null;
  readonly summary: string | null;
  readonly error: string | null;
  readonly archivedAt: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const decodeAutomation = Schema.decodeUnknownEffect(Automation);
const decodeAutomationRun = Schema.decodeUnknownEffect(AutomationRun);

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

const mapAutomationRow = (row: AutomationRow) =>
  decodeAutomation({
    id: row.automationId,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    schedule: parseJson(row.scheduleJson),
    target: parseJson(row.targetJson),
    modelSelection: parseJson(row.modelSelectionJson),
    runtimeMode: row.runtimeMode,
    interactionMode: row.interactionMode,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }).pipe(Effect.mapError(toPersistenceDecodeError("AutomationRepository.decodeAutomation")));

const mapRunRow = (row: AutomationRunRow) =>
  decodeAutomationRun({
    id: row.runId,
    automationId: row.automationId,
    status: row.status,
    trigger: row.triggerKind,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    resultThreadId: row.resultThreadId,
    summary: row.summary,
    error: row.error,
    archivedAt: row.archivedAt,
    readAt: row.readAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }).pipe(Effect.mapError(toPersistenceDecodeError("AutomationRepository.decodeRun")));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listAutomations = () =>
    sql<AutomationRow>`
      SELECT
        automation_id AS automationId,
        title,
        prompt,
        status,
        schedule_json AS scheduleJson,
        target_json AS targetJson,
        model_selection_json AS modelSelectionJson,
        runtime_mode AS runtimeMode,
        interaction_mode AS interactionMode,
        next_run_at AS nextRunAt,
        last_run_at AS lastRunAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM automations
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC, automation_id DESC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listAutomations")),
      Effect.flatMap((rows) => Effect.forEach(rows, mapAutomationRow)),
    );

  const listRunsAll = () =>
    sql<AutomationRunRow>`
      SELECT
        run_id AS runId,
        automation_id AS automationId,
        status,
        trigger_kind AS triggerKind,
        started_at AS startedAt,
        completed_at AS completedAt,
        result_thread_id AS resultThreadId,
        summary,
        error,
        archived_at AS archivedAt,
        read_at AS readAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM automation_runs
      ORDER BY created_at DESC, run_id DESC
      LIMIT 200
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listRunsAll")),
      Effect.flatMap((rows) => Effect.forEach(rows, mapRunRow)),
    );

  const list: AutomationRepositoryShape["list"] = () =>
    Effect.all({
      automations: listAutomations(),
      runs: listRunsAll(),
    });

  const get: AutomationRepositoryShape["get"] = (id) =>
    sql<AutomationRow>`
      SELECT
        automation_id AS automationId,
        title,
        prompt,
        status,
        schedule_json AS scheduleJson,
        target_json AS targetJson,
        model_selection_json AS modelSelectionJson,
        runtime_mode AS runtimeMode,
        interaction_mode AS interactionMode,
        next_run_at AS nextRunAt,
        last_run_at AS lastRunAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM automations
      WHERE automation_id = ${id} AND deleted_at IS NULL
      LIMIT 1
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.get")),
      Effect.flatMap((rows) => (rows[0] ? mapAutomationRow(rows[0]) : Effect.succeed(null))),
    );

  const listRuns: AutomationRepositoryShape["listRuns"] = (automationId) =>
    sql<AutomationRunRow>`
      SELECT
        run_id AS runId,
        automation_id AS automationId,
        status,
        trigger_kind AS triggerKind,
        started_at AS startedAt,
        completed_at AS completedAt,
        result_thread_id AS resultThreadId,
        summary,
        error,
        archived_at AS archivedAt,
        read_at AS readAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM automation_runs
      WHERE automation_id = ${automationId}
      ORDER BY created_at DESC, run_id DESC
      LIMIT 100
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listRuns")),
      Effect.flatMap((rows) => Effect.forEach(rows, mapRunRow)),
    );

  const upsert: AutomationRepositoryShape["upsert"] = (automation) =>
    sql`
      INSERT INTO automations (
        automation_id,
        title,
        prompt,
        status,
        schedule_json,
        target_json,
        model_selection_json,
        runtime_mode,
        interaction_mode,
        next_run_at,
        last_run_at,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        ${automation.id},
        ${automation.title},
        ${automation.prompt},
        ${automation.status},
        ${JSON.stringify(automation.schedule)},
        ${JSON.stringify(automation.target)},
        ${JSON.stringify(automation.modelSelection)},
        ${automation.runtimeMode},
        ${automation.interactionMode},
        ${automation.nextRunAt},
        ${automation.lastRunAt},
        ${automation.createdAt},
        ${automation.updatedAt},
        NULL
      )
      ON CONFLICT (automation_id)
      DO UPDATE SET
        title = excluded.title,
        prompt = excluded.prompt,
        status = excluded.status,
        schedule_json = excluded.schedule_json,
        target_json = excluded.target_json,
        model_selection_json = excluded.model_selection_json,
        runtime_mode = excluded.runtime_mode,
        interaction_mode = excluded.interaction_mode,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.upsert")),
      Effect.as(automation),
    );

  const deleteById: AutomationRepositoryShape["delete"] = (id, deletedAt) =>
    sql`
      UPDATE automations
      SET deleted_at = ${deletedAt}, updated_at = ${deletedAt}
      WHERE automation_id = ${id}
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.delete")));

  const insertRun: AutomationRepositoryShape["insertRun"] = (run) =>
    sql`
      INSERT INTO automation_runs (
        run_id,
        automation_id,
        status,
        trigger_kind,
        started_at,
        completed_at,
        result_thread_id,
        summary,
        error,
        archived_at,
        read_at,
        created_at,
        updated_at
      )
      VALUES (
        ${run.id},
        ${run.automationId},
        ${run.status},
        ${run.trigger},
        ${run.startedAt},
        ${run.completedAt},
        ${run.resultThreadId},
        ${run.summary},
        ${run.error},
        ${run.archivedAt},
        ${run.readAt},
        ${run.createdAt},
        ${run.updatedAt}
      )
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.insertRun")),
      Effect.as(run),
    );

  const updateRun: AutomationRepositoryShape["updateRun"] = (input) =>
    sql`
      UPDATE automation_runs
      SET
        status = COALESCE(${input.status ?? null}, status),
        completed_at = CASE WHEN ${input.completedAt === undefined ? 0 : 1} = 1 THEN ${input.completedAt ?? null} ELSE completed_at END,
        result_thread_id = CASE WHEN ${input.resultThreadId === undefined ? 0 : 1} = 1 THEN ${input.resultThreadId ?? null} ELSE result_thread_id END,
        summary = CASE WHEN ${input.summary === undefined ? 0 : 1} = 1 THEN ${input.summary ?? null} ELSE summary END,
        error = CASE WHEN ${input.error === undefined ? 0 : 1} = 1 THEN ${input.error ?? null} ELSE error END,
        archived_at = CASE WHEN ${input.archivedAt === undefined ? 0 : 1} = 1 THEN ${input.archivedAt ?? null} ELSE archived_at END,
        read_at = CASE WHEN ${input.readAt === undefined ? 0 : 1} = 1 THEN ${input.readAt ?? null} ELSE read_at END,
        updated_at = ${input.updatedAt}
      WHERE run_id = ${input.runId}
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.updateRun")));

  const archiveRun: AutomationRepositoryShape["archiveRun"] = (runId, archivedAt) =>
    updateRun({ runId, archivedAt, readAt: archivedAt, updatedAt: archivedAt });

  const markRunRead: AutomationRepositoryShape["markRunRead"] = (runId, readAt) =>
    updateRun({ runId, readAt, updatedAt: readAt });

  const getRunningRunByAutomationId: AutomationRepositoryShape["getRunningRunByAutomationId"] = (
    automationId,
  ) =>
    sql<AutomationRunRow>`
      SELECT
        run_id AS runId,
        automation_id AS automationId,
        status,
        trigger_kind AS triggerKind,
        started_at AS startedAt,
        completed_at AS completedAt,
        result_thread_id AS resultThreadId,
        summary,
        error,
        archived_at AS archivedAt,
        read_at AS readAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM automation_runs
      WHERE automation_id = ${automationId} AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.getRunningRunByAutomationId")),
      Effect.flatMap((rows) => (rows[0] ? mapRunRow(rows[0]) : Effect.succeed(null))),
    );

  const getRunningRunByThreadId: AutomationRepositoryShape["getRunningRunByThreadId"] = (
    threadId,
  ) =>
    sql<AutomationRunRow>`
      SELECT
        run_id AS runId,
        automation_id AS automationId,
        status,
        trigger_kind AS triggerKind,
        started_at AS startedAt,
        completed_at AS completedAt,
        result_thread_id AS resultThreadId,
        summary,
        error,
        archived_at AS archivedAt,
        read_at AS readAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM automation_runs
      WHERE result_thread_id = ${threadId} AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.getRunningRunByThreadId")),
      Effect.flatMap((rows) => (rows[0] ? mapRunRow(rows[0]) : Effect.succeed(null))),
    );

  const updateAutomationScheduleState: AutomationRepositoryShape["updateAutomationScheduleState"] =
    (input) =>
      sql`
        UPDATE automations
        SET
          next_run_at = ${input.nextRunAt},
          last_run_at = CASE WHEN ${input.lastRunAt === undefined ? 0 : 1} = 1 THEN ${input.lastRunAt ?? null} ELSE last_run_at END,
          updated_at = ${input.updatedAt}
        WHERE automation_id = ${input.automationId}
      `.pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.updateAutomationScheduleState")),
      );

  const listDue: AutomationRepositoryShape["listDue"] = (now) =>
    sql<AutomationRow>`
      SELECT
        automation_id AS automationId,
        title,
        prompt,
        status,
        schedule_json AS scheduleJson,
        target_json AS targetJson,
        model_selection_json AS modelSelectionJson,
        runtime_mode AS runtimeMode,
        interaction_mode AS interactionMode,
        next_run_at AS nextRunAt,
        last_run_at AS lastRunAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM automations
      WHERE deleted_at IS NULL
        AND status = 'enabled'
        AND next_run_at IS NOT NULL
        AND next_run_at <= ${now}
      ORDER BY next_run_at ASC, automation_id ASC
      LIMIT 20
    `.pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listDue")),
      Effect.flatMap((rows) => Effect.forEach(rows, mapAutomationRow)),
    );

  return {
    list,
    get,
    listRuns,
    upsert,
    delete: deleteById,
    insertRun,
    updateRun,
    archiveRun,
    markRunRead,
    getRunningRunByAutomationId,
    getRunningRunByThreadId,
    updateAutomationScheduleState,
    listDue,
  } satisfies AutomationRepositoryShape;
});

export const AutomationRepositoryLive = Layer.effect(AutomationRepository, make);
