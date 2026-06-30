import {
  AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION,
  AutomationPermissionPolicyActionAuditError,
  AutomationPermissionPolicyActionAuditEvent,
  type AutomationPermissionPolicyActionAuditEvent as AutomationPermissionPolicyActionAuditEventType,
  type AutomationPermissionPolicyActionAuditIngestInput,
  type AutomationPermissionPolicyActionAuditListInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as Statement from "effect/unstable/sql/Statement";

import {
  AutomationPermissionAuditService,
  type AutomationPermissionAuditServiceShape,
} from "../Services/AutomationPermissionAuditService.ts";

interface AutomationPermissionAuditRow {
  readonly schemaVersion: number;
  readonly id: string;
  readonly source: string;
  readonly actionKind: string;
  readonly actionLabel: string;
  readonly targetLabel: string;
  readonly targetId: string;
  readonly result: string;
  readonly occurredAt: string;
  readonly detail: string | null;
  readonly contextJson: string | null;
}

interface CursorParts {
  readonly occurredAt: string;
  readonly id: string;
}

const MAX_INGEST_EVENTS = 200;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodeEvent = Schema.decodeUnknownEffect(AutomationPermissionPolicyActionAuditEvent);

function auditError(
  kind: "invalid-event" | "storage-unavailable" | "query-failed",
  detail: string,
  cause?: unknown,
): AutomationPermissionPolicyActionAuditError {
  return new AutomationPermissionPolicyActionAuditError({
    kind,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

function encodeCursor(event: AutomationPermissionPolicyActionAuditEventType): string {
  return `${encodeURIComponent(event.occurredAt)}|${encodeURIComponent(event.id)}`;
}

function decodeCursor(
  cursor: string | undefined,
): Effect.Effect<CursorParts | null, AutomationPermissionPolicyActionAuditError> {
  if (cursor === undefined) {
    return Effect.succeed(null);
  }
  return Effect.try({
    try: () => {
      const parts = cursor.split("|");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error("Malformed automation permission audit cursor.");
      }
      return {
        occurredAt: decodeURIComponent(parts[0]),
        id: decodeURIComponent(parts[1]),
      };
    },
    catch: (cause) => auditError("query-failed", "自动化权限审计分页游标无效。", cause),
  });
}

function withServerPersistence(
  event: AutomationPermissionPolicyActionAuditEventType,
  syncedAt: string,
): AutomationPermissionPolicyActionAuditEventType {
  if (event.context === null) {
    return event;
  }
  return {
    ...event,
    context: {
      ...event.context,
      persistence: {
        scope: "server-audit-log",
        syncedAt,
      },
    },
  };
}

function parseContextJson(row: AutomationPermissionAuditRow): unknown {
  return row.contextJson === null ? null : JSON.parse(row.contextJson);
}

function rowToEvent(
  row: AutomationPermissionAuditRow,
): Effect.Effect<AutomationPermissionPolicyActionAuditEventType, AutomationPermissionPolicyActionAuditError> {
  return Effect.try({
    try: () => ({
      schemaVersion: row.schemaVersion,
      id: row.id,
      source: row.source,
      actionKind: row.actionKind,
      actionLabel: row.actionLabel,
      targetLabel: row.targetLabel,
      targetId: row.targetId,
      result: row.result,
      occurredAt: row.occurredAt,
      detail: row.detail,
      context: parseContextJson(row),
    }),
    catch: (cause) =>
      auditError("query-failed", "自动化权限审计上下文解析失败。", cause),
  }).pipe(
    Effect.flatMap((value) =>
      decodeEvent(value).pipe(
        Effect.mapError((cause) =>
          auditError("query-failed", "自动化权限审计记录解码失败。", cause),
        ),
      ),
    ),
  );
}

function searchablePattern(query: string | undefined): string | null {
  const trimmed = query?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? `%${trimmed}%` : null;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertEvent = (
    event: AutomationPermissionPolicyActionAuditEventType,
    syncedAt: string,
    idempotencyKey: AutomationPermissionPolicyActionAuditIngestInput["idempotencyKey"],
  ) => {
    const stored = withServerPersistence(event, syncedAt);
    const contextJson = stored.context === null ? null : JSON.stringify(stored.context);
    return sql<{ readonly eventId: string }>`
      INSERT INTO automation_permission_policy_action_audit_events (
        event_id,
        schema_version,
        source,
        action_kind,
        action_label,
        target_label,
        target_id,
        result,
        occurred_at,
        detail,
        context_json,
        synced_at,
        idempotency_key
      )
      VALUES (
        ${stored.id},
        ${stored.schemaVersion},
        ${stored.source},
        ${stored.actionKind},
        ${stored.actionLabel},
        ${stored.targetLabel},
        ${stored.targetId},
        ${stored.result},
        ${stored.occurredAt},
        ${stored.detail},
        ${contextJson},
        ${syncedAt},
        ${idempotencyKey ?? null}
      )
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id AS "eventId"
    `;
  };

  const selectRows = (
    input: AutomationPermissionPolicyActionAuditListInput,
    cursor: CursorParts | null,
    limit: number,
  ) => {
    const clauses: Array<string | Statement.Fragment> = [
      sql`schema_version = ${AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION}`,
    ];
    if (input.source !== undefined) {
      clauses.push(sql`source = ${input.source}`);
    }
    if (input.result !== undefined) {
      clauses.push(sql`result = ${input.result}`);
    }
    if (input.occurredAfter !== undefined) {
      clauses.push(sql`occurred_at >= ${input.occurredAfter}`);
    }
    if (input.occurredBefore !== undefined) {
      clauses.push(sql`occurred_at <= ${input.occurredBefore}`);
    }
    if (cursor !== null) {
      clauses.push(
        sql`(occurred_at < ${cursor.occurredAt} OR (occurred_at = ${cursor.occurredAt} AND event_id < ${cursor.id}))`,
      );
    }
    const pattern = searchablePattern(input.query);
    if (pattern !== null) {
      clauses.push(
        sql.or([
          sql`lower(source) LIKE ${pattern}`,
          sql`lower(action_kind) LIKE ${pattern}`,
          sql`lower(action_label) LIKE ${pattern}`,
          sql`lower(target_label) LIKE ${pattern}`,
          sql`lower(target_id) LIKE ${pattern}`,
          sql`lower(COALESCE(detail, '')) LIKE ${pattern}`,
          sql`lower(COALESCE(context_json, '')) LIKE ${pattern}`,
        ]),
      );
    }
    return sql<AutomationPermissionAuditRow>`
      SELECT
        schema_version AS "schemaVersion",
        event_id AS "id",
        source,
        action_kind AS "actionKind",
        action_label AS "actionLabel",
        target_label AS "targetLabel",
        target_id AS "targetId",
        result,
        occurred_at AS "occurredAt",
        detail,
        context_json AS "contextJson"
      FROM automation_permission_policy_action_audit_events
      WHERE ${sql.and(clauses)}
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT ${limit}
    `;
  };

  const ingest: AutomationPermissionAuditServiceShape["ingest"] = (input) =>
    Effect.gen(function* () {
      if (input.events.length > MAX_INGEST_EVENTS) {
        return yield* Effect.fail(
          auditError("invalid-event", `单次最多写入 ${MAX_INGEST_EVENTS} 条自动化权限审计事件。`),
        );
      }
      const syncedAt = yield* nowIso;
      const results = yield* sql
        .withTransaction(
          Effect.forEach(
            input.events,
            (event) =>
              insertEvent(event, syncedAt, input.idempotencyKey).pipe(
                Effect.mapError((cause) =>
                  auditError("storage-unavailable", "自动化权限审计写入失败。", cause),
                ),
              ),
            { concurrency: 1 },
          ),
        )
        .pipe(
          Effect.mapError((cause) =>
            Schema.is(AutomationPermissionPolicyActionAuditError)(cause)
              ? cause
              : auditError("storage-unavailable", "自动化权限审计事务提交失败。", cause),
          ),
        );
      const accepted = results.filter((rows) => rows.length > 0).length;
      return {
        accepted,
        ignored: input.events.length - accepted,
        syncedAt,
      };
    });

  const list: AutomationPermissionAuditServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const cursor = yield* decodeCursor(input.cursor);
      const limit = normalizeLimit(input.limit);
      const rows = yield* selectRows(input, cursor, limit + 1).pipe(
        Effect.mapError((cause) =>
          auditError("query-failed", "自动化权限审计查询失败。", cause),
        ),
      );
      const pageRows = rows.slice(0, limit);
      const events = yield* Effect.forEach(pageRows, rowToEvent);
      return {
        events,
        nextCursor:
          rows.length > limit && events.length > 0 ? encodeCursor(events[events.length - 1]!) : null,
      };
    });

  return {
    ingest,
    list,
  } satisfies AutomationPermissionAuditServiceShape;
});

export const AutomationPermissionAuditServiceLive = Layer.effect(
  AutomationPermissionAuditService,
  make,
);
