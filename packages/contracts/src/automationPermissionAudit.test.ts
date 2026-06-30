import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION,
  AutomationPermissionPolicyActionAuditEvent,
  AutomationPermissionPolicyActionAuditIngestInput,
  AutomationPermissionPolicyActionAuditListInput,
} from "./automationPermissionAudit.ts";

const decodeEvent = Schema.decodeUnknownSync(AutomationPermissionPolicyActionAuditEvent);
const decodeIngestInput = Schema.decodeUnknownSync(AutomationPermissionPolicyActionAuditIngestInput);
const decodeListInput = Schema.decodeUnknownSync(AutomationPermissionPolicyActionAuditListInput);

describe("AutomationPermissionPolicyActionAuditEvent", () => {
  it("accepts a complete server-persistable audit event", () => {
    const parsed = decodeEvent({
      schemaVersion: AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION,
      id: "event-1",
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
    });

    expect(parsed.schemaVersion).toBe(AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION);
    expect(parsed.context?.persistence.scope).toBe("local-browser");
  });

  it("rejects unknown schema versions", () => {
    expect(() =>
      decodeEvent({
        schemaVersion: 99,
        id: "event-1",
        source: "chrome",
        actionKind: "chrome-downgrade-persistent-host",
        actionLabel: "改为本次会话",
        targetLabel: "billing.example.com",
        targetId: "billing.example.com",
        result: "success",
        occurredAt: "2026-07-01T10:00:00.000Z",
        detail: null,
        context: null,
      }),
    ).toThrow();
  });
});

describe("AutomationPermissionPolicyActionAudit service protocol", () => {
  it("accepts ingest batches and paged list inputs", () => {
    const event = decodeEvent({
      schemaVersion: AUTOMATION_PERMISSION_POLICY_ACTION_AUDIT_SCHEMA_VERSION,
      id: "event-2",
      source: "computer",
      actionKind: "computer-clear-persistent-apps",
      actionLabel: "清空始终允许 App",
      targetLabel: "Computer Use",
      targetId: "computer-clear-persistent-apps",
      result: "failure",
      occurredAt: "2026-07-01T10:05:00.000Z",
      detail: "清空失败。",
      context: null,
    });

    expect(
      decodeIngestInput({
        events: [event],
        idempotencyKey: "batch-1",
      }).events,
    ).toHaveLength(1);

    const query = decodeListInput({
      source: "computer",
      result: "failure",
      query: "Computer",
      occurredAfter: "2026-07-01T00:00:00.000Z",
      occurredBefore: "2026-07-02T00:00:00.000Z",
      limit: 50,
      cursor: "cursor-1",
    });

    expect(query.source).toBe("computer");
    expect(query.limit).toBe(50);
  });
});
