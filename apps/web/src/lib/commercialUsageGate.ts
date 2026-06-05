import type { ServerProvider } from "@t3tools/contracts";

type ProviderUsage = NonNullable<NonNullable<ServerProvider["auth"]["rateLimits"]>["usage"]>;
type UsageWindow = NonNullable<ProviderUsage["currentWindow"]>;

export interface CommercialUsageLimitBlock {
  readonly reason: "current" | "weekly";
  readonly resetsAt: string | null;
}

function isWindowExhausted(window: UsageWindow | null | undefined): boolean {
  if (!window) return false;
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

function hasSpendableCredits(provider: ServerProvider | null | undefined): boolean {
  const credits = provider?.auth.rateLimits?.credits ?? null;
  if (!credits || credits.unlimited) return Boolean(credits?.unlimited);
  if (credits.hasCredits) return true;
  const numericBalance =
    typeof credits.balance === "string" ? Number(credits.balance.replace(/[^0-9.-]/g, "")) : 0;
  return Number.isFinite(numericBalance) && numericBalance > 0;
}

export function resolveCommercialUsageLimitBlock(
  provider: ServerProvider | null | undefined,
): CommercialUsageLimitBlock | null {
  const usage = provider?.auth.rateLimits?.usage ?? null;
  if (!usage) return null;
  if (hasSpendableCredits(provider)) return null;
  if (isWindowExhausted(usage.currentWindow)) {
    return {
      reason: "current",
      resetsAt: usage.currentWindow?.resetsAt ?? null,
    };
  }
  if (isWindowExhausted(usage.weeklyWindow)) {
    return {
      reason: "weekly",
      resetsAt: usage.weeklyWindow?.resetsAt ?? null,
    };
  }
  return null;
}

export function formatUsageLimitResetHint(block: CommercialUsageLimitBlock): string {
  const resetTime = formatUsageLimitResetTime(block.resetsAt);
  const windowLabel = block.reason === "weekly" ? "每周上限" : "当前用量";
  return resetTime
    ? `${windowLabel}已达上限，请升级套餐或等到 ${resetTime} 重置后继续。`
    : `${windowLabel}已达上限，请升级套餐或等待额度重置后继续。`;
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
