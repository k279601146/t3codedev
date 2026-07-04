import {
  normalizeProviderErrorMessage,
  sanitizeProviderErrorMessage as sanitizeSharedProviderErrorMessage,
} from "@t3tools/shared/providerErrors";

export interface FriendlyErrorMessage {
  readonly title: string;
  readonly description: string;
  readonly variant?: "error" | "warning";
  readonly primaryActionLabel?: string;
  readonly secondaryActionLabel?: string;
}

const INSUFFICIENT_BALANCE_PATTERNS = [
  /\bINSUFFICIENT_BALANCE\b/i,
  /insufficient account balance/i,
  /insufficient balance/i,
  /账户余额不足/,
] as const;

const USAGE_LIMIT_PATTERNS = [
  /\busage[_ -]?limit/i,
  /\brate[_ -]?limit/i,
  /workspace_.*_usage_limit_reached/i,
  /429\b/,
] as const;

const AUTH_PATTERNS = [/\b401\b/, /\bunauthorized\b/i, /\bauth(?:entication)?\b/i] as const;

export function resolveFriendlyErrorMessage(error: string): FriendlyErrorMessage {
  const normalizedError = normalizeProviderErrorMessage(error);
  const normalized = normalizedError?.message ?? error.trim();
  const source = `${error.trim()} ${normalized}`;

  if (
    normalizedError?.kind === "insufficient_balance" ||
    INSUFFICIENT_BALANCE_PATTERNS.some((pattern) => pattern.test(source))
  ) {
    return {
      title: "账户余额不足",
      description: normalized,
      variant: "warning",
      primaryActionLabel: "充值",
      secondaryActionLabel: "升级",
    };
  }

  if (
    normalizedError?.kind === "usage_limit" ||
    normalizedError?.kind === "rate_limited" ||
    USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(source))
  ) {
    return {
      title: "用量已达上限",
      description: normalized,
      variant: "warning",
      primaryActionLabel: "充值",
    };
  }

  if (
    normalizedError?.kind === "authentication" ||
    AUTH_PATTERNS.some((pattern) => pattern.test(source))
  ) {
    return {
      title: "需要重新登录",
      description: normalized,
      variant: "error",
    };
  }

  if (normalizedError?.kind === "forbidden" || /\b403\b|\bforbidden\b/i.test(source)) {
    return {
      title: "请求未被允许",
      description: normalized,
      variant: "error",
    };
  }

  if (normalizedError?.kind === "model_not_found") {
    return {
      title: "模型不可用",
      description: normalized,
      variant: "error",
    };
  }

  if (normalizedError?.kind === "service_unavailable") {
    return {
      title: "服务暂时不可用",
      description: normalized,
      variant: "error",
    };
  }

  if (
    normalizedError?.kind === "bad_request" ||
    normalizedError?.kind === "gateway_bad_response"
  ) {
    return {
      title: "请求未能完成",
      description: normalized,
      variant: "error",
    };
  }

  return {
    title: "请求失败",
    description: normalized,
    variant: "error",
  };
}

export function sanitizeProviderErrorMessage(message: string | null | undefined): string | null {
  return sanitizeSharedProviderErrorMessage(message);
}
