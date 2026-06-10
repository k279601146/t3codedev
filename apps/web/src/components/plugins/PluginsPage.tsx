import type {
  DesktopBrowserAutomationState,
  DesktopComputerAutomationAppPermission,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";
import {
  BlocksIcon,
  CheckIcon,
  CircleSlashIcon,
  EyeIcon,
  GlobeIcon,
  LaptopIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  RefreshCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";

type BuiltinPluginId = "browser_use" | "computer_use";

interface BuiltinPlugin {
  readonly id: BuiltinPluginId;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: ReactNode;
  readonly tags: readonly string[];
}

const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = [
  {
    id: "browser_use",
    title: "Browser Use",
    subtitle: "内置浏览器、页面检查、点击、输入、截图和 DOM 读取。",
    icon: <GlobeIcon className="size-5" />,
    tags: ["browser_use", "in_app_browser", "t3_browser"],
  },
  {
    id: "computer_use",
    title: "Computer Use",
    subtitle: "Windows 桌面截图、鼠标、键盘和 App 级授权控制。",
    icon: <LaptopIcon className="size-5" />,
    tags: ["computer_use", "t3_computer", "desktop"],
  },
];
const DEFAULT_PLUGIN = BUILTIN_PLUGINS[0]!;

function formatTimestamp(value: string | null): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function describeDesktopBridgeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("No handler registered") ||
    message.includes("Error invoking remote method")
  ) {
    return "桌面主进程还没有加载新的插件 IPC。请完全退出并重新启动 T3 Code 后再试。";
  }
  return message;
}

function statusPill(status: "ready" | "paused" | "unavailable") {
  switch (status) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <CheckIcon className="size-3" />
          已启用
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <PauseIcon className="size-3" />
          已暂停
        </span>
      );
    case "unavailable":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
          <CircleSlashIcon className="size-3" />
          不可用
        </span>
      );
  }
}

function PluginCard({
  active,
  plugin,
  status,
  onSelect,
}: {
  readonly active: boolean;
  readonly plugin: BuiltinPlugin;
  readonly status: "ready" | "paused" | "unavailable";
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-3 rounded-md px-3 py-3 text-start transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
      )}
      onClick={onSelect}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {plugin.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{plugin.title}</div>
        <div className="truncate text-xs text-muted-foreground">{plugin.subtitle}</div>
      </div>
      <div className="shrink-0">{statusPill(status)}</div>
    </button>
  );
}

function SettingRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-right text-xs text-foreground">{value}</div>
    </div>
  );
}

function PermissionRow({
  permission,
  removing,
  onRemove,
}: {
  readonly permission: DesktopComputerAutomationAppPermission;
  readonly removing: boolean;
  readonly onRemove: (appKey: string) => void;
}) {
  return (
    <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-foreground">
          {permission.displayName}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {permission.processName ?? permission.title ?? permission.appKey}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground/80">
          上次使用：{formatTimestamp(permission.lastUsedAt)}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={removing}
        onClick={() => onRemove(permission.appKey)}
        aria-label={`移除 ${permission.displayName}`}
      >
        {removing ? <Loader2Icon className="size-3.5 animate-spin" /> : <Trash2Icon className="size-3.5" />}
      </Button>
    </div>
  );
}

function BrowserPluginDetails({
  state,
  refresh,
}: {
  readonly state: DesktopBrowserAutomationState | null;
  readonly refresh: () => void;
}) {
  const activeTab =
    state?.tabs.find((tab) => tab.id === state.selectedTabId) ?? state?.tabs[0] ?? null;
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Browser Use 设置</h2>
          <Button type="button" variant="ghost" size="xs" onClick={refresh}>
            <RefreshCcwIcon className="size-3.5" />
            刷新
          </Button>
        </div>
        <div className="mt-3 rounded-md border border-border/70 px-3">
          <SettingRow label="插件状态" value={statusPill(state ? "ready" : "unavailable")} />
          <SettingRow label="命名空间" value={<span className="font-mono">t3_browser</span>} />
          <SettingRow label="当前标签页" value={activeTab?.title || "暂无"} />
          <SettingRow
            label="当前 URL"
            value={
              activeTab?.url ? (
                <span className="block max-w-[420px] truncate font-mono">{activeTab.url}</span>
              ) : (
                "暂无"
              )
            }
          />
        </div>
      </section>
      <section className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <EyeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-5 text-muted-foreground">
            本插件用于本地开发页面和公网页面检查。涉及表单提交、发送消息、删除数据、付款或权限变更时，仍需要走确认链路。
          </p>
        </div>
      </section>
    </div>
  );
}

