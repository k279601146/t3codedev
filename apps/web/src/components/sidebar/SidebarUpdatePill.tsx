import {
  DownloadIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron } from "../../env";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktopUpdateReactQuery";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "../desktopUpdate.logic";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function getUpdatePercent(state: Parameters<typeof resolveDesktopUpdateButtonAction>[0] | null) {
  if (!state) return 0;
  if (state.status === "downloaded") return 100;
  if (typeof state.downloadPercent === "number") {
    return Math.max(0, Math.min(100, Math.floor(state.downloadPercent)));
  }
  return state.status === "downloading" ? 0 : 0;
}

function getUpdateDialogStatusLabel(
  state: Parameters<typeof resolveDesktopUpdateButtonAction>[0] | null,
) {
  if (!state) return "准备下载";
  if (state.status === "downloaded") return "准备安装";
  if (state.status === "downloading") return `下载中 ${getUpdatePercent(state)}%`;
  if (state.status === "error") return "更新失败";
  return "准备下载";
}

function getInstallVersion(state: Parameters<typeof resolveDesktopUpdateButtonAction>[0] | null) {
  return state?.downloadedVersion ?? state?.availableVersion ?? null;
}

export function SidebarAppUpdateButton() {
  const queryClient = useQueryClient();
  const state = useDesktopUpdateState().data ?? null;
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const downloadStartedForVersionRef = useRef<string | null>(null);
  const installStartedForVersionRef = useRef<string | null>(null);

  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const visible = isElectron && (action !== "none" || state?.status === "downloading");
  const percent = getUpdatePercent(state);
  const targetVersion = getInstallVersion(state);
  const mandatory = state?.mandatory === true;
  const updateDescription = mandatory
    ? `当前版本 ${state?.currentVersion ?? "未知"} 已低于最低支持版本，需要安装更新后继续使用。`
    : targetVersion
      ? `Bahew ${targetVersion} 已发布，当前版本为 ${state?.currentVersion ?? "未知"}。`
      : "Bahew 有新版本可用。";

  const installUpdate = useCallback(
    (version: string | null) => {
      const bridge = window.desktopBridge;
      if (!bridge || installing) return;
      const installKey = version ?? "unknown";
      if (installStartedForVersionRef.current === installKey) return;
      installStartedForVersionRef.current = installKey;
      setInstalling(true);
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
          if (!result.accepted) {
            installStartedForVersionRef.current = null;
            setInstalling(false);
            return;
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          installStartedForVersionRef.current = null;
          setInstalling(false);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "无法安装更新",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          installStartedForVersionRef.current = null;
          setInstalling(false);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "无法安装更新",
              description: error instanceof Error ? error.message : "安装更新时发生未知错误。",
            }),
          );
        });
    },
    [installing, queryClient],
  );

  useEffect(() => {
    if (!open || !state) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;

    if (state.status === "downloaded") {
      installUpdate(targetVersion);
      return;
    }

    if (action !== "download") return;
    const downloadKey = targetVersion ?? "unknown";
    if (downloadStartedForVersionRef.current === downloadKey) return;
    downloadStartedForVersionRef.current = downloadKey;

    void bridge
      .downloadUpdate()
      .then((result) => {
        setDesktopUpdateStateQueryData(queryClient, result.state);
        if (result.completed) {
          installUpdate(getInstallVersion(result.state));
          return;
        }
        if (!shouldToastDesktopUpdateActionResult(result)) return;
        const actionError = getDesktopUpdateActionError(result);
        if (!actionError) return;
        downloadStartedForVersionRef.current = null;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "无法下载更新",
            description: actionError,
          }),
        );
      })
      .catch((error) => {
        downloadStartedForVersionRef.current = null;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "无法开始下载更新",
            description: error instanceof Error ? error.message : "开始下载时发生未知错误。",
          }),
        );
      });
  }, [action, installUpdate, open, queryClient, state, targetVersion]);

  if (!visible) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (mandatory && !nextOpen) return;
      setOpen(nextOpen);
    }}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="下载应用更新"
              className="no-drag-region inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(true)}
            >
              {state?.status === "downloading" || installing ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
            </button>
          }
        />
        <TooltipPopup side="bottom">发现新版本</TooltipPopup>
      </Tooltip>
      <DialogPopup className="max-w-xl" showCloseButton={!installing && !mandatory}>
        <DialogHeader>
          <DialogTitle>{mandatory ? "必须更新 Bahew" : "发现新版本"}</DialogTitle>
          <DialogDescription>{updateDescription}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                {installing ? "正在安装" : getUpdateDialogStatusLabel(state)}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {installing ? "100%" : `${percent}%`}
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${installing ? 100 : percent}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {installing
                ? "下载完成，正在启动安装程序。"
                : state?.status === "error"
                  ? (state.message ?? "更新失败，请稍后重试。")
                  : mandatory
                    ? "这是强制更新，下载完成后会自动安装。"
                    : "正在下载更新，完成后会自动安装。"}
            </p>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button size="sm" disabled>
            {installing ? (
              <>
                <LoaderCircleIcon className="size-4 animate-spin" />
                正在安装
              </>
            ) : state?.status === "downloading" ? (
              <>
                <LoaderCircleIcon className="size-4 animate-spin" />
                下载中 {percent}%
              </>
            ) : (
              <>
                <LoaderCircleIcon className="size-4 animate-spin" />
                准备下载
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SidebarUpdatePill() {
  const queryClient = useQueryClient();
  const state = useDesktopUpdateState().data ?? null;
  const [dismissed, setDismissed] = useState(false);

  const mandatory = state?.mandatory === true;
  const visible = isElectron && shouldShowDesktopUpdateButton(state) && (!dismissed || mandatory);
  const tooltip = state ? getDesktopUpdateButtonTooltip(state) : "Update available";
  const disabled = isDesktopUpdateButtonDisabled(state);
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";

  const showArm64Warning = isElectron && shouldShowArm64IntelBuildWarning(state);
  const arm64Description =
    state && showArm64Warning ? getArm64IntelBuildWarningDescription(state) : null;

  const handleAction = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !state) return;
    if (disabled || action === "none") return;

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start update download",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(getDesktopUpdateInstallConfirmationMessage(state));
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
    }
  }, [action, disabled, queryClient, state]);

  if (!visible && !showArm64Warning) return null;

  return (
    <div className="flex flex-col gap-1">
      {showArm64Warning && arm64Description && (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
          <TriangleAlertIcon />
          <AlertTitle>Intel build on Apple Silicon</AlertTitle>
          <AlertDescription>{arm64Description}</AlertDescription>
        </Alert>
      )}
      {visible && (
        <div
          className={`group/update relative flex h-7 w-full items-center rounded-lg bg-primary/15 text-xs font-medium text-primary ${
            disabled ? " cursor-not-allowed opacity-60" : ""
          }`}
        >
          <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.update-main:hover]/update:bg-primary/22" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={tooltip}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  className="update-main relative flex h-full flex-1 items-center gap-2 px-2 enabled:cursor-pointer"
                  onClick={handleAction}
                >
                  {action === "install" ? (
                    <>
                      <RotateCwIcon className="size-3.5" />
                      <span>{mandatory ? "必须重启更新" : "Restart to update"}</span>
                    </>
                  ) : state?.status === "downloading" ? (
                    <>
                      <DownloadIcon className="size-3.5" />
                      <span>
                        Downloading
                        {typeof state.downloadPercent === "number"
                          ? ` (${Math.floor(state.downloadPercent)}%)`
                          : "…"}
                      </span>
                    </>
                  ) : (
                    <>
                      <DownloadIcon className="size-3.5" />
                      <span>{mandatory ? "必须更新" : "Update available"}</span>
                    </>
                  )}
                </button>
              }
            />
            <TooltipPopup side="top">{tooltip}</TooltipPopup>
          </Tooltip>
          {action === "download" && !mandatory && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Dismiss update"
                    className="mr-1 inline-flex size-5 items-center justify-center rounded-md text-primary/60 transition-colors hover:text-primary"
                    onClick={() => setDismissed(true)}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                }
              />
              <TooltipPopup side="top">Dismiss until next launch</TooltipPopup>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
