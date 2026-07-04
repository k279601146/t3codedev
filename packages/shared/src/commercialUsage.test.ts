import { describe, expect, it } from "vitest";

import {
  buildCommercialAccountUsageSnapshot,
  buildCommercialUsageLimitSnapshot,
} from "./commercialUsage.ts";

describe("commercial usage snapshot", () => {
  it("prefers gateway-provided usage windows", () => {
    const snapshot = buildCommercialUsageLimitSnapshot({
      data: {
        plan: "plus",
        current_window: {
          used_units: 122.7,
          limit_units: 200,
          remaining_units: 77.3,
          resets_at: "2026-05-27T03:00:00.000Z",
        },
        weekly_window: {
          used_units: 333.7,
          limit_units: 1_400,
          remaining_units: 1_066.3,
          resets_at: "2026-06-01T00:00:00.000Z",
        },
      },
    });

    expect(snapshot).toMatchObject({
      plan: "plus",
      planLabel: "AI Plus",
      planMultiplier: 2,
      currentWindow: {
        usedUnits: 122.7,
        limitUnits: 200,
        remainingUnits: 77.3,
        usedPercent: 61.35,
        resetsAt: "2026-05-27T03:00:00.000Z",
      },
      weeklyWindow: {
        usedUnits: 333.7,
        limitUnits: 1_400,
        remainingUnits: 1_066.3,
        usedPercent: 23.835714285714285,
        resetsAt: "2026-06-01T00:00:00.000Z",
      },
    });
  });

  it("does not treat raw token counters as product usage units", () => {
    const snapshot = buildCommercialAccountUsageSnapshot({
      account: { data: { user: { balance: 12.5 } } },
      usage: {
        data: {
          plan_type: "ai_pro",
          today_tokens: 100,
          total_tokens: 1_000,
          total_actual_cost: 0.12,
          today_actual_cost: 0.01,
        },
      },
    });

    expect(snapshot.plan).toBe("pro");
    expect(snapshot.planMultiplier).toBe(4);
    expect(snapshot.currentWindow.usedUnits).toBe(0.01);
    expect(snapshot.currentWindow.limitUnits).toBe(400);
    expect(snapshot.weeklyWindow.usedUnits).toBe(0);
    expect(snapshot.weeklyWindow.limitUnits).toBe(2_800);
    expect(snapshot.balance).toBe(12.5);
    expect(snapshot.totalActualCost).toBe(0.12);
    expect(snapshot.todayActualCost).toBe(0.01);
  });

  it("does not treat request count as product usage units", () => {
    const snapshot = buildCommercialUsageLimitSnapshot({
      data: {
        plan: "free",
        today_tokens: 9_565,
        total_tokens: 9_565,
        today_requests: 1,
      },
    });

    expect(snapshot.currentWindow.usedUnits).toBe(0);
    expect(snapshot.currentWindow.limitUnits).toBe(100);
    expect(snapshot.weeklyWindow.usedUnits).toBe(0);
    expect(snapshot.planLabel).toBe("Free");
  });

  it("reads dev2-compatible current_window and weekly fields", () => {
    const snapshot = buildCommercialUsageLimitSnapshot({
      data: {
        plan: "free",
        current_window: {
          used: 1.25,
          limit: 100,
          reset_at: "2026-05-27T18:00:00Z",
        },
        weekly: {
          used: 2.5,
          limit: 700,
          reset_at: "2026-06-01T00:00:00Z",
        },
      },
    });

    expect(snapshot.currentWindow).toMatchObject({
      usedUnits: 1.25,
      limitUnits: 100,
      resetsAt: "2026-05-27T18:00:00Z",
    });
    expect(snapshot.weeklyWindow).toMatchObject({
      usedUnits: 2.5,
      limitUnits: 700,
      resetsAt: "2026-06-01T00:00:00Z",
    });
  });

  it("caps current window remaining units by weekly remaining units", () => {
    const snapshot = buildCommercialUsageLimitSnapshot({
      data: {
        plan: "free",
        current_window: {
          used_units: 20,
          limit_units: 100,
          remaining_units: 80,
          resets_at: "2026-05-27T03:00:00.000Z",
        },
        weekly_window: {
          used_units: 695,
          limit_units: 700,
          remaining_units: 5,
          resets_at: "2026-06-01T00:00:00.000Z",
        },
      },
    });

    expect(snapshot.currentWindow.remainingUnits).toBe(5);
    expect(snapshot.currentWindow.resetsAt).toBe("2026-05-27T03:00:00.000Z");
  });

  it("uses weekly reset for current window when weekly limit is full", () => {
    const snapshot = buildCommercialUsageLimitSnapshot({
      data: {
        plan: "free",
        current_window: {
          used_units: 0,
          limit_units: 100,
          remaining_units: 100,
          resets_at: "2026-05-27T03:00:00.000Z",
        },
        weekly_window: {
          used_units: 700,
          limit_units: 700,
          remaining_units: 0,
          resets_at: "2026-06-01T00:00:00.000Z",
        },
      },
    });

    expect(snapshot.currentWindow.remainingUnits).toBe(0);
    expect(snapshot.currentWindow.resetsAt).toBe("2026-06-01T00:00:00.000Z");
  });
});
