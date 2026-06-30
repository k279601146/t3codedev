import { describe, expect, it } from "vitest";
import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import {
  buildCommercialUsageLimitToastCopy,
  formatUsageLimitResetHint,
  resolveCommercialUsageLimitBlock,
  resolveCommercialUsageModelRecommendation,
} from "./commercialUsageGate";

function providerWithUsage(
  usage: NonNullable<NonNullable<ServerProvider["auth"]["rateLimits"]>["usage"]>,
  credits?: NonNullable<NonNullable<ServerProvider["auth"]["rateLimits"]>["credits"]>,
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: "codex",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: {
      status: "authenticated",
      rateLimits: {
        usage,
        ...(credits ? { credits } : {}),
      },
    },
    checkedAt: "2026-05-27T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  } as unknown as ServerProvider;
}

describe("商业用量发送门禁", () => {
  it("当前窗口满额时阻止发送", () => {
    const block = resolveCommercialUsageLimitBlock(
      providerWithUsage({
        plan: "free",
        currentWindow: {
          usedUnits: 200,
          limitUnits: 200,
          usedPercent: 100,
          resetsAt: "2026-05-27T03:00:00.000Z",
        },
        weeklyWindow: {
          usedUnits: 300,
          limitUnits: 1_400,
          usedPercent: 21,
          resetsAt: "2026-06-01T00:00:00.000Z",
        },
        totalTokens: 300,
      }),
    );

    expect(block).toEqual({
      reason: "current",
      resetsAt: "2026-05-27T03:00:00.000Z",
    });
  });

  it("每周窗口满额时阻止发送", () => {
    const block = resolveCommercialUsageLimitBlock(
      providerWithUsage({
        plan: "free",
        currentWindow: {
          usedUnits: 10,
          limitUnits: 200,
          usedPercent: 5,
          resetsAt: null,
        },
        weeklyWindow: {
          usedUnits: 1_500,
          limitUnits: 1_400,
          usedPercent: 99,
          resetsAt: "2026-06-01T00:00:00.000Z",
        },
        totalTokens: 1_500,
      }),
    );

    expect(block?.reason).toBe("weekly");
  });

  it("有可用积分余额时允许超出窗口额度继续发送", () => {
    const block = resolveCommercialUsageLimitBlock(
      providerWithUsage(
        {
          plan: "free",
          currentWindow: {
            usedUnits: 200,
            limitUnits: 200,
            usedPercent: 100,
            resetsAt: "2026-05-27T03:00:00.000Z",
          },
          weeklyWindow: {
            usedUnits: 300,
            limitUnits: 1_400,
            usedPercent: 21,
            resetsAt: "2026-06-01T00:00:00.000Z",
          },
          totalTokens: 300,
        },
        { balance: "$12", hasCredits: true, unlimited: false },
      ),
    );

    expect(block).toBeNull();
  });

  it("为当前窗口满额生成升级和账单操作文案", () => {
    const copy = buildCommercialUsageLimitToastCopy({
      reason: "current",
      resetsAt: "2026-05-27T03:00:00.000Z",
    });

    expect(copy.title).toBe("当前 5 小时额度已用完");
    expect(copy.description).toContain("升级套餐");
    expect(copy.primaryActionLabel).toBe("升级套餐");
    expect(copy.primaryActionPath).toBe("/pricing");
    expect(copy.secondaryActionLabel).toBe("查看账单");
    expect(copy.secondaryActionPath).toBe("/account/billing");
  });

  it("为每周窗口满额生成明确标题", () => {
    const copy = buildCommercialUsageLimitToastCopy({
      reason: "weekly",
      resetsAt: null,
    });

    expect(copy.title).toBe("每周额度已用完");
    expect(copy.description).toContain("下个窗口");
  });

  it("无重置时间时保留兼容提示", () => {
    expect(formatUsageLimitResetHint({ reason: "current", resetsAt: null })).toBe(
      "当前用量已达上限，请升级套餐或等待额度重置后继续。",
    );
  });

  it("当前窗口接近上限时推荐省额度模型", () => {
    const recommendation = resolveCommercialUsageModelRecommendation(
      providerWithUsage({
        plan: "free",
        currentWindow: {
          usedUnits: 170,
          limitUnits: 200,
          usedPercent: 85,
          resetsAt: "2026-05-27T03:00:00.000Z",
        },
        weeklyWindow: {
          usedUnits: 300,
          limitUnits: 1_400,
          usedPercent: 21,
          resetsAt: "2026-06-01T00:00:00.000Z",
        },
        totalTokens: 300,
      }),
    );

    expect(recommendation).toEqual({
      reason: "current",
      usedPercent: 85,
      thresholdPercent: 80,
    });
  });

  it("满额和无限额度时不再给省额度预警", () => {
    const exhaustedProvider = providerWithUsage({
      plan: "free",
      currentWindow: {
        usedUnits: 200,
        limitUnits: 200,
        usedPercent: 100,
        resetsAt: "2026-05-27T03:00:00.000Z",
      },
      weeklyWindow: {
        usedUnits: 300,
        limitUnits: 1_400,
        usedPercent: 21,
        resetsAt: "2026-06-01T00:00:00.000Z",
      },
      totalTokens: 300,
    });
    const unlimitedProvider = providerWithUsage(
      {
        plan: "pro",
        currentWindow: {
          usedUnits: 170,
          limitUnits: 200,
          usedPercent: 85,
          resetsAt: null,
        },
        weeklyWindow: null,
        totalTokens: 300,
      },
      { balance: null, hasCredits: true, unlimited: true },
    );

    expect(resolveCommercialUsageModelRecommendation(exhaustedProvider)).toBeNull();
    expect(resolveCommercialUsageModelRecommendation(unlimitedProvider)).toBeNull();
  });
});
