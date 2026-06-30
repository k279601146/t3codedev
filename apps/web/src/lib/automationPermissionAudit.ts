import type {
  DesktopBrowserExternalAutomationState,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";

export type AutomationPermissionAuditSource = "chrome" | "computer";
export type AutomationPermissionAuditDecision = "allow" | "block";

export interface AutomationPermissionAuditItem {
  readonly id: string;
  readonly source: AutomationPermissionAuditSource;
  readonly subject: string;
  readonly decision: AutomationPermissionAuditDecision;
  readonly scope: "session" | "always";
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
  readonly detail: string;
}

export interface AutomationPermissionAuditSummary {
  readonly total: number;
  readonly allowed: number;
  readonly blocked: number;
  readonly lastUpdatedAt: string | null;
}

export type AutomationPermissionPolicyHintTone = "info" | "warning" | "danger";

export interface AutomationPermissionPolicyHint {
  readonly id: string;
  readonly tone: AutomationPermissionPolicyHintTone;
  readonly title: string;
  readonly detail: string;
}

export type AutomationPermissionPolicyScope = AutomationPermissionAuditSource | "all";
export type AutomationPermissionPolicyStatus = "satisfied" | "review" | "action-required";
export type AutomationPermissionPolicyActionKind =
  | "chrome-downgrade-persistent-host"
  | "computer-clear-persistent-apps";
export type AutomationPermissionPolicyActionAuditResult = "success" | "failure";
export type AutomationPermissionPolicyActionAuditResultFilter =
  | AutomationPermissionPolicyActionAuditResult
  | "all";
export type AutomationPermissionPolicyActionAuditTimeRange = "all" | "24h" | "7d";

export interface AutomationPermissionPolicyEntry {
  readonly id: string;
  readonly status: AutomationPermissionPolicyStatus;
  readonly title: string;
  readonly recommended: string;
  readonly current: string;
  readonly actionLabel: string;
}

export interface AutomationPermissionPolicyAction {
  readonly id: string;
  readonly source: AutomationPermissionAuditSource;
  readonly kind: AutomationPermissionPolicyActionKind;
  readonly label: string;
  readonly detail: string;
  readonly targetLabel: string;
  readonly host?: string;
}

export interface AutomationPermissionPolicyActionAuditEvent {
  readonly id: string;
  readonly source: AutomationPermissionAuditSource;
  readonly actionKind: AutomationPermissionPolicyActionKind;
  readonly actionLabel: string;
  readonly targetLabel: string;
  readonly targetId: string;
  readonly result: AutomationPermissionPolicyActionAuditResult;
  readonly occurredAt: string;
  readonly detail: string | null;
}

export interface AutomationPermissionPolicyActionAuditSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly lastOccurredAt: string | null;
}

export interface AutomationPermissionPolicyActionAuditFilters {
  readonly result: AutomationPermissionPolicyActionAuditResultFilter;
  readonly query: string;
  readonly timeRange: AutomationPermissionPolicyActionAuditTimeRange;
  readonly now: string;
}

export interface AutomationPermissionPolicyActionAuditExport {
  readonly exportedAt: string;
  readonly total: number;
  readonly events: readonly AutomationPermissionPolicyActionAuditEvent[];
}

export function buildBrowserExternalPermissionAuditItems(
  state: DesktopBrowserExternalAutomationState | null,
): readonly AutomationPermissionAuditItem[] {
  return sortAutomationPermissionAuditItems(
    (state?.permissions ?? []).map((permission) => ({
      id: `chrome:${permission.host}`,
      source: "chrome" as const,
      subject: permission.host,
      decision: permission.decision,
      scope: permission.scope,
      updatedAt: permission.updatedAt,
      lastUsedAt: null,
      detail:
        permission.scope === "always"
          ? "Chrome 站点权限已持久保存。"
          : "Chrome 站点权限仅在当前会话有效。",
    })),
  );
}

export function buildComputerPermissionAuditItems(
  state: DesktopComputerAutomationState | null,
): readonly AutomationPermissionAuditItem[] {
  return sortAutomationPermissionAuditItems(
    (state?.allowedApps ?? []).map((permission) => ({
      id: `computer:${permission.appKey}`,
      source: "computer" as const,
      subject: permission.displayName,
      decision: "allow" as const,
      scope: "always" as const,
      updatedAt: permission.allowedAt,
      lastUsedAt: permission.lastUsedAt,
      detail: permission.processName ?? permission.title ?? permission.appKey,
    })),
  );
}