function ComputerPluginDetails({
  state,
  refresh,
  onTogglePaused,
  onAllowForeground,
  onRemovePermission,
  onClearPermissions,
  busyAction,
}: {
  readonly state: DesktopComputerAutomationState | null;
  readonly refresh: () => void;
  readonly onTogglePaused: () => void;
  readonly onAllowForeground: () => void;
  readonly onRemovePermission: (appKey: string) => void;
  readonly onClearPermissions: () => void;
  readonly busyAction: string | null;
}) {
  const status = !state || !state.available ? "unavailable" : state.paused ? "paused" : "ready";
  const foreground = state?.foregroundWindow;
  const allowedApps = state?.allowedApps ?? [];
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Computer Use 设置</h2>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="xs" onClick={refresh}>
              <RefreshCcwIcon className="size-3.5" />
              刷新
            </Button>
            <Button
              type="button"
              variant={state?.paused ? "default" : "outline"}
              size="xs"
              disabled={!state?.available || busyAction === "pause"}
              onClick={onTogglePaused}
            >
              {busyAction === "pause" ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : state?.paused ? (
                <PlayIcon className="size-3.5" />
              ) : (
                <PauseIcon className="size-3.5" />
              )}
              {state?.paused ? "继续" : "暂停"}
            </Button>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-border/70 px-3">
          <SettingRow label="插件状态" value={statusPill(status)} />
          <SettingRow label="命名空间" value={<span className="font-mono">t3_computer</span>} />
          <SettingRow label="平台" value={state?.platform ?? "unknown"} />
          <SettingRow
            label="前台 App"
            value={
              foreground?.processName || foreground?.title ? (
                <span className="block max-w-[420px] truncate">
                  {foreground.processName ?? "Unknown"} · {foreground.title || "Untitled"}
                </span>
              ) : (
                "暂无"
              )
            }
          />
          <SettingRow
            label="坐标系"
            value={
              state?.virtualScreen
                ? `${state.virtualScreen.x},${state.virtualScreen.y} · ${state.virtualScreen.width}x${state.virtualScreen.height}`
                : "暂无"
            }
          />
          <SettingRow label="最后动作" value={state?.lastAction ?? "暂无"} />
          <SettingRow label="最后错误" value={state?.lastError ?? "暂无"} />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-medium text-muted-foreground">已允许的 App</h3>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!state?.available || busyAction === "allow"}
              onClick={onAllowForeground}
            >
              {busyAction === "allow" ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <ShieldCheckIcon className="size-3.5" />
              )}
              允许当前前台 App
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={allowedApps.length === 0 || busyAction === "clear"}
              onClick={onClearPermissions}
            >
              {busyAction === "clear" ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
              清空
            </Button>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-border/70 px-3">
          {allowedApps.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">还没有始终允许的 App。</div>
          ) : (
            allowedApps.map((permission) => (
              <PermissionRow
                key={permission.appKey}
                permission={permission}
                removing={busyAction === `remove:${permission.appKey}`}
                onRemove={onRemovePermission}
              />
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-5 text-muted-foreground">
            Computer Use 会在使用未授权 App 前请求确认；执行桌面控制时 T3 Code 会让出前台，避免遮挡目标 App。终端应用、T3 Code 和 Codex 自身会被拦截，避免绕过会话权限与安全策略。
          </p>
        </div>
      </section>
    </div>
  );
}

export function PluginsPage() {
  const [search, setSearch] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState<BuiltinPluginId>("browser_use");
  const [browserState, setBrowserState] = useState<DesktopBrowserAutomationState | null>(null);
  const [computerState, setComputerState] = useState<DesktopComputerAutomationState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshBrowser = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getBrowserAutomationState) {
      setBrowserState(null);
      return;
    }
    void bridge.getBrowserAutomationState().then(setBrowserState).catch(() => setBrowserState(null));
  }, []);

  const refreshComputer = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getComputerAutomationState) {
      setComputerState(null);
      return;
    }
    void bridge
      .getComputerAutomationState()
      .then(setComputerState)
      .catch(() => setComputerState(null));
  }, []);

  useEffect(() => {
    refreshBrowser();
    refreshComputer();
    const bridge = window.desktopBridge;
    const unsubscribeBrowser = bridge?.onBrowserAutomationState?.((state) => setBrowserState(state));
    const unsubscribeComputer = bridge?.onComputerAutomationState?.((state) =>
      setComputerState(state),
    );
    return () => {
      unsubscribeBrowser?.();
      unsubscribeComputer?.();
    };
  }, [refreshBrowser, refreshComputer]);

  const filteredPlugins = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return BUILTIN_PLUGINS;
    return BUILTIN_PLUGINS.filter((plugin) =>
      [plugin.id, plugin.title, plugin.subtitle, ...plugin.tags].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [search]);

  const selectedPlugin =
    BUILTIN_PLUGINS.find((plugin) => plugin.id === selectedPluginId) ?? DEFAULT_PLUGIN;

  const runComputerAction = useCallback(
    async (actionKey: string, action: () => Promise<DesktopComputerAutomationState>) => {
      if (busyAction) return;
      setBusyAction(actionKey);
      try {
        setComputerState(await action());
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Computer Use 操作失败",
          description: describeDesktopBridgeError(error),
        });
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction],
  );

  const toggleComputerPaused = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.setComputerAutomationPaused || !computerState) return;
    void runComputerAction("pause", () =>
      bridge.setComputerAutomationPaused!(computerState.paused ? false : true),
    );
  }, [computerState, runComputerAction]);

  const allowForegroundApp = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.allowComputerAutomationForegroundApp) return;
    void runComputerAction("allow", () => bridge.allowComputerAutomationForegroundApp!());
  }, [runComputerAction]);

  const removePermission = useCallback(
    (appKey: string) => {
      const bridge = window.desktopBridge;
      if (!bridge?.removeComputerAutomationAppPermission) return;
      void runComputerAction(`remove:${appKey}`, () =>
        bridge.removeComputerAutomationAppPermission!(appKey),
      );
    },
    [runComputerAction],
  );

  const clearPermissions = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.clearComputerAutomationAppPermissions) return;
    void runComputerAction("clear", () => bridge.clearComputerAutomationAppPermissions!());
  }, [runComputerAction]);

  const pluginStatus = useCallback(
    (pluginId: BuiltinPluginId): "ready" | "paused" | "unavailable" => {
      if (pluginId === "browser_use") return browserState ? "ready" : "unavailable";
      if (!computerState || !computerState.available) return "unavailable";
      return computerState.paused ? "paused" : "ready";
    },
    [browserState, computerState],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex items-center justify-end gap-3 border-b border-border/60 px-8 py-3">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            refreshBrowser();
            refreshComputer();
          }}
        >
          <RefreshCcwIcon className="size-3.5" />
          刷新
        </Button>
        <div className="relative w-[260px]">
          <SearchIcon className="absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索插件"
            className="h-8 ps-7 text-sm"
          />
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <div>
            <div>
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
                插件
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                管理 T3 Code 的内置能力、自动化入口和授权边界。
              </p>
            </div>

            <section className="mt-8">
              <h2 className="text-[13px] font-medium text-muted-foreground">已安装</h2>
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1">
                {filteredPlugins.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <BlocksIcon className="size-4" />
                    没有匹配的插件。
                  </div>
                ) : (
                  filteredPlugins.map((plugin) => (
                    <PluginCard
                      key={plugin.id}
                      plugin={plugin}
                      active={selectedPlugin.id === plugin.id}
                      status={pluginStatus(plugin.id)}
                      onSelect={() => setSelectedPluginId(plugin.id)}
                    />
                  ))
                )}
              </div>
            </section>
          </div>

          <aside className="min-w-0">
            <div className="rounded-md border border-border/70 bg-background p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {selectedPlugin.icon}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {selectedPlugin.title}
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedPlugin.subtitle}
                  </p>
                </div>
              </div>
              {selectedPlugin.id === "browser_use" ? (
                <BrowserPluginDetails state={browserState} refresh={refreshBrowser} />
              ) : (
                <ComputerPluginDetails
                  state={computerState}
                  refresh={refreshComputer}
                  onTogglePaused={toggleComputerPaused}
                  onAllowForeground={allowForegroundApp}
                  onRemovePermission={removePermission}
                  onClearPermissions={clearPermissions}
                  busyAction={busyAction}
                />
              )}
            </div>
          </aside>
        </div>
      </ScrollArea>
    </div>
  );
}
