import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automations (
      automation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      target_json TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      next_run_at TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_due
    ON automations(deleted_at, status, next_run_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      result_thread_id TEXT,
      summary TEXT,
      error TEXT,
      archived_at TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(automation_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_inbox
    ON automation_runs(archived_at, read_at, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_by_automation
    ON automation_runs(automation_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_by_thread
    ON automation_runs(result_thread_id)
  `;
});