export function summarizeAutomationPermissionAudit(
  items: readonly AutomationPermissionAuditItem[],
): AutomationPermissionAuditSummary {
  let lastUpdatedAt: string | null = null;
  for (const item of items) {
    const timestamp = item.lastUsedAt ?? item.updatedAt;
    if (!lastUpdatedAt || Date.parse(timestamp) > Date.parse(lastUpdatedAt)) {
      lastUpdatedAt = timestamp;
    }
  }
  return {
    total: items.length,
    allowed: items.filter((item) => item.decision === "allow").length,
    blocked: items.filter((item) => item.decision === "block").length,
    lastUpdatedAt,
  };
}

export function buildAutomationPermissionPolicyHints(
  items: readonly AutomationPermissionAuditItem[],
): readonly AutomationPermissionPolicyHint[] {
  const hints: AutomationPermissionPolicyHint[] = [];
  const blocked = items.filter((item) => item.decision === "block");
  const persistentAllows = items.filter(
    (item) => item.decision === "allow" && item.scope === "always",
  );
  const sessionAllows = items.filter(
    (item) => item.decision === "allow" && item.scope === "session",
  );
  const sensitiveAllows = items.filter(
    (item) =>
      item.source === "chrome" &&
      item.decision === "allow" &&
      isSensitiveAutomationSubject(item.subject),
  );
  const computerAllows = persistentAllows.filter((item) => item.source === "computer");
  const chromePersistentAllows = persistentAllows.filter((item) => item.source === "chrome");

  if (blocked.length > 0) {
    hints.push({
      id: "blocked-records",
      tone: "warning",
      title: "存在阻止记录",
      detail: `${blocked.length} 个站点被阻止，后续自动化访问这些站点会被拦截。`,
    });
  }
  if (sensitiveAllows.length > 0) {
    hints.push({
      id: "sensitive-host-allow",
      tone: "danger",
      title: "敏感站点已允许",
      detail: `${sensitiveAllows.length} 个疑似登录、账单、控制台或支付站点已允许自动化访问。`,
    });
  }
  if (chromePersistentAllows.length > 0) {
    hints.push({
      id: "chrome-persistent-allow",
      tone: "warning",
      title: "存在持久站点授权",
      detail: `${chromePersistentAllows.length} 个 Chrome 站点授权会跨会话保留，适合定期复查。`,
    });
  }
  if (computerAllows.length > 0) {
    hints.push({
      id: "computer-persistent-allow",
      tone: "warning",
      title: "存在始终允许 App",
      detail: `${computerAllows.length} 个 App 可以跳过每次确认，适合只保留高信任目标。`,
    });
  }
  if (sessionAllows.length > 0 && chromePersistentAllows.length === 0) {
    hints.push({
      id: "session-only-allow",
      tone: "info",
      title: "仅会话级站点授权",
      detail: `${sessionAllows.length} 个站点授权会在会话结束后失效，风险边界较短。`,
    });
  }

  return hints;
}

export function buildAutomationPermissionPolicyEntries(
  items: readonly AutomationPermissionAuditItem[],
  scope: AutomationPermissionPolicyScope = "all",
): readonly AutomationPermissionPolicyEntry[] {
  const includeChrome = scope === "chrome" || scope === "all";
  const includeComputer = scope === "computer" || scope === "all";
  const entries: AutomationPermissionPolicyEntry[] = [];
  const chromeItems = includeChrome ? items.filter((item) => item.source === "chrome") : [];
  const computerItems = includeComputer ? items.filter((item) => item.source === "computer") : [];
  const chromePersistentAllows = chromeItems.filter(
    (item) => item.decision === "allow" && item.scope === "always",
  );
  const sensitiveChromeAllows = chromeItems.filter(
    (item) => item.decision === "allow" && isSensitiveAutomationSubject(item.subject),
  );
  const sensitivePersistentAllows = sensitiveChromeAllows.filter((item) => item.scope === "always");
  const sensitiveSessionAllows = sensitiveChromeAllows.filter((item) => item.scope === "session");
  const computerPersistentAllows = computerItems.filter(
    (item) => item.decision === "allow" && item.scope === "always",
  );

  if (includeChrome) {
    entries.push({
      id: "sensitive-host-confirmation",
      status:
        sensitivePersistentAllows.length > 0
          ? "action-required"
          : sensitiveSessionAllows.length > 0
            ? "review"
            : "satisfied",
      title: "敏感站点每次确认",
      recommended: "登录、账单、支付、控制台等站点不做持久允许。",
      current:
        sensitivePersistentAllows.length > 0
          ? `${sensitivePersistentAllows.length} 个敏感站点已持久允许。`
          : sensitiveSessionAllows.length > 0
            ? `${sensitiveSessionAllows.length} 个敏感站点仅本次会话允许。`
            : "未发现敏感站点允许记录。",
      actionLabel:
        sensitivePersistentAllows.length > 0
          ? "改为本次会话或阻止"
          : sensitiveSessionAllows.length > 0
            ? "会话结束后自动失效"
            : "保持每次确认",
    });
    entries.push({
      id: "chrome-session-scope-preferred",
      status: chromePersistentAllows.length > 0 ? "review" : "satisfied",
      title: "Chrome 默认会话级授权",
      recommended: "默认选择本次会话，只有固定低风险站点才持久允许。",
      current:
        chromePersistentAllows.length > 0
          ? `${chromePersistentAllows.length} 个 Chrome 站点已持久允许。`
          : "没有持久 Chrome 站点授权。",
      actionLabel: chromePersistentAllows.length > 0 ? "定期复查持久授权" : "维持会话级默认",
    });
  }

  if (includeComputer) {
    entries.push({
      id: "computer-persistent-allow-minimized",
      status: computerPersistentAllows.length > 0 ? "review" : "satisfied",
      title: "Computer 始终允许最小化",
      recommended: "只保留高度信任且重复使用的 App，其他目标保持每次确认。",
      current:
        computerPersistentAllows.length > 0
          ? `${computerPersistentAllows.length} 个 App 可以跳过每次确认。`
          : "没有始终允许的 App。",
      actionLabel:
        computerPersistentAllows.length > 0 ? "清理低频或低信任 App" : "继续按次确认",
    });
    entries.push({
      id: "computer-approval-default",
      status: "satisfied",
      title: "未授权 App 按次确认",
      recommended: "未列入始终允许的 App 必须先确认再执行桌面控制。",
      current:
        computerPersistentAllows.length > 0
          ? "未在允许列表内的 App 仍会请求确认。"
          : "所有 App 都会在使用前请求确认。",
      actionLabel: "由现有确认链路执行",
    });
  }

  return entries;
}

