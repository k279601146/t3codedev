import type {
  DesktopBrowserAutomationState,
  DesktopBrowserExternalAutomationState,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";

export type ToolBridgeHealthId = "browser_use" | "browser_use_external" | "computer_use";
export type ToolBridgeHealthStatus = "ready" | "warning" | "unavailable";
export type ToolBridgeHealthReason =
  | "ready"
  | "desktop-bridge-missing"
  | "recent-error"
  | "chrome-plugin-not-installed"
  | "chrome-extension-unpaired"
  | "computer-platform-unavailable"
  | "computer-paused";

export interface ToolBridgeHealthItem {
  readonly id: ToolBridgeHealthId;
  readonly label: string;
  readonly namespace: string;
  readonly status: ToolBridgeHealthStatus;
  readonly reason: ToolBridgeHealthReason;
  readonly reasonLabel: string;
  readonly summary: string;
  readonly detail: string;
  readonly actionLabel: string | null;
  readonly lastError: string | null;
  readonly updatedAt: string | null;
  readonly lastToolCallAt: string | null;
}

export interface ToolBridgeHealthSummary {
  readonly total: number;
  readonly ready: number;
  readonly warning: number;
  readonly unavailable: number;
  readonly status: ToolBridgeHealthStatus;
}

export interface ToolBridgeHealthInput {
  readonly browserState: DesktopBrowserAutomationState | null;
  readonly browserExternalState: DesktopBrowserExternalAutomationState | null;
  readonly browserExternalInstalled: boolean;
  readonly computerState: DesktopComputerAutomationState | null;
}

export type ComputerAutomationPermissionStatus =
  | "unavailable"
  | "paused"
  | "no-foreground"
  | "allowed"
  | "approval-required";

export interface ComputerAutomationPermissionSummary {
  readonly status: ComputerAutomationPermissionStatus;
  readonly summary: string;
  readonly detail: string;
  readonly foregroundLabel: string | null;
  readonly allowedAppCount: number;
}

export function buildToolBridgeHealthItems(
  input: ToolBridgeHealthInput,
): readonly ToolBridgeHealthItem[] {
  return [
    buildBrowserHealthItem(input.browserState),
    buildBrowserExternalHealthItem(input.browserExternalState, input.browserExternalInstalled),
    buildComputerHealthItem(input.computerState),
  ];
}

export function summarizeToolBridgeHealth(
  items: readonly ToolBridgeHealthItem[],
): ToolBridgeHealthSummary {
  const ready = items.filter((item) => item.status === "ready").length;
  const warning = items.filter((item) => item.status === "warning").length;
  const unavailable = items.filter((item) => item.status === "unavailable").length;
  return {
    total: items.length,
    ready,
    warning,
    unavailable,
    status: unavailable > 0 ? "unavailable" : warning > 0 ? "warning" : "ready",
  };
}

export function describeComputerAutomationPermission(
  state: DesktopComputerAutomationState | null,
): ComputerAutomationPermissionSummary {
  if (!state || !state.available) {
    return {
      status: "unavailable",
      summary: "权限状态不可用",
      detail: "桌面自动化不可用时无法判断 App 权限。",
      foregroundLabel: null,
      allowedAppCount: 0,
    };
  }
  const allowedAppCount = state.allowedApps.length;
  if (state.paused) {
    return {
      status: "paused",
      summary: "Computer Use 已暂停",
      detail: "继续后才会执行鼠标、键盘和窗口级工具调用。",
      foregroundLabel: null,
      allowedAppCount,
    };
  }
  const foregroundLabel = displayNameForComputerForeground(state.foregroundWindow);
  const foregroundAppKey = appKeyForComputerForeground(state.foregroundWindow);
  if (!foregroundLabel || !foregroundAppKey) {
    return {
      status: "no-foreground",
      summary: "暂无前台 App",
      detail: allowedAppCount
        ? `已允许 ${allowedAppCount} 个 App；当前还没有可判断的前台 App。`
        : "还没有始终允许的 App；当前也没有可判断的前台 App。",
      foregroundLabel: null,
      allowedAppCount,
    };
  }
  const isAllowed = state.allowedApps.some((permission) => permission.appKey === foregroundAppKey);
  if (isAllowed) {
    return {
      status: "allowed",
      summary: "前台 App 已允许",
      detail: `${foregroundLabel} 已在始终允许列表中。已允许 ${allowedAppCount} 个 App。`,
      foregroundLabel,
      allowedAppCount,
    };
  }
  return {
    status: "approval-required",
    summary: "前台 App 使用前需确认",
    detail: `${foregroundLabel} 尚未始终允许；首次控制前会请求确认。已允许 ${allowedAppCount} 个 App。`,
    foregroundLabel,
    allowedAppCount,
  };
}

function normalizeComputerProcessName(processName: string | null | undefined): string {
  return (processName ?? "").trim().toLowerCase().replace(/\.exe$/, "");
}

function displayNameForComputerForeground(
  foreground: DesktopComputerAutomationState["foregroundWindow"],
): string | null {
  const processName = foreground?.processName?.trim();
  const title = foreground?.title?.trim();
  return processName || title || null;
}

function appKeyForComputerForeground(
  foreground: DesktopComputerAutomationState["foregroundWindow"],
): string | null {
  const processName = normalizeComputerProcessName(foreground?.processName);
  if (processName) return `process:${processName}`;
  const title = foreground?.title?.trim().toLowerCase();
  if (title) return `title:${title.slice(0, 120)}`;
  return null;
}

function buildBrowserHealthItem(
  state: DesktopBrowserAutomationState | null,
): ToolBridgeHealthItem {
  if (!state) {
    return {
      id: "browser_use",
      label: "Browser Use",
      namespace: "t3_browser",
      status: "unavailable",
      reason: "desktop-bridge-missing",
      reasonLabel: "桌面桥接缺失",
      summary: "桌面桥接未就绪",
      detail: "需要在桌面端启动 Bahew 后才能使用内置浏览器自动化。",
      actionLabel: "打开插件与桥接检查桌面端状态",
      lastError: null,
      updatedAt: null,
      lastToolCallAt: null,
    };
  }
  const activeTab = state.tabs.find((tab) => tab.id === state.selectedTabId) ?? state.tabs[0];
  const tabLabel = activeTab?.title || activeTab?.url || "暂无活动标签页";
  return {
    id: "browser_use",
    label: "Browser Use",
    namespace: "t3_browser",
    status: state.lastError ? "warning" : "ready",
    reason: state.lastError ? "recent-error" : "ready",
    reasonLabel: state.lastError ? "最近调用错误" : "状态正常",
    summary: state.lastError ? "最近调用有错误" : "可直接使用",
    detail: state.lastError ?? `当前标签页：${tabLabel}`,
    actionLabel: state.lastError ? "打开 Browser Use 详情查看最近错误" : null,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
    lastToolCallAt: state.lastToolCallAt,
  };
}

function buildBrowserExternalHealthItem(
  state: DesktopBrowserExternalAutomationState | null,
  installed: boolean,
): ToolBridgeHealthItem {
  if (!state) {
    return {
      id: "browser_use_external",
      label: "Chrome",
      namespace: "t3_browser_external",
      status: "unavailable",
      reason: "desktop-bridge-missing",
      reasonLabel: "桌面桥接缺失",
      summary: "桌面桥接未就绪",
      detail: "需要在桌面端启动 Bahew 后才能读取 Chrome 扩展连接状态。",
      actionLabel: "打开插件与桥接检查桌面端状态",
      lastError: null,
      updatedAt: null,
      lastToolCallAt: null,
    };
  }
  if (!installed) {
    return {
      id: "browser_use_external",
      label: "Chrome",
      namespace: "t3_browser_external",
      status: "warning",
      reason: "chrome-plugin-not-installed",
      reasonLabel: "插件入口未安装",
      summary: "插件入口待安装",
      detail: "安装 Browser Use External 后，再配对 Bahew Chrome Extension。",
      actionLabel: "安装 Browser Use External",
      lastError: state.lastError,
      updatedAt: state.updatedAt,
      lastToolCallAt: state.lastToolCallAt,
    };
  }
  if (!state.connected) {
    return {
      id: "browser_use_external",
      label: "Chrome",
      namespace: "t3_browser_external",
      status: "warning",
      reason: "chrome-extension-unpaired",
      reasonLabel: "Chrome 扩展未配对",
      summary: "等待 Chrome 扩展配对",
      detail: state.lastError ?? "需要把 Endpoint 与 Token 填入 Chrome 扩展弹窗。",
      actionLabel: "打开配对流程",
      lastError: state.lastError,
      updatedAt: state.updatedAt,
      lastToolCallAt: state.lastToolCallAt,
    };
  }
  const profile = [state.browserName, state.profileName].filter(Boolean).join(" / ");
  return {
    id: "browser_use_external",
    label: "Chrome",
    namespace: "t3_browser_external",
    status: state.lastError ? "warning" : "ready",
    reason: state.lastError ? "recent-error" : "ready",
    reasonLabel: state.lastError ? "最近调用错误" : "状态正常",
    summary: state.lastError ? "最近调用有错误" : "扩展已连接",
    detail: state.lastError ?? (profile ? `已连接：${profile}` : "Chrome 扩展已连接。"),
    actionLabel: state.lastError ? "打开 Chrome 详情查看最近错误" : null,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
    lastToolCallAt: state.lastToolCallAt,
  };
}

function buildComputerHealthItem(
  state: DesktopComputerAutomationState | null,
): ToolBridgeHealthItem {
  if (!state) {
    return {
      id: "computer_use",
      label: "Computer Use",
      namespace: "t3_computer",
      status: "unavailable",
      reason: "desktop-bridge-missing",
      reasonLabel: "桌面桥接缺失",
      summary: "桌面桥接未就绪",
      detail: "需要在桌面端启动 Bahew 后才能使用桌面自动化。",
      actionLabel: "打开插件与桥接检查桌面端状态",
      lastError: null,
      updatedAt: null,
      lastToolCallAt: null,
    };
  }
  if (!state.available) {
    return {
      id: "computer_use",
      label: "Computer Use",
      namespace: "t3_computer",
      status: "unavailable",
      reason: "computer-platform-unavailable",
      reasonLabel: "平台不可用",
      summary: "当前平台不可用",
      detail: state.lastError ?? "桌面自动化主机未报告可用状态。",
      actionLabel: "查看 Computer Use 详情",
      lastError: state.lastError,
      updatedAt: state.updatedAt,
      lastToolCallAt: state.lastToolCallAt,
    };
  }
  if (state.paused) {
    return {
      id: "computer_use",
      label: "Computer Use",
      namespace: "t3_computer",
      status: "warning",
      reason: "computer-paused",
      reasonLabel: "已暂停",
      summary: "已暂停",
      detail: "继续后才会执行鼠标、键盘和窗口级工具调用。",
      actionLabel: "打开 Computer Use 详情继续",
      lastError: state.lastError,
      updatedAt: state.updatedAt,
      lastToolCallAt: state.lastToolCallAt,
    };
  }
  const foreground = state.foregroundWindow;
  const foregroundLabel =
    foreground?.processName || foreground?.title
      ? `${foreground.processName ?? "Unknown"} · ${foreground.title || "Untitled"}`
      : "暂无前台窗口";
  const permission = describeComputerAutomationPermission(state);
  return {
    id: "computer_use",
    label: "Computer Use",
    namespace: "t3_computer",
    status: state.lastError ? "warning" : "ready",
    reason: state.lastError ? "recent-error" : "ready",
    reasonLabel: state.lastError ? "最近调用错误" : "状态正常",
    summary: state.lastError ? "最近调用有错误" : permission.summary,
    detail: state.lastError ?? `前台窗口：${foregroundLabel}；${permission.detail}`,
    actionLabel: state.lastError ? "打开 Computer Use 详情查看最近错误" : null,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
    lastToolCallAt: state.lastToolCallAt,
  };
}
