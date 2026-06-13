import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("033_RuntimeModeSafeDefaults", (it) => {
  it.effect("updates runtime_mode defaults without mutating existing rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });

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
        VALUES (
          'provider-full-access-thread',
          'codex',
          'codex-default',
          'codex',
          'full-access',
          'active',
          '2026-06-13T00:00:00.000Z',
          NULL,
          NULL
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
        VALUES (
          'session-full-access-thread',
          'active',
          'codex',
          'codex-default',
          'provider-session-id',
          'provider-thread-id',
          'full-access',
          NULL,
          NULL,
          '2026-06-13T00:00:00.000Z'
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
          created_at,
          updated_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        )
        VALUES (
          'projection-full-access-thread',
          'project-id',
          '历史线程',
          '{"instanceId":"codex-default","model":"gpt-5.4"}',
          'full-access',
          'default',
          '2026-06-13T00:00:00.000Z',
          '2026-06-13T00:00:00.000Z',
          0,
          0,
          0
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 33 });

      const providerRuntimeColumns = yield* sql<{
        readonly name: string;
        readonly dflt_value: string | null;
      }>`PRAGMA table_info(provider_session_runtime)`;
      const projectionSessionColumns = yield* sql<{
        readonly name: string;
        readonly dflt_value: string | null;
      }>`PRAGMA table_info(projection_thread_sessions)`;
      const projectionThreadColumns = yield* sql<{
        readonly name: string;
        readonly dflt_value: string | null;
      }>`PRAGMA table_info(projection_threads)`;

      assert.equal(
        providerRuntimeColumns.find((column) => column.name === "runtime_mode")?.dflt_value,
        "'auto-accept-edits'",
      );
      assert.equal(
        projectionSessionColumns.find((column) => column.name === "runtime_mode")?.dflt_value,
        "'auto-accept-edits'",
      );
      assert.equal(
        projectionThreadColumns.find((column) => column.name === "runtime_mode")?.dflt_value,
        "'auto-accept-edits'",
      );

      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          provider_instance_id,
          adapter_key,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        VALUES (
          'provider-default-thread',
          'codex',
          'codex-default',
          'codex',
          'active',
          '2026-06-13T00:01:00.000Z',
          NULL,
          NULL
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
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          'session-default-thread',
          'active',
          'codex',
          'codex-default',
          'provider-session-id-2',
          'provider-thread-id-2',
          NULL,
          NULL,
          '2026-06-13T00:01:00.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          interaction_mode,
          created_at,
          updated_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        )
        VALUES (
          'projection-default-thread',
          'project-id',
          '默认线程',
          '{"instanceId":"codex-default","model":"gpt-5.4"}',
          'default',
          '2026-06-13T00:01:00.000Z',
          '2026-06-13T00:01:00.000Z',
          0,
          0,
          0
        )
      `;

      const rows = yield* sql<{ readonly source: string; readonly runtime_mode: string }>`
        SELECT 'provider-old' AS source, runtime_mode
        FROM provider_session_runtime
        WHERE thread_id = 'provider-full-access-thread'
        UNION ALL
        SELECT 'provider-new' AS source, runtime_mode
        FROM provider_session_runtime
        WHERE thread_id = 'provider-default-thread'
        UNION ALL
        SELECT 'session-old' AS source, runtime_mode
        FROM projection_thread_sessions
        WHERE thread_id = 'session-full-access-thread'
        UNION ALL
        SELECT 'session-new' AS source, runtime_mode
        FROM projection_thread_sessions
        WHERE thread_id = 'session-default-thread'
        UNION ALL
        SELECT 'thread-old' AS source, runtime_mode
        FROM projection_threads
        WHERE thread_id = 'projection-full-access-thread'
        UNION ALL
        SELECT 'thread-new' AS source, runtime_mode
        FROM projection_threads
        WHERE thread_id = 'projection-default-thread'
      `;
      assert.deepStrictEqual(
        Object.fromEntries(rows.map((row) => [row.source, row.runtime_mode])),
        {
          "provider-old": "full-access",
          "provider-new": "auto-accept-edits",
          "session-old": "full-access",
          "session-new": "auto-accept-edits",
          "thread-old": "full-access",
          "thread-new": "auto-accept-edits",
        },
      );
    }),
  );
});