export function buildAutomationPermissionPolicyActions(
  items: readonly AutomationPermissionAuditItem[],
  scope: AutomationPermissionPolicyScope = "all",
): readonly AutomationPermissionPolicyAction[] {
  const includeChrome = scope === "chrome" || scope === "all";
  const includeComputer = scope === "computer" || scope === "all";
  const actions: AutomationPermissionPolicyAction[] = [];

  if (includeChrome) {
    const persistentChromeAllows = items.filter(
      (item) =>
        item.source === "chrome" && item.decision === "allow" && item.scope === "always",
    );
    for (const item of persistentChromeAllows) {
      actions.push({
        id: `chrome-downgrade:${item.subject}`,
        source: "chrome",
        kind: "chrome-downgrade-persistent-host",
        label: "改为本次会话",
        detail: `${item.subject} 将保留允许，但不再跨会话持久保存。`,
        targetLabel: item.subject,
        host: item.subject,
      });
    }
  }

  if (includeComputer) {
    const computerPersistentAllows = items.filter(
      (item) =>
        item.source === "computer" && item.decision === "allow" && item.scope === "always",
    );
    if (computerPersistentAllows.length > 0) {
      actions.push({
        id: "computer-clear-persistent-apps",
        source: "computer",
        kind: "computer-clear-persistent-apps",
        label: "清空始终允许 App",
        detail: `${computerPersistentAllows.length} 个 App 将恢复为使用前确认。`,
        targetLabel: "Computer Use",
      });
    }
  }

  return actions;
}

export function createAutomationPermissionPolicyActionAuditEvent(input: {
  readonly action: AutomationPermissionPolicyAction;
  readonly result: AutomationPermissionPolicyActionAuditResult;
  readonly occurredAt: string;
  readonly detail?: string | null;
}): AutomationPermissionPolicyActionAuditEvent {
  return {
    id: `${input.occurredAt}:${input.result}:${input.action.id}`,
    source: input.action.source,
    actionKind: input.action.kind,
    actionLabel: input.action.label,
    targetLabel: input.action.targetLabel,
    targetId: input.action.host ?? input.action.id,
    result: input.result,
    occurredAt: input.occurredAt,
    detail: input.detail ?? null,
  };
}

export function appendAutomationPermissionPolicyActionAuditEvent(
  events: readonly AutomationPermissionPolicyActionAuditEvent[],
  event: AutomationPermissionPolicyActionAuditEvent,
  limit = 12,
): readonly AutomationPermissionPolicyActionAuditEvent[] {
  return [event, ...events.filter((candidate) => candidate.id !== event.id)].slice(
    0,
    Math.max(1, limit),
  );
}

export function summarizeAutomationPermissionPolicyActionAudit(
  events: readonly AutomationPermissionPolicyActionAuditEvent[],
): AutomationPermissionPolicyActionAuditSummary {
  let lastOccurredAt: string | null = null;
  for (const event of events) {
    if (!lastOccurredAt || Date.parse(event.occurredAt) > Date.parse(lastOccurredAt)) {
      lastOccurredAt = event.occurredAt;
    }
  }
  return {
    total: events.length,
    succeeded: events.filter((event) => event.result === "success").length,
    failed: events.filter((event) => event.result === "failure").length,
    lastOccurredAt,
  };
}

