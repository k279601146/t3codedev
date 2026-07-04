export type ProviderErrorKind =
  | "insufficient_balance"
  | "usage_limit"
  | "rate_limited"
  | "authentication"
  | "forbidden"
  | "model_not_found"
  | "service_unavailable"
  | "bad_request"
  | "gateway_bad_response"
  | "unknown";

export interface NormalizedProviderError {
  readonly kind: ProviderErrorKind;
  readonly message: string;
  readonly statusCode: number | null;
  readonly requestId: string | null;
  readonly isActionable: boolean;
}

export interface ProviderErrorContextCandidate {
  readonly message: string | null | undefined;
  readonly detail?: unknown;
}

interface ParsedProviderError {
  readonly statusCode: number | null;
  readonly body: string;
  readonly requestId: string | null;
}

interface ParsedErrorBody {
  readonly code: string | null;
  readonly message: string;
}

const ACTIONABLE_PROVIDER_ERROR_KINDS = new Set<ProviderErrorKind>([
  "insufficient_balance",
  "usage_limit",
  "rate_limited",
  "authentication",
  "forbidden",
  "model_not_found",
  "service_unavailable",
]);

export function normalizeProviderErrorMessage(
  message: string | null | undefined,
  detail?: unknown,
): NormalizedProviderError | null {
  const candidates = collectErrorTextCandidates(message, detail);
  if (candidates.length === 0) {
    return null;
  }

  const parsedCandidates = candidates
    .map((candidate) => normalizeProviderErrorCandidate(candidate))
    .filter((candidate): candidate is NormalizedProviderError => candidate !== null);

  return selectBestNormalizedProviderError(parsedCandidates);
}

export function sanitizeProviderErrorMessage(
  message: string | null | undefined,
  detail?: unknown,
): string | null {
  return normalizeProviderErrorMessage(message, detail)?.message ?? null;
}

export function isActionableProviderErrorKind(kind: ProviderErrorKind): boolean {
  return ACTIONABLE_PROVIDER_ERROR_KINDS.has(kind);
}

export function shouldPreferProviderErrorContext(
  current: NormalizedProviderError | null,
  previous: NormalizedProviderError | null,
): boolean {
  if (!current || !previous || !previous.isActionable) {
    return false;
  }

  return (
    current.kind === "bad_request" ||
    current.kind === "gateway_bad_response" ||
    current.kind === "unknown"
  );
}

export function selectPreferredProviderErrorMessage(
  message: string | null | undefined,
  detail: unknown,
  candidates: ReadonlyArray<ProviderErrorContextCandidate>,
): string | null {
  const currentIssue = normalizeProviderErrorMessage(message, detail);
  const previousIssue = selectBestNormalizedProviderError(
    candidates
      .map((candidate) => normalizeProviderErrorMessage(candidate.message, candidate.detail))
      .filter((candidate): candidate is NormalizedProviderError => candidate !== null),
  );

  if (shouldPreferProviderErrorContext(currentIssue, previousIssue)) {
    return previousIssue?.message ?? null;
  }

  return currentIssue?.message ?? (message?.trim() ? message.trim() : null);
}

function normalizeProviderErrorCandidate(message: string): NormalizedProviderError | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = parseUnexpectedStatusError(trimmed) ?? parseHtmlError(trimmed);
  const statusCode = parsed?.statusCode ?? null;
  const requestId = parsed?.requestId ?? parseRequestId(trimmed);
  const body = parsed?.body ?? trimmed;
  const parsedBody = parseErrorBody(body);
  const classification = classifyProviderError(parsedBody, statusCode, body);
  const userMessage =
    classification.kind === "unknown" && statusCode === null && requestId === null
      ? classification.message
      : formatUserFacingError(classification.message, requestId);

  return {
    kind: classification.kind,
    message: userMessage,
    statusCode,
    requestId,
    isActionable: isActionableProviderErrorKind(classification.kind),
  };
}

function selectBestNormalizedProviderError(
  candidates: ReadonlyArray<NormalizedProviderError>,
): NormalizedProviderError | null {
  let latestActionable: NormalizedProviderError | null = null;
  let latestActionableWithRequestId: NormalizedProviderError | null = null;

  for (const candidate of candidates) {
    if (!candidate.isActionable) {
      continue;
    }
    latestActionable = candidate;
    if (candidate.requestId !== null) {
      latestActionableWithRequestId = candidate;
    }
  }

  return latestActionableWithRequestId ?? latestActionable ?? candidates[0] ?? null;
}

