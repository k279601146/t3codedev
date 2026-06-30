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

interface ParsedProviderError {
  readonly statusCode: number | null;
  readonly body: string;
  readonly requestId: string | null;
}

interface ParsedErrorBody {
  readonly code: string | null;
  readonly message: string;
}

export function resolveFriendlyErrorMessage(error: string): FriendlyErrorMessage {
  const normalized = sanitizeProviderErrorMessage(error) ?? error.trim();
  const source = `${error.trim()} ${normalized}`;

  if (INSUFFICIENT_BALANCE_PATTERNS.some((pattern) => pattern.test(source))) {
    return {
      title: "账户余额不足",
      description: normalized,
      variant: "warning",
      primaryActionLabel: "充值",
      secondaryActionLabel: "升级",
    };
  }

  if (USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(source))) {
    return {
      title: "用量已达上限",
      description: normalized,
      variant: "warning",
      primaryActionLabel: "充值",
    };
  }

  if (AUTH_PATTERNS.some((pattern) => pattern.test(source))) {
    return {
      title: "需要重新登录",
      description: normalized,
      variant: "error",
    };
  }

  if (/\b403\b|\bforbidden\b/i.test(source)) {
    return {
      title: "请求未被允许",
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
  if (message == null) {
    return null;
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return normalizeProviderErrorForUser(trimmed);
}

function normalizeProviderErrorForUser(message: string): string {
  const parsed = parseUnexpectedStatusError(message);
  if (!parsed) {
    const body = parseErrorBody(message);
    const translated = translateProviderError(body, null);
    return translated === body.message ? message : formatUserFacingError(translated, null);
  }

  const body = parseErrorBody(parsed.body);
  return formatUserFacingError(translateProviderError(body, parsed.statusCode), parsed.requestId);
}

function parseUnexpectedStatusError(message: string): ParsedProviderError | null {
  const match = /^unexpected status\s+(\d{3})(?:\s+[^:]+)?:\s*/i.exec(message);
  if (!match?.[1]) {
    return null;
  }

  const bodyStart = match[0].length;
  const rest = message.slice(bodyStart);
  const metadataMatch = /,\s*(?:url|cf-ray|request id|auth error|auth error code):/i.exec(rest);
  const body = (metadataMatch ? rest.slice(0, metadataMatch.index) : rest).trim();
  const requestIdMatch = /(?:^|,\s*)request id:\s*([^,\s]+)/i.exec(rest);

  return {
    statusCode: Number.parseInt(match[1], 10),
    body,
    requestId: requestIdMatch?.[1]?.trim() ?? null,
  };
}

function parseErrorBody(body: string): ParsedErrorBody {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) {
    return {
      code: null,
      message: trimmed,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      return {
        code: null,
        message: trimmed,
      };
    }

    const error = isRecord(parsed.error) ? parsed.error : null;
    const code = readString(parsed.code) ?? readString(error?.code) ?? null;
    const message =
      readString(parsed.message) ??
      readString(error?.message) ??
      readString(parsed.detail) ??
      readString(error?.detail) ??
      trimmed;

    return {
      code,
      message,
    };
  } catch {
    return {
      code: null,
      message: trimmed,
    };
  }
}

function translateProviderError(error: ParsedErrorBody, statusCode: number | null): string {
  const code = error.code?.trim().toUpperCase() ?? "";
  const message = error.message.trim();
  const lower = message.toLowerCase();

  if (code === "USER_INACTIVE" || /user account is not active/i.test(message)) {
    return "账号未激活，请完成账号激活后重试。";
  }

  if (
    code === "INSUFFICIENT_BALANCE" ||
    /insufficient (?:account )?balance/i.test(message) ||
    /余额不足/.test(message)
  ) {
    return "账户余额不足，请充值后重试。";
  }

  if (/model .*not found|model is not found|not found.*model/i.test(message)) {
    return "模型不存在或暂不可用。";
  }

  if (/service temporarily unavailable/i.test(message) || statusCode === 503) {
    return "服务暂时不可用，请稍后重试。";
  }

  if (/rate[_ -]?limit|usage[_ -]?limit|quota/i.test(lower) || statusCode === 429) {
    return "用量或请求频率已达上限，请稍后重试。";
  }

  if (/token has expired|invalid token|unauthorized/i.test(lower) || statusCode === 401) {
    return "登录状态已失效，请重新登录后重试。";
  }

  if (statusCode === 403 && containsCjk(message)) {
    return ensureChineseSentence(message);
  }

  if (/forbidden|access denied/i.test(lower) || statusCode === 403) {
    return "当前请求未被允许，请检查账号、模型权限或联系管理员。";
  }

  if (statusCode === 404) {
    return "请求的资源不存在或模型暂不可用。";
  }

  if (statusCode !== null && statusCode >= 500) {
    return "服务暂时不可用，请稍后重试。";
  }

  if (statusCode !== null && !containsCjk(message)) {
    if (statusCode >= 400 && statusCode < 500) {
      return "请求未能完成，请检查账号、模型或请求参数后重试。";
    }
    return "请求失败，请稍后重试。";
  }

  if (containsCjk(message)) {
    return ensureChineseSentence(message);
  }

  return message;
}

function formatUserFacingError(message: string, requestId: string | null): string {
  const normalized = ensureChineseSentence(message.trim());
  if (!requestId) {
    return normalized;
  }
  return `${normalized}请求 ID：${requestId}`;
}

function ensureChineseSentence(message: string): string {
  if (message.length === 0) {
    return "请求失败。";
  }
  return /[。！？.!?]$/.test(message) ? message : `${message}。`;
}

function containsCjk(message: string): boolean {
  return /[\u3400-\u9fff]/.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
