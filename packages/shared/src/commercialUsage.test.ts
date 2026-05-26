import { describe, expect, it } from "vitest";

import {
  buildCommercialAccountUsageSnapshot,
  buildCommercialUsageLimitSnapshot,
} from "./commercialUsage.ts";

describe("商业用量快照", () => {
  it("优先使用网关返回的窗口限额", () => {
    const snapshot = buildCommercialUsageLimitSnapshot({
      data: {
        plan: "plus",
        current_window: {
          used_units: 122.7,
          limit_units: 200,
          resets_at: "2026-05-27T03:00:00.000Z",
        },
        weekly_window: {
          used_units: 333.7,
          limit_units: 1_400,
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
        usedPercent: 61.35,
        resetsAt: "2026-05-27T03:00:00.000Z",
      },
      weeklyWindow: {
        usedUnits: 333.7,
        limitUnits: 1_400,
        usedPercent: 23.835714285714285,
        resetsAt: "2026-06-01T00:00:00.000Z",
      },
    });
  });

  it("在旧网关只返回 token 时派生基础窗口", () => {
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
    expect(snapshot.currentWindow.usedUnits).toBe(100);
    expect(snapshot.currentWindow.limitUnits).toBe(800);
    expect(snapshot.weeklyWindow.usedUnits).toBe(1_000);
    expect(snapshot.weeklyWindow.limitUnits).toBe(5_600);
    expect(snapshot.balance).toBe(12.5);
    expect(snapshot.totalActualCost).toBe(0.12);
    expect(snapshot.todayActualCost).toBe(0.01);
  });
});
