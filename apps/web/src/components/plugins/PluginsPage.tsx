import type {
  DesktopBrowserAutomationState,
  DesktopBrowserExternalAutomationState,
  DesktopComputerAutomationAppPermission,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";
import {
  BlocksIcon,
  CheckIcon,
  CircleSlashIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  GlobeIcon,
  LaptopIcon,
  Loader2Icon,
  PlugIcon,
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
import { useBrowserExternalPluginState } from "~/browserExternalPluginState";

type BuiltinPluginId = "browser_use" | "browser_use_external" | "computer_use";

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
  {
    id: "browser_use_external",
    title: "Browser Use External",
    subtitle: "通过 T3 Code Chrome Extension 控制用户 Chrome。",
    icon: <PlugIcon className="size-5" />,
    tags: ["browser_use_external", "chrome", "t3_browser_external"],
  },
];
const DEFAULT_PLUGIN = BUILTIN_PLUGINS[0]!;
const CHROME_EXTENSION_DOWNLOAD_URL = "/downloads/t3-code-chrome-extension.zip";
const CHROME_EXTENSION_DOWNLOAD_NAME = "t3-code-chrome-extension.zip";
const CHROME_EXTENSIONS_URL = "chrome://extensions";

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

function statusPill(
  status: "ready" | "paused" | "unavailable" | "not-installed" | "setup-required",
) {
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
    case "not-installed":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
          <CircleSlashIcon className="size-3" />
          未安装
        </span>
      );
    case "setup-required":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <CircleSlashIcon className="size-3" />
          待配置
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
  readonly status: "ready" | "paused" | "unavailable" | "not-installed" | "setup-required";
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

function SettingRow({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
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
        {removing ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <Trash2Icon className="size-3.5" />
        )}
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

function BrowserExternalPluginDetails({
  state,
  refresh,
  onRestartSetup,
}: {
  readonly state: DesktopBrowserExternalAutomationState | null;
  readonly refresh: () => void;
  readonly onRestartSetup: () => void;
}) {
  const activeTab =
    state?.tabs.find((tab) => tab.id === state.selectedTabId) ?? state?.tabs[0] ?? null;
  return (
    <div className="space-y-5">
      {!state?.connected ? (
        <BrowserExternalSetupGuide
          endpoint={state?.endpoint ?? null}
          token={state?.token ?? null}
          onRestartSetup={onRestartSetup}
        />
      ) : null}
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Browser Use External 设置</h2>
          <Button type="button" variant="ghost" size="xs" onClick={refresh}>
            <RefreshCcwIcon className="size-3.5" />
            刷新
          </Button>
        </div>
        <div className="mt-3 rounded-md border border-border/70 px-3">
          <SettingRow
            label="插件状态"
            value={statusPill(state?.connected ? "ready" : "setup-required")}
          />
          <SettingRow
            label="命名空间"
            value={<span className="font-mono">t3_browser_external</span>}
          />
          <SettingRow label="扩展 ID" value={state?.extensionId ?? "未连接"} />
          <SettingRow label="浏览器" value={state?.browserName ?? "未连接"} />
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
          <SettingRow label="最后错误" value={state?.lastError ?? "暂无"} />
        </div>
      </section>
      <section>
        <h3 className="text-[13px] font-medium text-muted-foreground">扩展连接信息</h3>
        <div className="mt-3 rounded-md border border-border/70 px-3">
          <SettingRow
            label="Endpoint"
            value={state?.endpoint ? <CopyConnectionValue value={state.endpoint} /> : "暂无"}
          />
          <SettingRow
            label="Token"
            value={state?.token ? <CopyConnectionValue value={state.token} secret /> : "暂无"}
          />
        </div>
      </section>
      <section>
        <h3 className="text-[13px] font-medium text-muted-foreground">配置流程</h3>
        <div className="mt-3 rounded-md border border-border/70 px-3">
          <SettingRow label="1. T3 插件" value={statusPill("ready")} />
          <SettingRow
            label="2. Chrome 扩展"
            value={
              state?.extensionId ? (
                statusPill("ready")
              ) : (
                <span className="text-muted-foreground">下载并安装 T3 Code Chrome Extension</span>
              )
            }
          />
          <SettingRow
            label="3. Endpoint / Token 配对"
            value={state?.connected ? statusPill("ready") : statusPill("setup-required")}
          />
        </div>
      </section>
      <section className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-5 text-muted-foreground">
            安装扩展后仍需把上方 Endpoint 与 Token 填入扩展弹窗完成配对。Token 会在每次重启 T3 Code
            后更新，此时需要重新配对。连接后 @Chrome 会使用 browser_use_external。
          </p>
        </div>
      </section>
    </div>
  );
}

function BrowserExternalSetupGuide({
  endpoint,
  token,
  onRestartSetup,
}: {
  readonly endpoint: string | null;
  readonly token: string | null;
  readonly onRestartSetup: () => void;
}) {
  return (
    <section className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">下一步：安装并配对 Chrome 扩展</h2>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Browser Use External 已加入 T3 Code，但还不能使用。你需要先下载 T3 Code Chrome Extension
            安装包，在 Chrome 中加载扩展，并把本页 Endpoint 与 Token 填入扩展弹窗。
          </p>
        </div>
        <Button type="button" variant="ghost" size="xs" onClick={onRestartSetup}>
          重新开始
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <SetupStep
          index={1}
          title="下载 Chrome 扩展"
          description="下载 T3 Code 提供的 Chrome 扩展安装包，并解压到一个固定目录。"
          action={<ChromeExtensionDownloadButton />}
        />
        <SetupStep
          index={2}
          title="在 Chrome 加载扩展"
          description="打开 Chrome 扩展页，开启开发者模式，点击“加载已解压的扩展程序”，选择刚才解压后的扩展目录。"
          action={<CopyConnectionValue value={CHROME_EXTENSIONS_URL} />}
        />
        <SetupStep
          index={3}
          title="配置扩展弹窗"
          description="点击 Chrome 工具栏里的 T3 Code 扩展，把本页 Endpoint 与 Token 填入弹窗后点击连接。"
          action={
            <div className="grid gap-1.5">
              {endpoint ? <CopyConnectionValue value={endpoint} /> : null}
              {token ? <CopyConnectionValue value={token} secret /> : null}
            </div>
          }
        />
        <SetupStep
          index={4}
          title="确认连接"
          description="扩展弹窗显示“已连接到 T3 Code”后，输入框菜单中的 Chrome 才会真正可用。"
          action={<CopyConnectionValue value={CHROME_EXTENSIONS_URL} />}
        />
      </div>
    </section>
  );
}

function SetupStep({
  index,
  title,
  description,
  action,
}: {
  readonly index: number;
  readonly title: string;
  readonly description: string;
  readonly action: ReactNode;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-background/70 p-3">
      <div className="flex items-start gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground">{title}</div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="pl-7">{action}</div>
    </div>
  );
}

function BrowserExternalInstallDetails({ onInstall }: { readonly onInstall: () => void }) {
  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-sm font-semibold text-foreground">安装 Browser Use External</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          安装后，输入框插件菜单才会显示 Chrome。随后还需要安装 T3 Code Chrome Extension，并使用
          Endpoint 与 Token 完成配对。
        </p>
        <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          T3 Code 会提供已构建好的 Chrome 扩展安装包。点击安装后，请按下一步引导下载扩展包、 安装到
          Chrome，并在扩展弹窗中填写 Endpoint 与 Token。
        </div>
        <Button type="button" className="mt-4" onClick={onInstall}>
          <PlugIcon className="size-4" />
          安装插件
        </Button>
      </section>
      <section className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="text-xs leading-5 text-muted-foreground">
          安装流程：安装 T3 插件 → 下载 Chrome 扩展 → 加载解压后的扩展目录 → 配置 Endpoint/Token →
          扩展显示已连接。
        </div>
      </section>
    </div>
  );
}

function ChromeExtensionDownloadButton() {
  return (
    <Button
      render={<a href={CHROME_EXTENSION_DOWNLOAD_URL} download={CHROME_EXTENSION_DOWNLOAD_NAME} />}
      size="xs"
    >
      <DownloadIcon className="size-3.5" />
      下载 Chrome 扩展
    </Button>
  );
}

function CopyConnectionValue({
  value,
  secret = false,
}: {
  readonly value: string;
  readonly secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    });
  }, [value]);
  const displayValue = secret ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <span className="block max-w-[340px] truncate font-mono">{displayValue}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "已复制" : "复制"}
        title={copied ? "已复制" : "复制"}
        onClick={copy}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </Button>
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
            Computer Use 会在使用未授权 App 前请求确认；执行桌面控制时 T3 Code
            会让出前台，避免遮挡目标 App。终端应用、T3 Code 和 Codex
            自身会被拦截，避免绕过会话权限与安全策略。
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
  const browserExternalPlugin = useBrowserExternalPluginState();
  const browserExternalState = browserExternalPlugin.state;
  const [computerState, setComputerState] = useState<DesktopComputerAutomationState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshBrowser = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getBrowserAutomationState) {
      setBrowserState(null);
      return;
    }
    void bridge
      .getBrowserAutomationState()
      .then(setBrowserState)
      .catch(() => setBrowserState(null));
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

  const refreshBrowserExternal = browserExternalPlugin.refresh;

  useEffect(() => {
    refreshBrowser();
    refreshBrowserExternal();
    refreshComputer();
    const bridge = window.desktopBridge;
    const unsubscribeBrowser = bridge?.onBrowserAutomationState?.((state) =>
      setBrowserState(state),
    );
    const unsubscribeComputer = bridge?.onComputerAutomationState?.((state) =>
      setComputerState(state),
    );
    return () => {
      unsubscribeBrowser?.();
      unsubscribeComputer?.();
    };
  }, [refreshBrowser, refreshBrowserExternal, refreshComputer]);

  const filteredPlugins = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = !query
      ? BUILTIN_PLUGINS
      : BUILTIN_PLUGINS.filter((plugin) =>
          [plugin.id, plugin.title, plugin.subtitle, ...plugin.tags].some((value) =>
            value.toLowerCase().includes(query),
          ),
        );
    return {
      installed: matching.filter(
        (plugin) => plugin.id !== "browser_use_external" || browserExternalPlugin.installed,
      ),
      available: matching.filter(
        (plugin) => plugin.id === "browser_use_external" && !browserExternalPlugin.installed,
      ),
    };
  }, [browserExternalPlugin.installed, search]);

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
    (
      pluginId: BuiltinPluginId,
    ): "ready" | "paused" | "unavailable" | "not-installed" | "setup-required" => {
      if (pluginId === "browser_use") return browserState ? "ready" : "unavailable";
      if (pluginId === "browser_use_external")
        return !browserExternalPlugin.installed
          ? "not-installed"
          : browserExternalState?.connected
            ? "ready"
            : "setup-required";
      if (!computerState || !computerState.available) return "unavailable";
      return computerState.paused ? "paused" : "ready";
    },
    [browserExternalPlugin.installed, browserState, browserExternalState, computerState],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex items-center justify-end gap-3 border-b border-border/60 px-8 py-3">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            refreshBrowser();
            refreshBrowserExternal();
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
                {filteredPlugins.installed.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <BlocksIcon className="size-4" />
                    没有匹配的插件。
                  </div>
                ) : (
                  filteredPlugins.installed.map((plugin) => (
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
            {filteredPlugins.available.length > 0 ? (
              <section className="mt-8">
                <h2 className="text-[13px] font-medium text-muted-foreground">可安装</h2>
                <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1">
                  {filteredPlugins.available.map((plugin) => (
                    <PluginCard
                      key={plugin.id}
                      plugin={plugin}
                      active={selectedPlugin.id === plugin.id}
                      status="not-installed"
                      onSelect={() => setSelectedPluginId(plugin.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
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
              ) : selectedPlugin.id === "browser_use_external" ? (
                browserExternalPlugin.installed ? (
                  <BrowserExternalPluginDetails
                    state={browserExternalState}
                    refresh={refreshBrowserExternal}
                    onRestartSetup={() => browserExternalPlugin.setInstalled(false)}
                  />
                ) : (
                  <BrowserExternalInstallDetails
                    onInstall={() => browserExternalPlugin.setInstalled(true)}
                  />
                )
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
