import type { ServerProvider } from "@t3tools/contracts";
import { LoaderIcon, LockKeyholeIcon, RefreshCwIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

type WindowsSandboxBannerKind = "missingSnapshot" | "notConfigured" | "updateRequired" | "error";
const STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER = new Set<string>();

interface WindowsSandboxBannerCopy {
  readonly kind: WindowsSandboxBannerKind;
  readonly tone: "warning" | "error";
  readonly title: string;
  readonly detail: string | null;
}

function deriveWindowsSandboxBannerCopy(
  provider: ServerProvider | null,
): WindowsSandboxBannerCopy | null {
  if (!provider || provider.driver !== "codex") {
    return null;
  }

  const sandbox = provider.windowsSandbox;
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

export const WindowsSandboxSetupBanner = memo(function WindowsSandboxSetupBanner({
  provider,
  platformOs,
  onOpenSettings,
}: {
  provider: ServerProvider | null;
  platformOs: string | null | undefined;
  onOpenSettings?: () => void;
}) {
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [setupStarted, setSetupStarted] = useState(() =>
    provider ? STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.has(provider.instanceId) : false,
  );
  const copy = useMemo(() => deriveWindowsSandboxBannerCopy(provider), [provider]);
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
    if (provider?.windowsSandbox?.readiness === "error" || provider?.windowsSandbox?.lastError) {
      if (provider) {
        STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
      }
      setSetupStarted(false);
    }
    if (provider?.windowsSandbox?.readiness === "ready" && provider) {
      STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
      setSetupStarted(false);
    }
  }, [currentSandboxKey, provider?.windowsSandbox?.lastError, provider?.windowsSandbox?.readiness]);

  const refreshProviders = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await ensureLocalApi().server.refreshProviders();
    } finally {
      setIsRefreshing(false);
    }
  }, []);

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
      await api.server.refreshProviders().catch(() => undefined);
      if (result.started || result.windowsSandbox.readiness === "ready") {
        if (result.windowsSandbox.readiness === "ready") {
          STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
          setSetupStarted(false);
        } else {
          STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.add(provider.instanceId);
          setSetupStarted(true);
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

  const title = setupStarted && !localError ? "Agent 沙箱启动已发起" : copy.title;
  const detail =
    localError ??
    (isSettingUp
      ? "正在打开 Windows 管理员授权窗口"
      : setupStarted
        ? "请完成 Windows 管理员授权；完成后点击检查，ready 后此提示会消失"
        : copy.detail);

  return (
    <div
      className={cn(
        "mb-0.5 flex min-h-12 w-full items-center gap-3 rounded-t-2xl border border-b-0 bg-background px-4 py-2 shadow-sm",
        localError || copy.tone === "error" ? "border-destructive/35" : "border-border/70",
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
        {setupStarted && !localError ? (
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
