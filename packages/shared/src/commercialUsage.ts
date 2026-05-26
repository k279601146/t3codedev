import type {
  CommercialAccountUsageSchema,
  CommercialSubscriptionPlanSchema,
  CommercialUsageWindowSchema,
} from "@t3tools/contracts";

export type CommercialPlan = CommercialSubscriptionPlanSchema;

export interface CommercialUsageLimitSnapshot {
  readonly plan: CommercialPlan;
  readonly planLabel: string;
  readonly planMultiplier: number;
  readonly currentWindow: CommercialUsageWindowSchema;
  readonly weeklyWindow: CommercialUsageWindowSchema;
}

const COMMERCIAL_PLAN_DETAILS: Record<
  CommercialPlan,
  { readonly label: string; readonly multiplier: number }
> = {
  free: { label: "未订阅方案", multiplier: 1 },
  plus: { label: "AI Plus", multiplier: 2 },
  pro: { label: "AI Pro", multiplier: 4 },
};

export function commercialPlanDetails(plan: CommercialPlan): {
  readonly label: string;
  readonly multiplier: number;
} {
  return COMMERCIAL_PLAN_DETAILS[plan];
}

export function normalizeCommercialPlan(value: string | null | undefined): CommercialPlan {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized.includes("pro")) return "pro";
  if (normalized.includes("plus")) return "plus";
  return "free";
}

export function readCommercialNumber(value: unknown, path: readonly string[]): number | null {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

export function readCommercialString(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function buildUsageWindow(input: {
  readonly fallbackLimitUnits: number;
  readonly limitUnits: number | null;
  readonly resetsAt: string | null;
  readonly usedUnits: number | null;
}): CommercialUsageWindowSchema {
  const limitUnits =
    input.limitUnits !== null && input.limitUnits > 0 ? input.limitUnits : input.fallbackLimitUnits;
  const usedUnits = Math.max(0, input.usedUnits ?? 0);
  const usedPercent = limitUnits > 0 ? clampPercent((usedUnits / limitUnits) * 100) : 0;
  return {
    usedUnits,
    limitUnits,
    usedPercent,
    resetsAt: input.resetsAt,
  };
}

export function nextFiveHourResetIso(nowMs: number): string {
  const hoursSinceEpoch = Math.floor(nowMs / 3_600_000);
  const nextBucket = Math.floor(hoursSinceEpoch / 5) * 5 + 5;
  // @effect-diagnostics-next-line globalDate:off
  return new Date(nextBucket * 3_600_000).toISOString();
}

export function nextWeeklyResetIso(nowMs: number): string {
  // @effect-diagnostics-next-line globalDate:off
  const now = new Date(nowMs);
  const day = now.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  const midnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // @effect-diagnostics-next-line globalDate:off
  return new Date(midnightUtc + daysUntilMonday * 86_400_000).toISOString();
}

export function buildCommercialUsageLimitSnapshot(usage: unknown): CommercialUsageLimitSnapshot {
  const plan = normalizeCommercialPlan(
    readCommercialString(usage, ["data", "plan"]) ??
      readCommercialString(usage, ["data", "plan_type"]),
  );
  const planDetails = commercialPlanDetails(plan);
  const fallbackCurrentLimit = 200 * planDetails.multiplier;
  const fallbackWeeklyLimit = 1_400 * planDetails.multiplier;

  return {
    plan,
    planLabel: planDetails.label,
    planMultiplier: planDetails.multiplier,
    currentWindow: buildUsageWindow({
      usedUnits:
        readCommercialNumber(usage, ["data", "current_window", "used_units"]) ??
        readCommercialNumber(usage, ["data", "current_window_units"]) ??
        readCommercialNumber(usage, ["data", "today_tokens"]),
      limitUnits:
        readCommercialNumber(usage, ["data", "current_window", "limit_units"]) ??
        readCommercialNumber(usage, ["data", "current_window_limit"]),
      resetsAt:
        readCommercialString(usage, ["data", "current_window", "resets_at"]) ??
        readCommercialString(usage, ["data", "current_window_resets_at"]) ??
        nextFiveHourResetIso(currentTimeMs()),
      fallbackLimitUnits: fallbackCurrentLimit,
    }),
    weeklyWindow: buildUsageWindow({
      usedUnits:
        readCommercialNumber(usage, ["data", "weekly_window", "used_units"]) ??
        readCommercialNumber(usage, ["data", "weekly_units"]) ??
        readCommercialNumber(usage, ["data", "total_tokens"]),
      limitUnits:
        readCommercialNumber(usage, ["data", "weekly_window", "limit_units"]) ??
        readCommercialNumber(usage, ["data", "weekly_limit"]),
      resetsAt:
        readCommercialString(usage, ["data", "weekly_window", "resets_at"]) ??
        readCommercialString(usage, ["data", "weekly_resets_at"]) ??
        nextWeeklyResetIso(currentTimeMs()),
      fallbackLimitUnits: fallbackWeeklyLimit,
    }),
  };
}

export function buildCommercialAccountUsageSnapshot(input: {
  readonly account: unknown;
  readonly usage: unknown;
}): CommercialAccountUsageSchema {
  return {
    balance:
      readCommercialNumber(input.account, ["data", "user", "balance"]) ??
      readCommercialNumber(input.account, ["data", "balance"]),
    ...buildCommercialUsageLimitSnapshot(input.usage),
    totalTokens: readCommercialNumber(input.usage, ["data", "total_tokens"]) ?? 0,
    todayTokens: readCommercialNumber(input.usage, ["data", "today_tokens"]),
    totalActualCost: readCommercialNumber(input.usage, ["data", "total_actual_cost"]),
    todayActualCost: readCommercialNumber(input.usage, ["data", "today_actual_cost"]),
  };
}

function currentTimeMs(): number {
  // @effect-diagnostics-next-line globalDate:off
  return Date.now();
}
