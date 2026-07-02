import assert from "node:assert/strict";
import type { OrchestrationGoal } from "@t3tools/contracts";
import { describe, it } from "vitest";

import { computeGoalElapsedMs, formatGoalDuration, mergeGoalTiming } from "./goal.ts";

const activeGoal: OrchestrationGoal = {
  objective: "完成目标",
  status: "active",
  updatedAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:00.000Z",
  activeSince: "2026-01-01T00:00:00.000Z",
  elapsedMs: 0,
  completedAt: null,
};

describe("goal timing", () => {
  it("formats goal durations with seconds, minutes, and hours", () => {
    assert.equal(formatGoalDuration(38_000), "38s");
    assert.equal(formatGoalDuration(17 * 60_000 + 38_000), "17m 38s");
    assert.equal(formatGoalDuration(3_723_000), "1h 02m 03s");
  });

  it("keeps active elapsed time moving and paused elapsed time fixed", () => {
    assert.equal(
      computeGoalElapsedMs(activeGoal, Date.parse("2026-01-01T00:00:38.000Z")),
      38_000,
    );
    assert.equal(
      computeGoalElapsedMs(
        { ...activeGoal, status: "paused", activeSince: null, elapsedMs: 38_000 },
        Date.parse("2026-01-01T00:10:00.000Z"),
      ),
      38_000,
    );
  });

  it("preserves elapsed lifecycle time across pause, resume, edit, and complete", () => {
    const paused = mergeGoalTiming(
      activeGoal,
      { ...activeGoal, status: "paused", updatedAt: "2026-01-01T00:00:10.000Z" },
      "2026-01-01T00:00:10.000Z",
    );
    assert.equal(paused.elapsedMs, 10_000);
    assert.equal(paused.activeSince, null);

    const resumed = mergeGoalTiming(
      paused,
      { ...paused, status: "active", updatedAt: "2026-01-01T00:00:20.000Z" },
      "2026-01-01T00:00:20.000Z",
    );
    assert.equal(resumed.elapsedMs, 10_000);
    assert.equal(resumed.activeSince, "2026-01-01T00:00:20.000Z");

    const edited = mergeGoalTiming(
      resumed,
      {
        ...resumed,
        objective: "新的目标",
        updatedAt: "2026-01-01T00:00:25.000Z",
      },
      "2026-01-01T00:00:25.000Z",
    );
    assert.equal(edited.startedAt, activeGoal.startedAt);
    assert.equal(edited.elapsedMs, 10_000);

    const completed = mergeGoalTiming(
      edited,
      { ...edited, status: "complete", updatedAt: "2026-01-01T00:00:30.000Z" },
      "2026-01-01T00:00:30.000Z",
    );
    assert.equal(completed.elapsedMs, 20_000);
    assert.equal(completed.activeSince, null);
    assert.equal(completed.completedAt, "2026-01-01T00:00:30.000Z");
  });
});
