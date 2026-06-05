import { describe, expect, it } from "vitest";
import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import { resolveCommercialUsageLimitBlock } from "./commercialUsageGate";

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
});