function classifyProviderError(
  error: ParsedErrorBody,
  statusCode: number | null,
  rawBody: string,
): { readonly kind: ProviderErrorKind; readonly message: string } {
  const code = error.code?.trim().toUpperCase() ?? "";
  const message = error.message.trim();
  const lower = `${message} ${rawBody}`.toLowerCase();

  if (
    code === "INSUFFICIENT_BALANCE" ||
    /\binsufficient[_ -]?(?:account[_ -]?)?balance\b/i.test(`${message} ${rawBody}`) ||
    /余额不足/.test(`${message} ${rawBody}`) ||
    (code === "BILLING_ERROR" && /balance|余额/.test(lower))
  ) {
    return {
      kind: "insufficient_balance",
      message: "账户余额不足，请充值或等待额度刷新后继续使用。",
    };
  }

  if (
    code === "USAGE_LIMIT_EXCEEDED" ||
    /workspace_.*_usage_limit_reached/i.test(lower) ||
    /usage[_ -]?limit|quota/i.test(lower)
  ) {
    return {
      kind: "usage_limit",
      message: "用量已达上限，请稍后重试或升级套餐。",
    };
  }

  if (/rate[_ -]?limit/i.test(lower) || statusCode === 429) {
    return {
      kind: "rate_limited",
      message: "请求过于频繁，请稍后重试。",
    };
  }

  if (code === "USER_INACTIVE" || /user account is not active/i.test(message)) {
    return {
      kind: "authentication",
      message: "账号未激活，请完成账号激活后重试。",
    };
  }

  if (/token has expired|invalid token|unauthorized/i.test(lower) || statusCode === 401) {
    return {
      kind: "authentication",
      message: "登录状态已失效，请重新登录后重试。",
    };
  }

  if (/model .*not found|model is not found|not found.*model/i.test(message)) {
    return {
      kind: "model_not_found",
      message: "模型不存在或暂不可用。",
    };
  }

  if (/service temporarily unavailable/i.test(message) || statusCode === 503) {
    return {
      kind: "service_unavailable",
      message: "服务暂时不可用，请稍后重试。",
    };
  }

  if (statusCode === 403 && containsCjk(message)) {
    return {
      kind: "forbidden",
      message: ensureChineseSentence(message),
    };
  }

  if (/forbidden|access denied/i.test(lower) || statusCode === 403) {
    return {
      kind: "forbidden",
      message: "当前请求未被允许，请检查账号、模型权限或联系管理员。",
    };
  }

  if (statusCode === 404) {
    return {
      kind: "model_not_found",
      message: "请求的资源不存在或模型暂不可用。",
    };
  }

  if (isHtmlLike(rawBody)) {
    return {
      kind: "gateway_bad_response",
      message: "服务网关返回了异常响应，请稍后重试。",
    };
  }

  if (statusCode === 400) {
    return {
      kind: "bad_request",
      message: "请求未能完成，请检查账号、模型或请求参数后重试。",
    };
  }

  if (statusCode !== null && statusCode >= 500) {
    return {
      kind: "service_unavailable",
      message: "服务暂时不可用，请稍后重试。",
    };
  }

  if (statusCode !== null && !containsCjk(message)) {
    if (statusCode >= 400 && statusCode < 500) {
      return {
        kind: "bad_request",
        message: "请求未能完成，请检查账号、模型或请求参数后重试。",
      };
    }
    return {
      kind: "unknown",
      message: "请求失败，请稍后重试。",
    };
  }

  if (containsCjk(message)) {
    return {
      kind: "unknown",
      message: ensureChineseSentence(message),
    };
  }

  return {
    kind: "unknown",
    message,
  };
}

function collectErrorTextCandidates(
  message: string | null | undefined,
  detail: unknown,
): ReadonlyArray<string> {
  const candidates: string[] = [];
  const addCandidate = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0 && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  addCandidate(message);
  collectErrorStrings(detail, addCandidate);

  const detailText = stringifyUnknown(detail);
  if (detailText !== null) {
    addCandidate(detailText);
  }

  return candidates;
}

function collectErrorStrings(value: unknown, addCandidate: (value: unknown) => void): void {
  if (!isRecord(value)) {
    addCandidate(value);
    return;
  }

  const preferredKeys = ["additionalDetails", "message", "detail", "error", "code"] as const;
  for (const key of preferredKeys) {
    if (key in value) {
      collectErrorStrings(value[key], addCandidate);
    }
  }
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

  return {
    statusCode: Number.parseInt(match[1], 10),
    body,
    requestId: parseRequestId(rest),
  };
}

function parseHtmlError(message: string): ParsedProviderError | null {
  if (!isHtmlLike(message)) {
    return null;
  }

  const title = extractHtmlText(message, "title") ?? extractHtmlText(message, "h1") ?? "";
  const statusMatch = /\b(\d{3})\b/.exec(title);
  return {
    statusCode: statusMatch?.[1] ? Number.parseInt(statusMatch[1], 10) : null,
    body: message,
    requestId: parseRequestId(message),
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
      readString(parsed.additionalDetails) ??
      readString(error?.additionalDetails) ??
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

function formatUserFacingError(message: string, requestId: string | null): string {
  const normalized = ensureChineseSentence(message.trim());
  if (!requestId) {
    return normalized;
  }
  return `${normalized}请求 ID：${requestId}`;
}

function parseRequestId(message: string): string | null {
  return /(?:^|[,\s])request id:\s*([^,\s"'}]+)/i.exec(message)?.[1]?.trim() ?? null;
}

function isHtmlLike(message: string): boolean {
  return /<html[\s>]|<body[\s>]|<h1[\s>]|<\/[a-z][\w-]*>/i.test(message);
}

function extractHtmlText(message: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(message);
  return match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? null;
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

function stringifyUnknown(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
