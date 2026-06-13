import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        ALTER TABLE provider_session_runtime
        RENAME TO provider_session_runtime_old_runtime_default
      `;

      yield* sql`
        CREATE TABLE provider_session_runtime (
          thread_id TEXT PRIMARY KEY,
          provider_name TEXT NOT NULL,
          provider_instance_id TEXT,
          adapter_key TEXT NOT NULL,
          runtime_mode TEXT NOT NULL DEFAULT 'auto-accept-edits',
          status TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          resume_cursor_json TEXT,
          runtime_payload_json TEXT
        )
      `;

      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          provider_instance_id,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        SELECT
          thread_id,
          provider_name,
          provider_instance_id,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        FROM provider_session_runtime_old_runtime_default
      `;

      yield* sql`DROP TABLE provider_session_runtime_old_runtime_default`;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_status
        ON provider_session_runtime(status)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_provider
        ON provider_session_runtime(provider_name)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_instance
        ON provider_session_runtime(provider_instance_id)
      `;

      yield* sql`
        ALTER TABLE projection_thread_sessions
        RENAME TO projection_thread_sessions_old_runtime_default
      `;

      yield* sql`
        CREATE TABLE projection_thread_sessions (
          thread_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          provider_name TEXT,
          provider_instance_id TEXT,
          provider_session_id TEXT,
          provider_thread_id TEXT,
          runtime_mode TEXT NOT NULL DEFAULT 'auto-accept-edits',
          active_turn_id TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_instance_id,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        SELECT
          thread_id,
          status,
          provider_name,
          provider_instance_id,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        FROM projection_thread_sessions_old_runtime_default
      `;

      yield* sql`DROP TABLE projection_thread_sessions_old_runtime_default`;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_provider_session
        ON projection_thread_sessions(provider_session_id)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_instance
        ON projection_thread_sessions(provider_instance_id)
      `;

      yield* sql`
        ALTER TABLE projection_threads
        RENAME TO projection_threads_old_runtime_default
      `;

      yield* sql`
        CREATE TABLE projection_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          model_selection_json TEXT,
          runtime_mode TEXT NOT NULL DEFAULT 'auto-accept-edits',
          interaction_mode TEXT NOT NULL DEFAULT 'default',
          branch TEXT,
          worktree_path TEXT,
          latest_turn_id TEXT,
          goal_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          latest_user_message_at TEXT,
          pending_approval_count INTEGER NOT NULL DEFAULT 0,
          pending_user_input_count INTEGER NOT NULL DEFAULT 0,
          has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          goal_json,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        )
        SELECT
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          goal_json,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        FROM projection_threads_old_runtime_default
      `;

      yield* sql`DROP TABLE projection_threads_old_runtime_default`;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_threads_project_id
        ON projection_threads(project_id)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_threads_project_archived_at
        ON projection_threads(project_id, archived_at)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_threads_project_deleted_created
        ON projection_threads(project_id, deleted_at, created_at)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_threads_shell_active
        ON projection_threads(deleted_at, archived_at, project_id, created_at, thread_id)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_threads_shell_archived
        ON projection_threads(deleted_at, archived_at, project_id, thread_id)
      `;
    }),
  );
});
