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
] as const;

const USAGE_LIMIT_PATTERNS = [
  /\busage[_ -]?limit/i,
  /\brate[_ -]?limit/i,
  /workspace_.*_usage_limit_reached/i,
  /429\b/,
] as const;

const AUTH_PATTERNS = [/\b401\b/, /\bunauthorized\b/i, /\bauth(?:entication)?\b/i] as const;

export function resolveFriendlyErrorMessage(error: string): FriendlyErrorMessage {
  const normalized = error.trim();

  if (INSUFFICIENT_BALANCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      title: "Your Codex message limit is used up",
      description:
        "Your account does not have enough balance to continue this request. Add credits or upgrade your plan, then send the message again.",
      variant: "warning",
      primaryActionLabel: "Upgrade",
      secondaryActionLabel: "Add credits",
    };
  }

  if (USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      title: "Usage limit reached",
      description:
        "This account has reached a current usage limit. Wait for the limit to reset, add credits, or switch to another account.",
      variant: "warning",
      primaryActionLabel: "Add credits",
    };
  }

  if (AUTH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      title: "Sign-in required",
      description:
        "Your account session could not be used for this request. Sign in again and retry.",
      variant: "error",
    };
  }

  if (/\b403\b|\bforbidden\b/i.test(normalized)) {
    return {
      title: "Request not allowed",
      description:
        "The provider rejected this request. Check your account, model access, or workspace permissions.",
      variant: "error",
    };
  }

  return {
    title: "Request failed",
    description: normalized,
    variant: "error",
  };
}

export function sanitizeProviderErrorMessage(message: string | null | undefined): string | null {
  if (message == null) {
    return null;
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}
