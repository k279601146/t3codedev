import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_permission_policy_action_audit_events (
      event_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      source TEXT NOT NULL,
      action_kind TEXT NOT NULL,
      action_label TEXT NOT NULL,
      target_label TEXT NOT NULL,
      target_id TEXT NOT NULL,
      result TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      detail TEXT,
      context_json TEXT,
      synced_at TEXT NOT NULL,
      idempotency_key TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_permission_audit_timeline
    ON automation_permission_policy_action_audit_events(occurred_at DESC, event_id DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_permission_audit_source_result_time
    ON automation_permission_policy_action_audit_events(source, result, occurred_at DESC)
  `;
});
