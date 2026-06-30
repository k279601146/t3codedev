import { describe, expect, it } from "vitest";
import type {
  DesktopBrowserExternalAutomationState,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";

import {
  appendAutomationPermissionPolicyActionAuditEvent,
  buildBrowserExternalPermissionAuditItems,
  buildComputerPermissionAuditItems,
  buildAutomationPermissionPolicyActions,
  buildAutomationPermissionPolicyHints,
  buildAutomationPermissionPolicyEntries,
  createAutomationPermissionPolicyActionAuditEvent,
  normalizeAutomationPermissionPolicyActionAuditEvents,
  summarizeAutomationPermissionAudit,
  summarizeAutomationPermissionPolicyActionAudit,
} from "./automationPermissionAudit";

const NOW = "2026-06-30T00:00:00.000Z";

describe("automation permission audit", () => {
  it("summarizes Chrome allow and block host permissions", () => {
    const state = {
      endpoint: "http://127.0.0.1:13773/browser-external",
      token: "token",
      connected: true,
      extensionId: "extension",
      browserName: "Chrome",
      profileName: "Default",
      selectedTabId: null,
      tabs: [],
      permissions: [
        {
          host: "example.com",
          decision: "allow",
          scope: "session",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
        {
          host: "billing.example.com",
          decision: "block",
          scope: "always",
          updatedAt: "2026-06-30T00:05:00.000Z",
        },
      ],
      lastError: null,
      lastToolCallAt: null,
      toolCallSequence: 0,
      updatedAt: NOW,
    } satisfies DesktopBrowserExternalAutomationState;

    const items = buildBrowserExternalPermissionAuditItems(state);

    expect(items.map((item) => [item.subject, item.decision, item.scope])).toEqual([
      ["billing.example.com", "block", "always"],
      ["example.com", "allow", "session"],
    ]);
    expect(summarizeAutomationPermissionAudit(items)).toEqual({
      total: 2,
      allowed: 1,
      blocked: 1,
      lastUpdatedAt: "2026-06-30T00:05:00.000Z",
    });
    expect(buildAutomationPermissionPolicyHints(items).map((hint) => hint.id)).toEqual([
      "blocked-records",
      "session-only-allow",
    ]);
  });

  it("flags persistent and sensitive Chrome host permissions", () => {
    const state = {
      endpoint: "http://127.0.0.1:13773/browser-external",
      token: "token",
      connected: true,
      extensionId: "extension",
      browserName: "Chrome",
      profileName: "Default",
      selectedTabId: null,
      tabs: [],
      permissions: [
        {
          host: "billing.example.com",
          decision: "allow",
          scope: "always",
          updatedAt: "2026-06-30T00:05:00.000Z",
        },
      ],
      lastError: null,
      lastToolCallAt: null,
      toolCallSequence: 0,
      updatedAt: NOW,
    } satisfies DesktopBrowserExternalAutomationState;

    const hints = buildAutomationPermissionPolicyHints(
      buildBrowserExternalPermissionAuditItems(state),
    );

    expect(hints.map((hint) => [hint.id, hint.tone])).toEqual([
      ["sensitive-host-allow", "danger"],
      ["chrome-persistent-allow", "warning"],
    ]);
    expect(
      buildAutomationPermissionPolicyEntries(
        buildBrowserExternalPermissionAuditItems(state),
        "chrome",
      ),
    ).toMatchObject([
      {
        id: "sensitive-host-confirmation",
        status: "action-required",
        current: "1 个敏感站点已持久允许。",
        actionLabel: "改为本次会话或阻止",
      },
      {
        id: "chrome-session-scope-preferred",
        status: "review",
        current: "1 个 Chrome 站点已持久允许。",
      },
    ]);
    expect(
      buildAutomationPermissionPolicyActions(
        buildBrowserExternalPermissionAuditItems(state),
        "chrome",
      ),
    ).toEqual([
      {
        id: "chrome-downgrade:billing.example.com",
        source: "chrome",
        kind: "chrome-downgrade-persistent-host",
        label: "改为本次会话",
        detail: "billing.example.com 将保留允许，但不再跨会话持久保存。",
        targetLabel: "billing.example.com",
        host: "billing.example.com",
      },
    ]);
  });

  it("uses Computer permission last-used time for recent audit order", () => {
    const state = {
      endpoint: "http://127.0.0.1:13773/computer",
      platform: "win32",
      available: true,
      paused: false,
      allowedApps: [
        {
          appKey: "process:notepad",
          displayName: "Notepad",
          processName: "notepad.exe",
          title: "Notes",
          allowedAt: "2026-06-30T00:00:00.000Z",
          lastUsedAt: "2026-06-30T00:20:00.000Z",
        },
        {
          appKey: "process:code",
          displayName: "Code",
          processName: "Code.exe",
          title: "Editor",
          allowedAt: "2026-06-30T00:10:00.000Z",
          lastUsedAt: null,
        },
      ],
      virtualScreen: null,
      cursor: null,
      foregroundWindow: null,
      selectedWindow: null,
      lastAction: null,
      lastError: null,
      lastScreenshotDataUrl: null,
      lastScreenshotPath: null,
      lastToolCallAt: null,
      toolCallSequence: 0,
      updatedAt: NOW,
    } satisfies DesktopComputerAutomationState;

    const items = buildComputerPermissionAuditItems(state);

    expect(items.map((item) => item.subject)).toEqual(["Notepad", "Code"]);
    expect(summarizeAutomationPermissionAudit(items)).toMatchObject({
      total: 2,
      allowed: 2,
      blocked: 0,
      lastUpdatedAt: "2026-06-30T00:20:00.000Z",
    });
    expect(buildAutomationPermissionPolicyHints(items)).toEqual([
      {
        id: "computer-persistent-allow",
        tone: "warning",
        title: "存在始终允许 App",
        detail: "2 个 App 可以跳过每次确认，适合只保留高信任目标。",
      },
    ]);
    expect(buildAutomationPermissionPolicyEntries(items, "computer")).toMatchObject([
      {
        id: "computer-persistent-allow-minimized",
        status: "review",
        current: "2 个 App 可以跳过每次确认。",
        actionLabel: "清理低频或低信任 App",
      },
      {
        id: "computer-approval-default",
        status: "satisfied",
        current: "未在允许列表内的 App 仍会请求确认。",
      },
    ]);
    expect(buildAutomationPermissionPolicyActions(items, "computer")).toEqual([
      {
        id: "computer-clear-persistent-apps",
        source: "computer",
        kind: "computer-clear-persistent-apps",
        label: "清空始终允许 App",
        detail: "2 个 App 将恢复为使用前确认。",
        targetLabel: "Computer Use",
      },
    ]);
  });

  it("keeps empty Chrome and Computer policy baselines satisfied", () => {
    expect(buildAutomationPermissionPolicyEntries([], "chrome")).toMatchObject([
      {
        id: "sensitive-host-confirmation",
        status: "satisfied",
        current: "未发现敏感站点允许记录。",
      },
      {
        id: "chrome-session-scope-preferred",
        status: "satisfied",
        current: "没有持久 Chrome 站点授权。",
      },
    ]);
    expect(buildAutomationPermissionPolicyEntries([], "computer")).toMatchObject([
      {
        id: "computer-persistent-allow-minimized",
        status: "satisfied",
        current: "没有始终允许的 App。",
      },
      {
        id: "computer-approval-default",
        status: "satisfied",
        current: "所有 App 都会在使用前请求确认。",
      },
    ]);
    expect(buildAutomationPermissionPolicyActions([], "all")).toEqual([]);
  });

  it("records and summarizes policy action audit events", () => {
    const action = buildAutomationPermissionPolicyActions(
      [
        {
          id: "chrome:billing.example.com",
          source: "chrome",
          subject: "billing.example.com",
          decision: "allow",
          scope: "always",
          updatedAt: "2026-06-30T00:05:00.000Z",
          lastUsedAt: null,
          detail: "Chrome 站点权限已持久保存。",
        },
      ],
      "chrome",
    )[0]!;
    const event = createAutomationPermissionPolicyActionAuditEvent({
      action,
      result: "success",
      occurredAt: "2026-06-30T00:10:00.000Z",
      detail: "已改为本次会话授权。",
    });

    expect(event).toEqual({
      id: "2026-06-30T00:10:00.000Z:success:chrome-downgrade:billing.example.com",
      source: "chrome",
      actionKind: "chrome-downgrade-persistent-host",
      actionLabel: "改为本次会话",
      targetLabel: "billing.example.com",
      targetId: "billing.example.com",
      result: "success",
      occurredAt: "2026-06-30T00:10:00.000Z",
      detail: "已改为本次会话授权。",
    });
    expect(
      appendAutomationPermissionPolicyActionAuditEvent(
        [
          createAutomationPermissionPolicyActionAuditEvent({
            action,
            result: "failure",
            occurredAt: "2026-06-30T00:09:00.000Z",
            detail: "失败",
          }),
        ],
        event,
        1,
      ),
    ).toEqual([event]);
    expect(summarizeAutomationPermissionPolicyActionAudit([event])).toEqual({
      total: 1,
      succeeded: 1,
      failed: 0,
      lastOccurredAt: "2026-06-30T00:10:00.000Z",
    });
    expect(normalizeAutomationPermissionPolicyActionAuditEvents([event, { id: "bad" }])).toEqual([
      event,
    ]);
  });
});
