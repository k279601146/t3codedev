import {
  AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION,
  type AutomationPermissionPolicyActionAuditEvent,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AutomationPermissionAuditService } from "../Services/AutomationPermissionAuditService.ts";
import { AutomationPermissionAuditServiceLive } from "./AutomationPermissionAuditService.ts";

const layer = it.layer(
  AutomationPermissionAuditServiceLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const event = {
  schemaVersion: AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION,
  id: "audit-event-1",
  source: "chrome",
  actionKind: "chrome-downgrade-persistent-host",
  actionLabel: "改为本次会话",
  targetLabel: "billing.example.com",
  targetId: "billing.example.com",
  result: "success",
  occurredAt: "2026-07-01T10:00:00.000Z",
  detail: "已改为本次会话授权。",
  context: {
    actor: {
      kind: "local-user",
      id: null,
      label: "本机用户",
    },
    device: {
      id: "browser:device-1",
      label: "Windows",
    },
    workspace: {
      id: null,
      label: "全局自动化权限",
    },
    policy: {
      source: "local",
      version: "local-automation-permission-policy:v1",
    },
    persistence: {
      scope: "local-browser",
      syncedAt: null,
    },
  },
} satisfies AutomationPermissionPolicyActionAuditEvent;

layer("AutomationPermissionAuditService", (it) => {
  it.effect("ingests audit events idempotently and lists persisted records", () =>
    Effect.gen(function* () {
      const service = yield* AutomationPermissionAuditService;

      const first = yield* service.ingest({ events: [event], idempotencyKey: "batch-1" });
      assert.equal(first.accepted, 1);
      assert.equal(first.ignored, 0);

      const second = yield* service.ingest({ events: [event], idempotencyKey: "batch-2" });
      assert.equal(second.accepted, 0);
      assert.equal(second.ignored, 1);

      const listed = yield* service.list({
        source: "chrome",
        result: "success",
        query: "device-1",
        limit: 10,
      });

      assert.equal(listed.events.length, 1);
      assert.equal(listed.events[0]?.id, event.id);
      assert.equal(listed.events[0]?.context?.persistence.scope, "server-audit-log");
      assert.equal(listed.events[0]?.context?.persistence.syncedAt, first.syncedAt);
      assert.equal(listed.nextCursor, null);
    }),
  );
});
