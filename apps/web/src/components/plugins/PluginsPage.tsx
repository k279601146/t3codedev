import type {
  DesktopBrowserAutomationState,
  DesktopBrowserExternalAutomationState,
  DesktopComputerAutomationAppPermission,
  DesktopComputerAutomationState,
  PluginDetail,
  PluginSummary,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import { useBrowserExternalPluginState } from "~/browserExternalPluginState";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";

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
const PLUGINS_LIST_QUERY = ["plugins", "list"] as const;
const pluginDetailQueryKey = (plugin: PluginSummary) =>
  [
    "plugins",
    "detail",
    plugin.location.remoteMarketplaceName ?? "",
    plugin.location.marketplacePath ?? "",
    plugin.name,
  ] as const;
const CHROME_EXTENSION_DOWNLOAD_URL = "/downloads/t3-code-chrome-extension.zip";
const CHROME_EXTENSION_DOWNLOAD_NAME = "t3-code-chrome-extension.zip";
const CHROME_EXTENSIONS_URL = "chrome://extensions";

function getPluginsClient() {
  return getPrimaryEnvironmentConnection().client.plugins;
}

function getMarketplaceClient() {
  return getPrimaryEnvironmentConnection().client.marketplace;
}

function builtinPluginId(plugin: PluginSummary): BuiltinPluginId | null {
  if (plugin.source.type !== "builtin") return null;
  const id = plugin.source.builtinId;
  return id === "browser_use" || id === "browser_use_external" || id === "computer_use" ? id : null;
}

function builtinMeta(plugin: PluginSummary): BuiltinPlugin | null {
  const id = builtinPluginId(plugin);
  return id ? (BUILTIN_PLUGINS.find((candidate) => candidate.id === id) ?? null) : null;
}

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

function PluginSummaryCard({
  active,
  plugin,
  status,
  onSelect,
}: {
  readonly active: boolean;
  readonly plugin: PluginSummary;
  readonly status: "ready" | "paused" | "unavailable" | "not-installed" | "setup-required";
  readonly onSelect: () => void;
}) {
  const builtin = builtinMeta(plugin);
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
        {builtin?.icon ?? <BlocksIcon className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{plugin.displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {plugin.description ?? plugin.name}
        </div>
      </div>
      <div className="shrink-0">{statusPill(status)}</div>
    </button>
  );
}

function DetailRows({ detail }: { readonly detail: PluginDetail }) {
  return (
    <div className="mt-3 rounded-md border border-border/70 px-3">
      <SettingRow label="来源" value={detail.summary.source.type} />
      <SettingRow label="Marketplace" value={detail.marketplaceName} />
      <SettingRow
        label="Skills"
        value={
          detail.skills.length > 0 ? detail.skills.map((skill) => skill.name).join(", ") : "无"
        }
      />
      <SettingRow
        label="Apps"
        value={detail.apps.length > 0 ? detail.apps.map((app) => app.name).join(", ") : "无"}
      />
      <SettingRow
        label="MCP Servers"
        value={detail.mcpServers.length > 0 ? detail.mcpServers.join(", ") : "无"}
      />
      <SettingRow
        label="Hooks"
        value={detail.hooks.length > 0 ? detail.hooks.map((hook) => hook.name).join(", ") : "无"}
      />
    </div>
  );
}

function CodexPluginDetails({
  plugin,
  detail,
  loading,
  installing,
  uninstalling,
  onInstall,
  onUninstall,
}: {
  readonly plugin: PluginSummary;
  readonly detail: PluginDetail | null;
  readonly loading: boolean;
  readonly installing: boolean;
  readonly uninstalling: boolean;
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
}) {
  const unavailable = plugin.availability === "DISABLED_BY_ADMIN";
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-sm font-semibold text-foreground">{plugin.displayName}</h2>
          {plugin.installed ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={uninstalling || unavailable}
              onClick={onUninstall}
            >
              {uninstalling ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
              卸载
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              disabled={installing || unavailable}
              onClick={onInstall}
            >
              {installing ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              安装
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {detail?.description ?? plugin.description ?? "此插件由 Codex marketplace 提供。"}
        </p>
        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            正在读取插件详情...
          </div>
        ) : detail ? (
          <DetailRows detail={detail} />
        ) : null}
      </section>
      <section className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="text-xs leading-5 text-muted-foreground">
          Codex 插件的安装、卸载、skills、MCP、apps 和 hooks 生命周期由 Codex app-server 管理。T3
          Code 只负责展示、授权边界和商业化运行环境。
        </div>
      </section>
    </div>
  );
}

function PluginDetailsDialog({
  open,
  plugin,
  builtin,
  builtinId,
  detail,
  detailLoading,
  browserState,
  browserExternalState,
  browserExternalInstalled,
  computerState,
  busyAction,
  installing,
  uninstalling,
  onOpenChange,
  onRefreshBrowser,
  onRefreshBrowserExternal,
  onRestartBrowserExternalSetup,
  onInstallBrowserExternal,
  onRefreshComputer,
  onToggleComputerPaused,
  onAllowForegroundApp,
  onRemovePermission,
  onClearPermissions,
  onInstall,
  onUninstall,
}: {
  readonly open: boolean;
  readonly plugin: PluginSummary | null;
  readonly builtin: BuiltinPlugin | null;
  readonly builtinId: BuiltinPluginId | null;
  readonly detail: PluginDetail | null;
  readonly detailLoading: boolean;
  readonly browserState: DesktopBrowserAutomationState | null;
  readonly browserExternalState: DesktopBrowserExternalAutomationState | null;
  readonly browserExternalInstalled: boolean;
  readonly computerState: DesktopComputerAutomationState | null;
  readonly busyAction: string | null;
  readonly installing: boolean;
  readonly uninstalling: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRefreshBrowser: () => void;
  readonly onRefreshBrowserExternal: () => void;
  readonly onRestartBrowserExternalSetup: () => void;
  readonly onInstallBrowserExternal: () => void;
  readonly onRefreshComputer: () => void;
  readonly onToggleComputerPaused: () => void;
  readonly onAllowForegroundApp: () => void;
  readonly onRemovePermission: (appKey: string) => void;
  readonly onClearPermissions: () => void;
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
}) {
  return (
    <Dialog open={open && plugin !== null} onOpenChange={onOpenChange}>
      {plugin ? (
        <DialogPopup className="max-w-2xl">
          <DialogHeader className="flex-row items-start gap-3 pe-12">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              {builtin?.icon ?? <BlocksIcon className="size-5" />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{plugin.displayName}</DialogTitle>
              <DialogDescription className="mt-1 truncate text-xs">
                {plugin.description ?? plugin.name}
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogPanel className="space-y-5">
            {builtinId === "browser_use" ? (
              <BrowserPluginDetails state={browserState} refresh={onRefreshBrowser} />
            ) : builtinId === "browser_use_external" ? (
              browserExternalInstalled ? (
                <BrowserExternalPluginDetails
                  state={browserExternalState}
                  refresh={onRefreshBrowserExternal}
                  onRestartSetup={onRestartBrowserExternalSetup}
                />
              ) : (
                <BrowserExternalInstallDetails onInstall={onInstallBrowserExternal} />
              )
            ) : builtinId === "computer_use" ? (
              <ComputerPluginDetails
                state={computerState}
                refresh={onRefreshComputer}
                onTogglePaused={onToggleComputerPaused}
                onAllowForeground={onAllowForegroundApp}
                onRemovePermission={onRemovePermission}
                onClearPermissions={onClearPermissions}
                busyAction={busyAction}
              />
            ) : (
              <CodexPluginDetails
                plugin={plugin}
                detail={detail}
                loading={detailLoading}
                installing={installing}
                uninstalling={uninstalling}
                onInstall={onInstall}
                onUninstall={onUninstall}
              />
            )}
          </DialogPanel>
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}

export function PluginsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState<string>("builtin:browser_use");
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [browserState, setBrowserState] = useState<DesktopBrowserAutomationState | null>(null);
  const browserExternalPlugin = useBrowserExternalPluginState();
  const browserExternalState = browserExternalPlugin.state;
  const [computerState, setComputerState] = useState<DesktopComputerAutomationState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const pluginsQuery = useQuery({
    queryKey: PLUGINS_LIST_QUERY,
    queryFn: () => getPluginsClient().list(),
    staleTime: 30_000,
  });

  const allPlugins = useMemo(
    () => pluginsQuery.data?.marketplaces.flatMap((marketplace) => marketplace.plugins) ?? [],
    [pluginsQuery.data],
  );

  const selectedPlugin =
    allPlugins.find((plugin) => plugin.id === selectedPluginId) ?? allPlugins[0] ?? null;

  useEffect(() => {
    if (!selectedPlugin && allPlugins.length > 0) {
      setSelectedPluginId(allPlugins[0]!.id);
    }
  }, [allPlugins, selectedPlugin]);

  const detailQuery = useQuery({
    queryKey: selectedPlugin ? pluginDetailQueryKey(selectedPlugin) : ["plugins", "detail", "none"],
    queryFn: () =>
      selectedPlugin
        ? getPluginsClient().read({
            pluginName: selectedPlugin.location.pluginName,
            marketplacePath: selectedPlugin.location.marketplacePath ?? null,
            remoteMarketplaceName: selectedPlugin.location.remoteMarketplaceName ?? null,
          })
        : Promise.resolve(null),
    enabled: selectedPlugin !== null && detailDialogOpen,
    staleTime: 30_000,
  });

  const installMutation = useMutation({
    mutationFn: (plugin: PluginSummary) =>
      getPluginsClient().install({
        pluginName: plugin.location.pluginName,
        marketplacePath: plugin.location.marketplacePath ?? null,
        remoteMarketplaceName: plugin.location.remoteMarketplaceName ?? null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLUGINS_LIST_QUERY });
      toastManager.add({ type: "success", title: "插件已安装" });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "插件安装失败",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (plugin: PluginSummary) => getPluginsClient().uninstall({ pluginId: plugin.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLUGINS_LIST_QUERY });
      toastManager.add({ type: "success", title: "插件已卸载" });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "插件卸载失败",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const upgradeMutation = useMutation({
    mutationFn: () => getMarketplaceClient().upgrade({ marketplaceName: null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLUGINS_LIST_QUERY });
      toastManager.add({ type: "success", title: "Marketplace 已刷新" });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "刷新失败",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const addMarketplaceMutation = useMutation({
    mutationFn: (source: string) =>
      getMarketplaceClient().add({ source, refName: null, sparsePaths: null }),
    onSuccess: () => {
      setMarketplaceSource("");
      void queryClient.invalidateQueries({ queryKey: PLUGINS_LIST_QUERY });
      toastManager.add({ type: "success", title: "Marketplace 已添加" });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "添加 Marketplace 失败",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

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
      plugin: PluginSummary,
    ): "ready" | "paused" | "unavailable" | "not-installed" | "setup-required" => {
      const id = builtinPluginId(plugin);
      if (!id) {
        if (plugin.availability === "DISABLED_BY_ADMIN") return "unavailable";
        return plugin.installed ? "ready" : "not-installed";
      }
      if (id === "browser_use") return browserState ? "ready" : "unavailable";
      if (id === "browser_use_external") {
        return !browserExternalPlugin.installed
          ? "setup-required"
          : browserExternalState?.connected
            ? "ready"
            : "setup-required";
      }
      if (!computerState || !computerState.available) return "unavailable";
      return computerState.paused ? "paused" : "ready";
    },
    [browserExternalPlugin.installed, browserExternalState?.connected, browserState, computerState],
  );

  const filteredPlugins = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allPlugins;
    return allPlugins.filter((plugin) =>
      [
        plugin.id,
        plugin.name,
        plugin.displayName,
        plugin.description,
        plugin.source.type,
        ...plugin.keywords,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [allPlugins, search]);

  const installedPlugins = filteredPlugins.filter((plugin) => plugin.installed);
  const availablePlugins = filteredPlugins.filter((plugin) => !plugin.installed);
  const selectedBuiltin = selectedPlugin ? builtinMeta(selectedPlugin) : null;
  const selectedBuiltinId = selectedPlugin ? builtinPluginId(selectedPlugin) : null;
  const selectedDetail = detailQuery.data?.plugin ?? null;
  const openPluginDetails = useCallback((pluginId: string) => {
    setSelectedPluginId(pluginId);
    setDetailDialogOpen(true);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-end gap-3 border-b border-border/60 px-8 py-3">
        <form
          className="flex min-w-[280px] items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const source = marketplaceSource.trim();
            if (source.length > 0) addMarketplaceMutation.mutate(source);
          }}
        >
          <Input
            value={marketplaceSource}
            onChange={(event) => setMarketplaceSource(event.target.value)}
            placeholder="Git marketplace URL"
            className="h-8 text-sm"
          />
          <Button type="submit" size="xs" disabled={addMarketplaceMutation.isPending}>
            {addMarketplaceMutation.isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PlugIcon className="size-3.5" />
            )}
            添加
          </Button>
        </form>
        <Button
          size="xs"
          variant="ghost"
          disabled={upgradeMutation.isPending}
          onClick={() => {
            refreshBrowser();
            refreshBrowserExternal();
            refreshComputer();
            upgradeMutation.mutate();
          }}
        >
          <RefreshCcwIcon
            className={upgradeMutation.isPending ? "size-3.5 animate-spin" : "size-3.5"}
          />
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
        <div className="mx-auto w-full max-w-4xl px-8 py-10">
          <div>
            <div>
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
                插件
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                管理运行时插件、T3 内置桥接能力、自动化入口和授权边界。
              </p>
            </div>

            {pluginsQuery.isLoading ? (
              <div className="mt-8 flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                正在读取插件...
              </div>
            ) : null}
            {pluginsQuery.isError ? (
              <div className="mt-8 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {pluginsQuery.error instanceof Error
                  ? pluginsQuery.error.message
                  : "插件列表读取失败。"}
              </div>
            ) : null}
            {pluginsQuery.data?.marketplaceLoadErrors.length ? (
              <div className="mt-8 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
                {pluginsQuery.data.marketplaceLoadErrors.map((error, index) => (
                  <div key={`${error.marketplacePath ?? "marketplace"}:${index}`}>
                    {error.marketplacePath ? `${error.marketplacePath}: ` : null}
                    {error.message}
                  </div>
                ))}
              </div>
            ) : null}

            <section className="mt-8">
              <h2 className="text-[13px] font-medium text-muted-foreground">已安装</h2>
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1">
                {installedPlugins.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <BlocksIcon className="size-4" />
                    没有匹配的插件。
                  </div>
                ) : (
                  installedPlugins.map((plugin) => (
                    <PluginSummaryCard
                      key={plugin.id}
                      plugin={plugin}
                      active={selectedPlugin?.id === plugin.id}
                      status={pluginStatus(plugin)}
                      onSelect={() => openPluginDetails(plugin.id)}
                    />
                  ))
                )}
              </div>
            </section>

            {availablePlugins.length > 0 ? (
              <section className="mt-8">
                <h2 className="text-[13px] font-medium text-muted-foreground">可安装</h2>
                <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1">
                  {availablePlugins.map((plugin) => (
                    <PluginSummaryCard
                      key={plugin.id}
                      plugin={plugin}
                      active={selectedPlugin?.id === plugin.id}
                      status={pluginStatus(plugin)}
                      onSelect={() => openPluginDetails(plugin.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </ScrollArea>
      <PluginDetailsDialog
        open={detailDialogOpen}
        plugin={selectedPlugin}
        builtin={selectedBuiltin}
        builtinId={selectedBuiltinId}
        detail={selectedDetail}
        detailLoading={detailQuery.isFetching}
        browserState={browserState}
        browserExternalState={browserExternalState}
        browserExternalInstalled={browserExternalPlugin.installed}
        computerState={computerState}
        busyAction={busyAction}
        installing={installMutation.isPending}
        uninstalling={uninstallMutation.isPending}
        onOpenChange={setDetailDialogOpen}
        onRefreshBrowser={refreshBrowser}
        onRefreshBrowserExternal={refreshBrowserExternal}
        onRestartBrowserExternalSetup={() => browserExternalPlugin.setInstalled(false)}
        onInstallBrowserExternal={() => browserExternalPlugin.setInstalled(true)}
        onRefreshComputer={refreshComputer}
        onToggleComputerPaused={toggleComputerPaused}
        onAllowForegroundApp={allowForegroundApp}
        onRemovePermission={removePermission}
        onClearPermissions={clearPermissions}
        onInstall={() => {
          if (selectedPlugin) installMutation.mutate(selectedPlugin);
        }}
        onUninstall={() => {
          if (selectedPlugin) uninstallMutation.mutate(selectedPlugin);
        }}
      />
    </div>
  );
}
