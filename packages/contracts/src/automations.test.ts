import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AutomationRun,
  AutomationSchedule,
  AutomationStreamEvent,
  AutomationTarget,
  AutomationUpsertInput,
} from "./automations.ts";

const decodeSchedule = Schema.decodeUnknownSync(AutomationSchedule);
const decodeTarget = Schema.decodeUnknownSync(AutomationTarget);
const decodeRun = Schema.decodeUnknownSync(AutomationRun);
const decodeUpsertInput = Schema.decodeUnknownSync(AutomationUpsertInput);
const decodeStreamEvent = Schema.decodeUnknownSync(AutomationStreamEvent);

describe("AutomationSchedule", () => {
  it("accepts interval, daily, weekly and cron schedules", () => {
    expect(decodeSchedule({ kind: "interval", minutes: 15 })).toEqual({
      kind: "interval",
      minutes: 15,
    });
    expect(decodeSchedule({ kind: "daily", time: "09:30" })).toEqual({
      kind: "daily",
      time: "09:30",
    });
    expect(decodeSchedule({ kind: "weekly", weekday: 1, time: "10:00" })).toEqual({
      kind: "weekly",
      weekday: 1,
      time: "10:00",
    });
    expect(decodeSchedule({ kind: "cron", expression: "0 9 * * 1" })).toEqual({
      kind: "cron",
      expression: "0 9 * * 1",
    });
  });

  it("rejects invalid interval and weekday values", () => {
    expect(() => decodeSchedule({ kind: "interval", minutes: 0 })).toThrow();
    expect(() => decodeSchedule({ kind: "weekly", weekday: 7, time: "10:00" })).toThrow();
  });
});

describe("AutomationTarget", () => {
  it("accepts project and thread targets", () => {
    expect(
      decodeTarget({
        kind: "project",
        projectId: "project-1",
        runMode: "worktree",
        baseBranch: "main",
      }),
    ).toEqual({
      kind: "project",
      projectId: "project-1",
      runMode: "worktree",
      baseBranch: "main",
    });
    expect(decodeTarget({ kind: "thread", threadId: "thread-1" })).toEqual({
      kind: "thread",
      threadId: "thread-1",
    });
  });
});

describe("AutomationRun", () => {
  it.each(["queued", "running", "completed", "failed", "skipped"] as const)(
    "accepts %s status",
    (status) => {
      const parsed = decodeRun({
        id: `run-${status}`,
        automationId: "automation-1",
        status,
        trigger: "manual",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: status === "queued" || status === "running" ? null : "2026-01-01T00:01:00.000Z",
        resultThreadId: status === "skipped" ? null : "thread-1",
        summary: null,
        error: status === "failed" ? "失败摘要" : null,
        archivedAt: null,
        readAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      expect(parsed.status).toBe(status);
    },
  );
});

describe("AutomationUpsertInput", () => {
  it("accepts a complete standalone project automation input", () => {
    const parsed = decodeUpsertInput({
      title: "每日简报",
      prompt: "总结最近一天的变更。",
      status: "enabled",
      schedule: { kind: "daily", time: "09:00" },
      target: { kind: "project", projectId: "project-1", runMode: "worktree" },
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "auto-accept-edits",
      interactionMode: "default",
    });

    expect(parsed.runtimeMode).toBe("auto-accept-edits");
    expect(parsed.target.kind).toBe("project");
  });
});

describe("AutomationStreamEvent", () => {
  it("accepts snapshot events with automation and run lists", () => {
    const parsed = decodeStreamEvent({
      kind: "snapshot",
      snapshot: {
        automations: [],
        runs: [],
      },
    });

    expect(parsed.kind).toBe("snapshot");
  });
});
