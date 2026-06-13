import type { ServerProvider, ServerProviderWindowsSandbox } from "@t3tools/contracts";
import { LoaderIcon, LockKeyholeIcon, RefreshCwIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

type WindowsSandboxBannerKind = "missingSnapshot" | "notConfigured" | "updateRequired" | "error";
const STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER = new Set<string>();
const CHECKED_WINDOWS_SANDBOX_BY_PROVIDER = new Map<string, ServerProviderWindowsSandbox>();

interface WindowsSandboxBannerCopy {
  readonly kind: WindowsSandboxBannerKind;
  readonly tone: "warning" | "error";
  readonly title: string;
  readonly detail: string | null;
}

function deriveWindowsSandboxBannerCopy(
  provider: ServerProvider | null,
  checkedSandbox: ServerProviderWindowsSandbox | null,
): WindowsSandboxBannerCopy | null {
  if (!provider || provider.driver !== "codex") {
    return null;
  }

  const sandbox = checkedSandbox ?? provider.windowsSandbox;
  if (!sandbox) {
    return {
      kind: "missingSnapshot",
      tone: "warning",
      title: "设置 Agent 沙箱以继续",
      detail: "尚未收到 Windows 沙箱状态",
    };
  }

  switch (sandbox.readiness) {
    case "ready":
      return null;
    case "notConfigured":
      return {
        kind: "notConfigured",
        tone: "warning",
        title: "设置 Agent 沙箱以继续",
        detail: "Windows elevated 沙箱尚未初始化",
      };
    case "updateRequired":
      return {
        kind: "updateRequired",
        tone: "warning",
        title: "设置 Agent 沙箱以继续",
        detail: "Windows elevated 沙箱需要启动或更新",
      };
    case "error":
      return {
        kind: "error",
        tone: "error",
        title: "Agent 沙箱启动失败",
        detail: sandbox.lastError ?? "Windows elevated 沙箱当前不可用，可以重新启动初始化流程",
      };
    default:
      return null;
  }
}

function readinessDisplayName(readiness: ServerProviderWindowsSandbox["readiness"]): string {
  switch (readiness) {
    case "ready":
      return "ready";
    case "notConfigured":
      return "尚未配置";
    case "updateRequired":
      return "需要更新或启动";
    case "error":
      return "错误";
  }
}

async function waitForWindowsSandboxReady(input: {
  readonly providerInstanceId: ServerProvider["instanceId"];
  readonly attempts: number;
  readonly delayMs: number;
}): Promise<ServerProviderWindowsSandbox> {
  const api = ensureLocalApi();
  let latest: ServerProviderWindowsSandbox | null = null;
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, input.delayMs));
    }
    const result = await api.server.windowsSandboxReadiness({
      providerInstanceId: input.providerInstanceId,
      mode: "elevated",
    });
    latest = result.windowsSandbox;
    if (latest.readiness === "ready") {
      return latest;
    }
  }
  if (!latest) {
    throw new Error("未收到 Windows 沙箱 readiness。");
  }
  return latest;
}

