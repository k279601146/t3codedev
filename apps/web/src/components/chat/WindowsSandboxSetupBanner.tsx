import type { ServerProvider } from "@t3tools/contracts";
import { LoaderIcon, ShieldAlertIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

type WindowsSandboxBannerKind = "missingSnapshot" | "notConfigured" | "updateRequired" | "error";

interface WindowsSandboxBannerCopy {
  readonly kind: WindowsSandboxBannerKind;
  readonly variant: "warning" | "error";
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
}

function readinessLabel(readiness: string | undefined): string {
  switch (readiness) {
    case "ready":
      return "ready";
    case "notConfigured":
      return "not configured";
    case "updateRequired":
      return "update required";
    case "error":
      return "error";
    default:
      return readiness ?? "unknown";
  }
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
      variant: "warning",
      title: "设置 Agent 沙箱以继续",
      description: "尚未收到 Windows sandbox 状态。请初始化 elevated 沙箱并重新检查。",
      actionLabel: "设置",
    };
  }

  switch (sandbox.readiness) {
    case "ready":
      return null;
    case "notConfigured":
      return {
        kind: "notConfigured",
        variant: "warning",
        title: "设置 Agent 沙箱以继续",
        description: "Windows elevated 沙箱尚未初始化，本地命令可能无法稳定运行。",
        actionLabel: "设置",
      };
    case "updateRequired":
      return {
        kind: "updateRequired",
        variant: "warning",
        title: "更新 Agent 沙箱以继续",
        description: "Windows elevated 沙箱需要更新；更新完成前命令执行和网络隔离可能失败。",
        actionLabel: "更新",
      };
    case "error":
      return {
        kind: "error",
        variant: "error",
        title: "Agent 沙箱设置失败",
        description:
          sandbox.lastError ??
          "Windows elevated 沙箱当前不可用，请重新初始化；如果被系统策略阻止，可在设置页排查。",
        actionLabel: "重试",
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
  const [localError, setLocalError] = useState<string | null>(null);
  const copy = useMemo(() => deriveWindowsSandboxBannerCopy(provider), [provider]);
  const isWindows = platformOs === "windows";

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
      toastManager.add(
        stackedThreadToast({
          type: result.windowsSandbox.readiness === "ready" ? "success" : "warning",
          title:
            result.windowsSandbox.readiness === "ready"
              ? "Agent 沙箱已就绪"
              : result.started
                ? "Agent 沙箱设置已启动"
                : "Agent 沙箱设置未启动",
          description:
            result.windowsSandbox.lastError ??
            `当前 readiness: ${readinessLabel(result.windowsSandbox.readiness)}`,
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法启动 Windows elevated 沙箱设置。";
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

  const description = localError
    ? `${copy.description} ${localError}`
    : isSettingUp
      ? "正在打开 Windows 管理员授权窗口并初始化 elevated 沙箱..."
      : copy.description;

  return (
    <div className="mx-auto max-w-3xl pt-3">
      <Alert variant={localError ? "error" : copy.variant} className="rounded-2xl px-4 py-3.5">
        {isSettingUp ? <LoaderIcon className="animate-spin" /> : <ShieldAlertIcon />}
        <AlertTitle>{isSettingUp ? "正在设置 Agent 沙箱" : copy.title}</AlertTitle>
        <AlertDescription title={description}>
          <p className="line-clamp-3">{description}</p>
        </AlertDescription>
        <AlertAction className="items-center">
          <Button type="button" size="xs" disabled={isSettingUp} onClick={() => void handleSetup()}>
            {isSettingUp ? (
              <>
                <LoaderIcon className="size-3 animate-spin" />
                <span>设置中</span>
              </>
            ) : (
              copy.actionLabel
            )}
          </Button>
          {onOpenSettings ? (
            <Button type="button" size="xs" variant="outline" onClick={onOpenSettings}>
              查看设置
            </Button>
          ) : null}
        </AlertAction>
      </Alert>
    </div>
  );
});