export function filterAutomationPermissionPolicyActionAuditEvents(
  events: readonly AutomationPermissionPolicyActionAuditEvent[],
  filters: AutomationPermissionPolicyActionAuditFilters,
): readonly AutomationPermissionPolicyActionAuditEvent[] {
  const query = filters.query.trim().toLowerCase();
  const minOccurredAt = auditTimeRangeStart(filters.timeRange, filters.now);
  return sortAutomationPermissionPolicyActionAuditEvents(
    events.filter((event) => {
      if (filters.result !== "all" && event.result !== filters.result) return false;
      if (minOccurredAt !== null) {
        const occurredAt = Date.parse(event.occurredAt);
        if (Number.isNaN(occurredAt) || occurredAt < minOccurredAt) return false;
      }
      if (!query) return true;
      return [
        event.source,
        event.actionKind,
        event.actionLabel,
        event.targetLabel,
        event.targetId,
        event.detail,
      ]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(query));
    }),
  );
}

export function formatAutomationPermissionPolicyActionAuditExport(
  events: readonly AutomationPermissionPolicyActionAuditEvent[],
  exportedAt: string,
): string {
  const payload: AutomationPermissionPolicyActionAuditExport = {
    exportedAt,
    total: events.length,
    events,
  };
  return JSON.stringify(payload, null, 2);
}

export function normalizeAutomationPermissionPolicyActionAuditEvents(
  raw: unknown,
): readonly AutomationPermissionPolicyActionAuditEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const record = asReadonlyRecord(item);
    if (!record) return [];
    const id = readString(record, "id");
    const source = readPermissionAuditSource(record.source);
    const actionKind = readPermissionPolicyActionKind(record.actionKind);
    const actionLabel = readString(record, "actionLabel");
    const targetLabel = readString(record, "targetLabel");
    const targetId = readString(record, "targetId");
    const result = readPermissionPolicyActionAuditResult(record.result);
    const occurredAt = readString(record, "occurredAt");
    if (
      !id ||
      !source ||
      !actionKind ||
      !actionLabel ||
      !targetLabel ||
      !targetId ||
      !result ||
      !occurredAt
    ) {
      return [];
    }
    return [
      {
        id,
        source,
        actionKind,
        actionLabel,
        targetLabel,
        targetId,
        result,
        occurredAt,
        detail: readString(record, "detail"),
      },
    ];
  });
}

function isSensitiveAutomationSubject(subject: string): boolean {
  return /\b(admin|auth|bank|billing|checkout|console|login|payment|settings|wallet)\b/i.test(
    subject,
  );
}

function asReadonlyRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function readString(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPermissionAuditSource(value: unknown): AutomationPermissionAuditSource | null {
  return value === "chrome" || value === "computer" ? value : null;
}

function readPermissionPolicyActionKind(
  value: unknown,
): AutomationPermissionPolicyActionKind | null {
  return value === "chrome-downgrade-persistent-host" ||
    value === "computer-clear-persistent-apps"
    ? value
    : null;
}

function readPermissionPolicyActionAuditResult(
  value: unknown,
): AutomationPermissionPolicyActionAuditResult | null {
  return value === "success" || value === "failure" ? value : null;
}

function auditTimeRangeStart(
  timeRange: AutomationPermissionPolicyActionAuditTimeRange,
  now: string,
): number | null {
  const nowTime = Date.parse(now);
  if (timeRange === "all" || Number.isNaN(nowTime)) return null;
  const durationMs = timeRange === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  return nowTime - durationMs;
}

function sortAutomationPermissionAuditItems(
  items: readonly AutomationPermissionAuditItem[],
): readonly AutomationPermissionAuditItem[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.lastUsedAt ?? left.updatedAt);
    const rightTime = Date.parse(right.lastUsedAt ?? right.updatedAt);
    const safeLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
    const safeRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
    const timeDelta = safeRightTime - safeLeftTime;
    if (timeDelta !== 0) return timeDelta;
    return left.subject.localeCompare(right.subject);
  });
}

function sortAutomationPermissionPolicyActionAuditEvents(
  events: readonly AutomationPermissionPolicyActionAuditEvent[],
): readonly AutomationPermissionPolicyActionAuditEvent[] {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    const safeLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
    const safeRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
    const timeDelta = safeRightTime - safeLeftTime;
    if (timeDelta !== 0) return timeDelta;
    return left.id.localeCompare(right.id);
  });
}
