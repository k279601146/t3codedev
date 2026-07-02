import type { ServerProvider } from "@t3tools/contracts";

type ProviderUsage = NonNullable<
  NonNullable<ServerProvider["auth"]["rateLimits"]>["usage"]
>;
type UsageWindow = NonNullable<ProviderUsage["currentWindow"]>;

export interface CommercialUsageLimitBlock {
  readonly reason: "current" | "weekly";
  readonly resetsAt: string | null;
}

export interface CommercialUsageLimitToastCopy {
  readonly title: string;
  readonly description: string;
  readonly primaryActionLabel: string;
  readonly primaryActionPath: "/pricing";
  readonly secondaryActionLabel: string;
  readonly secondaryActionPath: "/account/billing";
}

export interface CommercialUsageModelRecommendation {
  readonly reason: "current" | "weekly";
  readonly usedPercent: number;
  readonly thresholdPercent: number;
}

const USAGE_TIGHT_THRESHOLD_PERCENT = 80;
const COMMERCIAL_TURN_RESERVE_UNITS = 8;

function isWindowExhausted(window: UsageWindow | null | undefined): boolean {
  if (!window) return false;
  const remainingUnits = window.remainingUnits;
  if (typeof remainingUnits === "number" && Number.isFinite(remainingUnits) && remainingUnits <= 0) {
    return true;
  }
  if (Number.isFinite(window.usedPercent) && window.usedPercent >= 100) {
    return true;
  }
  return (
    Number.isFinite(window.usedUnits) &&
    Number.isFinite(window.limitUnits) &&
    window.limitUnits > 0 &&
    window.usedUnits >= window.limitUnits
  );
}

function readSpendableCreditUnits(
  provider: ServerProvider | null | undefined,
): number | "unlimited" {
  const credits = provider?.auth.rateLimits?.credits ?? null;
  if (!credits) return 0;
  if (credits.unlimited) return "unlimited";
  const numericBalance =
    typeof credits.balance === "string"
      ? Number(credits.balance.replace(/[^0-9.-]/g, ""))
      : 0;
  if (Number.isFinite(numericBalance) && numericBalance > 0)
    return numericBalance;
  return credits.hasCredits ? COMMERCIAL_TURN_RESERVE_UNITS : 0;
}

function readWindowRemainingUnits(
  window: UsageWindow | null | undefined,
): number | null {
  if (!window) return null;
  const remainingUnits = window.remainingUnits;
  if (typeof remainingUnits === "number" && Number.isFinite(remainingUnits)) {
    return Math.max(remainingUnits, 0);
  }
  if (Number.isFinite(window.usedUnits) && Number.isFinite(window.limitUnits)) {
    return Math.max(window.limitUnits - window.usedUnits, 0);
  }
  return null;
}

function windowLacksReserve(window: UsageWindow | null | undefined): boolean {
  const remaining = readWindowRemainingUnits(window);
  return remaining !== null && remaining < COMMERCIAL_TURN_RESERVE_UNITS;
}

function bonusBalanceCoversReserve(
  provider: ServerProvider | null | undefined,
): boolean {
  const usage = provider?.auth.rateLimits?.usage ?? null;
  if (!usage) return false;
  const credits = readSpendableCreditUnits(provider);
  if (credits === "unlimited") return true;
  const currentRemaining = readWindowRemainingUnits(usage.currentWindow);
  const weeklyRemaining = readWindowRemainingUnits(usage.weeklyWindow);
  if (currentRemaining === null || weeklyRemaining === null)
    return credits >= COMMERCIAL_TURN_RESERVE_UNITS;
  const quotaRemaining = Math.min(currentRemaining, weeklyRemaining);
  const bonusRequired = Math.max(
    COMMERCIAL_TURN_RESERVE_UNITS - quotaRemaining,
    0,
  );
  return bonusRequired <= 0 || credits >= bonusRequired;
}

