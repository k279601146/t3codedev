import type { ServerProvider, ServerProviderWindowsSandbox } from "@t3tools/contracts";
import { LoaderIcon, LockKeyholeIcon, RefreshCwIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { runElevatedWindowsSandboxSetupFlow } from "../../lib/windowsSandboxSetupFlow";
import {
  getFriendlyProviderInfrastructureMessage,
  getServerProviderLabel,
} from "../../providerStatusCopy";
import { isTransportConnectionErrorMessage } from "../../rpc/transportError";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { deriveWindowsSandboxBannerCopy } from "./WindowsSandboxSetupBanner.logic";

const STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER = new Set<string>();
const CHECKED_WINDOWS_SANDBOX_BY_PROVIDER = new Map<string, ServerProviderWindowsSandbox>();

function formatWindowsSandboxActionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isTransportConnectionErrorMessage(message)) {
    return "本地服务连接刚刚中断，沙箱请求可能仍在后台处理。请稍后进入设置页检查状态。";
  }
  return message.trim().length > 0 ? message : fallback;
}

function readinessDisplayName(readiness: ServerProviderWindowsSandbox["readiness"]): string {
  switch (readiness) {
    case "ready":
      return "ready";
    case "notConfigured":
      return "尚未配置";
    case "updateRequired":
      return "需要启动或更新";
    case "error":
      return "错误";
  }
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
      ? `${provider.instanceId}:${provider.windowsSandbox.mode}:${provider.windowsSandbox.readiness}:${provider.windowsSandbox.updatedAt}:${provider.windowsSandbox.lastError ?? ""}`
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
      CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.set(provider.instanceId, result.windowsSandbox);
      setCheckedSandbox(result.windowsSandbox);
      setSetupStarted(false);
      if (result.windowsSandbox.readiness === "ready") {
        STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
      }
      await api.server.refreshProviders({ instanceId: provider.instanceId }).catch(() => undefined);
    } catch (error) {
      setLocalError(formatWindowsSandboxActionError(error, "无法检查 Windows elevated 沙箱状态。"));
    } finally {
      setIsRefreshing(false);
    }
  }, [provider]);

  const handleSetup = useCallback(async () => {
    if (!provider || isSettingUp) return;
    setIsSettingUp(true);
    setLocalError(null);
    STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.add(provider.instanceId);
    setSetupStarted(true);
    try {
      const api = ensureLocalApi();
      const { result, repairedFirewall, fellBackToUnelevated } =
        await runElevatedWindowsSandboxSetupFlow({
          providerInstanceId: provider.instanceId,
          onChecked: (sandbox) => {
            CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.set(provider.instanceId, sandbox);
            setCheckedSandbox(sandbox);
          },
        });

      await api.server.refreshProviders({ instanceId: provider.instanceId }).catch(() => undefined);
      const latest = result.windowsSandbox;
      CHECKED_WINDOWS_SANDBOX_BY_PROVIDER.set(provider.instanceId, latest);
      setCheckedSandbox(latest);

      if (latest.readiness === "ready") {
        STARTED_WINDOWS_SANDBOX_SETUP_BY_PROVIDER.delete(provider.instanceId);
        setSetupStarted(false);
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: fellBackToUnelevated
              ? "已切换到 unelevated 后备沙箱"
              : repairedFirewall
                ? "Windows elevated 沙箱已修复"
                : "Windows elevated 沙箱已就绪",
            description: fellBackToUnelevated
              ? "Elevated 初始化失败后已自动回退。客户端仍会在基础沙箱保护下运行，之后可在设置中重新尝试 elevated。"
              : undefined,
          }),
        );
        return;
      }

      const message = latest.lastError ?? "Windows elevated 沙箱启动请求未完成。";
      setLocalError(message);
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Agent 沙箱未就绪",
          description: message,
        }),
      );
    } catch (error) {
      const message = formatWindowsSandboxActionError(error, "无法启动 Windows elevated 沙箱。");
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
      ? "正在打开 Windows 管理员授权窗口。"
      : checkedSandbox
        ? `检查结果：${readinessDisplayName(checkedSandbox.readiness)}${
            checkedSandbox.lastError
              ? `，${getFriendlyProviderInfrastructureMessage(
                  provider ? getServerProviderLabel(provider) : "Provider",
                  checkedSandbox.lastError,
                  checkedSandbox.lastError,
                )}`
              : ""
          }。若 elevated 无法完成，客户端会自动回退到 unelevated 后备沙箱。`
        : setupStarted
          ? "请完成 Windows 管理员授权；完成后点击检查。"
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
        {setupStarted && !localError ? (
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
        ) : null}
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