export const WindowsSandboxSetupBanner = memo(function WindowsSandboxSetupBanner({
  provider,
  platformOs,
  onOpenSettings,
  className,
}: {
  provider: ServerProvider | null;
  platformOs: string | null | undefined;
  onOpenSettings?: () => void;
  className?: string;
}) {
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [setupStarted, setSetupStarted] = useState(() =>
    provider ? STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.has(provider.instanceId) : false,
  );
  const [checkedSandbox, setCheckedSandbox] = useState<ServerProviderWindowsSandbox | null>(() =>
    provider ? (CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.get(provider.instanceId) ?? null) : null,
  );
  const copy = useMemo(
    () => deriveWindowsSandboxBannerCopy(provider, checkedSandbox),
    [checkedSandbox, provider],
  );
  const isWindows = platformOs === "windows";
  const currentSandboxKey =
    provider?.windowsSandbox && provider.driver === "codex"
      ? `${provider.instanceId}:${provider.windowsSandbox.readiness}:${provider.windowsSandbox.updatedAt}:${provider.windowsSandbox.lastError ?? ""}`
      : provider && provider.driver === "codex"
        ? `${provider.instanceId}:missing`
        : null;

  useEffect(() => {
    setLocalError(null);
    setSetupStarted(
      provider ? STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.has(provider.instanceId) : false,
    );
    setCheckedSandbox(
      provider ? (CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.get(provider.instanceId) ?? null) : null,
    );
    if (provider?.windowsSandbox?.readiness === "error" || provider?.windowsSandbox?.lastError) {
      if (provider) {
        STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
        CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.delete(provider.instanceId);
      }
      setSetupStarted(false);
      setCheckedSandbox(null);
    }
    if (provider?.windowsSandbox?.readiness === "ready" && provider) {
      STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
      CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.delete(provider.instanceId);
      setSetupStarted(false);
      setCheckedSandbox(null);
    }
  }, [currentSandboxKey, provider]);

  const refreshProviders = useCallback(async () => {
    if (!provider) {
      return;
    }
    setIsRefreshing(true);
    setLocalError(null);
    try {
      const api = ensureLocalApi();
      const result = await api.server.windowsSandboxReadiness({
        providerInstanceId: provider.instanceId,
        mode: "elevated",
      });
      if (result.windowsSandbox.readiness === "ready") {
        STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
        CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.set(provider.instanceId, result.windowsSandbox);
        setSetupStarted(false);
        setCheckedSandbox(result.windowsSandbox);
      } else {
        CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.set(provider.instanceId, result.windowsSandbox);
        setCheckedSandbox(result.windowsSandbox);
        setSetupStarted(false);
        if (result.windowsSandbox.readiness === "error" || result.windowsSandbox.lastError) {
          STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
          setSetupStarted(false);
        }
      }
      await api.server.refreshProviders({ instanceId: provider.instanceId }).catch(() => undefined);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "无法检查 Windows elevated 沙箱状态。",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [provider]);

  const handleSetup = useCallback(async () => {
    if (!provider || isSettingUp) return;
    setIsSettingUp(true);
    setLocalError(null);
    try {
      const api = ensureLocalApi();
      const result = await api.server.windowsSandboxSetupStart({
        providerInstanceId: provider.instanceId,
        mode: "elevated",
      });
      if (result.started || result.windowsSandbox.readiness === "ready") {
        const latest =
          result.windowsSandbox.readiness === "ready"
            ? result.windowsSandbox
            : await waitForWindowsSandboxReady({
                providerInstanceId: provider.instanceId,
                attempts: 8,
                delayMs: 1_500,
              });
        await api.server
          .refreshProviders({ instanceId: provider.instanceId })
          .catch(() => undefined);
        if (latest.readiness === "ready") {
          STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
          CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.set(provider.instanceId, latest);
          setSetupStarted(false);
          setCheckedSandbox(latest);
        } else {
          STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
          CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.set(provider.instanceId, latest);
          setSetupStarted(false);
          setCheckedSandbox(latest);
        }
      } else {
        const message = result.windowsSandbox.lastError ?? "Windows 沙箱启动请求未被接受。";
        setLocalError(message);
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Agent 沙箱未启动",
            description: message,
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法启动 Windows elevated 沙箱。";
      setLocalError(message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法设置 Agent 沙箱",
          description: message,
        }),
      );
    } finally {
      setIsSettingUp(false);
    }
  }, [isSettingUp, provider]);

  if (!isWindows || !copy) {
    return null;
  }

  const title =
    checkedSandbox && checkedSandbox.readiness !== "ready" && !localError
      ? "Agent 沙箱尚未就绪"
      : setupStarted && !localError
        ? "Agent 沙箱启动已发起"
        : copy.title;
  const detail =
    localError ??
    (isSettingUp
      ? "正在打开 Windows 管理员授权窗口"
      : checkedSandbox
        ? `检查结果：${readinessDisplayName(checkedSandbox.readiness)}${
            checkedSandbox.lastError ? `；${checkedSandbox.lastError}` : ""
          }。请确认管理员授权已完成；如果没有弹窗，请重新启动。`
        : setupStarted
          ? "请完成 Windows 管理员授权；完成后点击检查，ready 后此提示会消失"
          : copy.detail);

  return (
    <div
      className={cn(
        "mb-0.5 flex min-h-12 w-full items-center gap-3 rounded-t-2xl border border-b-0 bg-background px-4 py-2 shadow-sm",
        localError || copy.tone === "error" ? "border-destructive/35" : "border-border/70",
        className,
      )}
    >
      <div
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          localError || copy.tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {isSettingUp ? (
          <LoaderIcon className="size-4 animate-spin" />
        ) : (
          <LockKeyholeIcon className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium leading-5 text-foreground">
          {isSettingUp ? "正在启动 Agent 沙箱" : title}
        </p>
        {detail ? (
          <p
            className={cn(
              "truncate text-[12px] leading-4",
              localError ? "text-destructive" : "text-muted-foreground",
            )}
            title={detail}
          >
            {detail}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {checkedSandbox && checkedSandbox.readiness !== "ready" && !localError ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={isSettingUp}
              onClick={() => void handleSetup()}
              className="h-8 rounded-full px-4"
            >
              {isSettingUp ? (
                <>
                  <LoaderIcon className="size-3 animate-spin" />
                  <span>启动中</span>
                </>
              ) : (
                "启动"
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isRefreshing || isSettingUp}
              onClick={() => void refreshProviders()}
              className="h-8 rounded-full px-4"
            >
              {isRefreshing ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3" />
              )}
              <span>检查</span>
            </Button>
          </>
        ) : setupStarted && !localError ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isRefreshing}
            onClick={() => void refreshProviders()}
            className="h-8 rounded-full px-4"
          >
            {isRefreshing ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            <span>检查</span>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={isSettingUp}
            onClick={() => void handleSetup()}
            className="h-8 rounded-full px-4"
          >
            {isSettingUp ? (
              <>
                <LoaderIcon className="size-3 animate-spin" />
                <span>启动中</span>
              </>
            ) : (
              "启动"
            )}
          </Button>
        )}
        {onOpenSettings ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenSettings}
            className="h-8 rounded-full px-4"
          >
            设置
          </Button>
        ) : null}
      </div>
    </div>
  );
});