export function resolveCommercialUsageLimitBlock(
  provider: ServerProvider | null | undefined,
): CommercialUsageLimitBlock | null {
  const usage = provider?.auth.rateLimits?.usage ?? null;
  if (!usage) return null;
  if (bonusBalanceCoversReserve(provider)) return null;
  if (
    isWindowExhausted(usage.weeklyWindow) ||
    windowLacksReserve(usage.weeklyWindow)
  ) {
    return {
      reason: "weekly",
      resetsAt: usage.weeklyWindow?.resetsAt ?? null,
    };
  }
  if (
    isWindowExhausted(usage.currentWindow) ||
    windowLacksReserve(usage.currentWindow)
  ) {
    return {
      reason: "current",
      resetsAt: usage.currentWindow?.resetsAt ?? null,
    };
  }
  return null;
}

export function formatUsageLimitResetHint(
  block: CommercialUsageLimitBlock,
): string {
  const resetTime = formatUsageLimitResetTime(block.resetsAt);
  const windowLabel = block.reason === "weekly" ? "每周上限" : "当前用量";
  return resetTime
    ? `${windowLabel}已达上限，请升级套餐或等到 ${resetTime} 重置后继续。`
    : `${windowLabel}已达上限，请升级套餐或等待额度重置后继续。`;
}

export function buildCommercialUsageLimitToastCopy(
  block: CommercialUsageLimitBlock,
): CommercialUsageLimitToastCopy {
  const resetTime = formatUsageLimitResetTime(block.resetsAt);
  const isWeekly = block.reason === "weekly";
  const title = isWeekly ? "每周额度已用完" : "当前 5 小时额度已用完";
  const resetHint = resetTime
    ? `额度将在 ${resetTime} 重置。`
    : "额度会在下个窗口重置。";

  return {
    title,
    description: `${resetHint} 可以升级套餐提升额度，或查看账单确认余额。`,
    primaryActionLabel: "升级套餐",
    primaryActionPath: "/pricing",
    secondaryActionLabel: "查看账单",
    secondaryActionPath: "/account/billing",
  };
}

function readWindowUsedPercent(
  window: UsageWindow | null | undefined,
): number | null {
  if (!window) return null;
  if (Number.isFinite(window.usedPercent)) {
    return window.usedPercent;
  }
  if (
    Number.isFinite(window.usedUnits) &&
    Number.isFinite(window.limitUnits) &&
    window.limitUnits > 0
  ) {
    return (window.usedUnits / window.limitUnits) * 100;
  }
  return null;
}

function buildUsageModelRecommendationCandidate(
  reason: CommercialUsageModelRecommendation["reason"],
  window: UsageWindow | null | undefined,
): CommercialUsageModelRecommendation | null {
  if (isWindowExhausted(window)) return null;
  const usedPercent = readWindowUsedPercent(window);
  if (usedPercent === null || usedPercent < USAGE_TIGHT_THRESHOLD_PERCENT) {
    return null;
  }
  return {
    reason,
    usedPercent,
    thresholdPercent: USAGE_TIGHT_THRESHOLD_PERCENT,
  };
}

export function resolveCommercialUsageModelRecommendation(
  provider: ServerProvider | null | undefined,
): CommercialUsageModelRecommendation | null {
  const usage = provider?.auth.rateLimits?.usage ?? null;
  if (!usage) return null;
  if (provider?.auth.rateLimits?.credits?.unlimited) return null;

  const candidates = [
    buildUsageModelRecommendationCandidate("current", usage.currentWindow),
    buildUsageModelRecommendationCandidate("weekly", usage.weeklyWindow),
  ].filter(
    (candidate): candidate is CommercialUsageModelRecommendation =>
      candidate !== null,
  );

  return (
    candidates.toSorted(
      (left, right) => right.usedPercent - left.usedPercent,
    )[0] ?? null
  );
}

function formatUsageLimitResetTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
