import {
  ArchiveIcon,
  ArchiveX,
  LoaderIcon,
  LogInIcon,
  LogOutIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DesktopCommercialAuthState,
  type DesktopUpdateChannel,
  type ProviderPersonality,
  type ProviderInstanceId,
  type ServerProvider,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import {
  DEFAULT_CLIENT_LANGUAGE,
  DEFAULT_LAYOUT_MODE,
  DEFAULT_PROVIDER_PERSONALITY,
  DEFAULT_UNIFIED_SETTINGS,
} from "@t3tools/contracts/settings";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import {
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateCheckToast,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktopUpdateReactQuery";
import { runElevatedWindowsSandboxSetupFlow } from "../../lib/windowsSandboxSetupFlow";
import { deriveProviderInstanceEntries, sortProviderInstanceEntries } from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { useShallow } from "zustand/react/shallow";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { formatRelativeTime, formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { ProjectFavicon } from "../ProjectFavicon";
import { useServerProviders } from "../../rpc/serverState";
import { useI18n } from "../../i18n";
import {
  getFriendlyProviderInfrastructureMessage,
  getServerProviderLabel,
} from "../../providerStatusCopy";

const THEME_OPTIONS = [
  {
    value: "light",
    labelKey: "settings.themeLight",
  },
  {
    value: "dark",
    labelKey: "settings.themeDark",
  },
  {
    value: "system",
    labelKey: "settings.themeSystem",
  },
] as const;

const LANGUAGE_OPTIONS = ["system", "en", "zh-CN"] as const;
const PERSONALITY_OPTIONS: ReadonlyArray<{
  readonly value: ProviderPersonality;
  readonly labelKey:
    | "settings.personalityFriendly"
    | "settings.personalityPragmatic"
    | "settings.personalityNone";
  readonly descriptionKey:
    | "settings.personalityFriendlyDescription"
    | "settings.personalityPragmaticDescription"
    | "settings.personalityNoneDescription";
}> = [
  {
    value: "friendly",
    labelKey: "settings.personalityFriendly",
    descriptionKey: "settings.personalityFriendlyDescription",
  },
  {
    value: "pragmatic",
    labelKey: "settings.personalityPragmatic",
    descriptionKey: "settings.personalityPragmaticDescription",
  },
  {
    value: "none",
    labelKey: "settings.personalityNone",
    descriptionKey: "settings.personalityNoneDescription",
  },
];

function languageOptionLabel(
  value: (typeof LANGUAGE_OPTIONS)[number],
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (value) {
    case "system":
      return t("settings.languageSystem");
    case "zh-CN":
      return t("settings.languageChinese");
    case "en":
    default:
      return t("settings.languageEnglish");
  }
}

function timestampFormatLabel(
  value: "locale" | "12-hour" | "24-hour",
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (value) {
    case "12-hour":
      return t("settings.timeFormat12Hour");
    case "24-hour":
      return t("settings.timeFormat24Hour");
    case "locale":
    default:
      return t("settings.timeFormatSystem");
  }
}

function personalityOptionLabel(value: ProviderPersonality, t: ReturnType<typeof useI18n>["t"]) {
  return t(
    PERSONALITY_OPTIONS.find((option) => option.value === value)?.labelKey ??
      "settings.personalityFriendly",
  );
}

function AboutVersionTitle() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center gap-2">
      <span>{t("settings.version")}</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const updateStateQuery = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);

  const updateState = updateStateQuery.data ?? null;
  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;

  const handleUpdateChannelChange = useCallback(
    (channel: DesktopUpdateChannel) => {
      const bridge = window.desktopBridge;
      if (
        !bridge ||
        typeof bridge.setUpdateChannel !== "function" ||
        channel === selectedUpdateChannel
      ) {
        return;
      }

      setIsChangingUpdateChannel(true);
      void bridge
        .setUpdateChannel(channel)
        .then((state) => {
          setDesktopUpdateStateQueryData(queryClient, state);
        })
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not change update track",
              description: error instanceof Error ? error.message : "Update track change failed.",
            }),
          );
        })
        .finally(() => {
          setIsChangingUpdateChannel(false);
        });
    },
    [queryClient, selectedUpdateChannel],
  );

  const handleButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: error instanceof Error ? error.message : "Download failed.",
            }),
          );
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(
          updateState ?? { availableVersion: null, downloadedVersion: null, mandatory: false },
        ),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "Install failed.",
            }),
          );
        });
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        setDesktopUpdateStateQueryData(queryClient, result.state);
        const checkToast = getDesktopUpdateCheckToast(result);
        if (checkToast) {
          toastManager.add(
            stackedThreadToast({
              type: checkToast.type,
              title: checkToast.title,
              description: checkToast.description,
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "无法检查更新",
            description: error instanceof Error ? error.message : "更新检查失败，请稍后重试。",
          }),
        );
      });
  }, [queryClient, updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const canRequestManualCheck =
    hasDesktopBridge &&
    typeof window.desktopBridge?.checkForUpdate === "function" &&
    updateState?.status !== "checking" &&
    updateState?.status !== "downloading" &&
    updateState?.status !== "downloaded";
  const buttonDisabled = !hasDesktopBridge
    ? true
    : updateState === null
      ? false
      : action === "none"
        ? !canRequestManualCheck
        : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = {
    download: t("settings.updateDownload"),
    install: t("settings.updateInstall"),
  };
  const statusLabel: Record<string, string> = {
    checking: t("settings.updateChecking"),
    downloading: t("settings.updateDownloading"),
    "up-to-date": t("settings.updateUpToDate"),
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? t("settings.updateCheck");
  const description =
    action === "download" || action === "install"
      ? t("settings.updateAvailable")
      : t("settings.currentVersion");

  return (
    <>
      <SettingsRow
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant={action === "install" ? "default" : "outline"}
                  disabled={buttonDisabled}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          title={t("settings.updateTrack")}
          description={t("settings.updateTrackDesktopDescription")}
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                handleUpdateChannelChange(value as DesktopUpdateChannel);
              }}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                aria-label={t("settings.updateTrack")}
                disabled={isChangingUpdateChannel}
              >
                <SelectValue>
                  {selectedUpdateChannel === "nightly"
                    ? t("settings.updateNightly")
                    : t("settings.updateStable")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("settings.updateStable")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {t("settings.updateNightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          title={t("settings.updateTrack")}
          description={t("settings.updateTrackHostedDescription")}
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label={t("settings.updateTrack")}>
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("settings.updateLatest")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {t("settings.updateNightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
    </>
  );
}

function sandboxReadinessDisplay(readiness: string): string {
  switch (readiness) {
    case "ready":
      return "已就绪";
    case "notConfigured":
      return "尚未配置";
    case "updateRequired":
      return "需要更新";
    case "error":
      return "需要处理";
    default:
      return readiness;
  }
}

function sandboxModeDisplay(mode: string): string {
  switch (mode) {
    case "elevated":
      return "增强隔离";
    case "unelevated":
      return "基础隔离";
    default:
      return mode;
  }
}

function SandboxPermissionsSection({
  providers,
  onRefreshProviders,
}: {
  providers: ReadonlyArray<ServerProvider>;
  onRefreshProviders: () => void;
}) {
  const [settingUpInstanceId, setSettingUpInstanceId] = useState<ProviderInstanceId | null>(null);
  const codexProviders = providers.filter((provider) => provider.driver === "codex");
  const sandboxProviders = codexProviders.filter((provider) => provider.windowsSandbox);
  const primarySandbox = sandboxProviders[0]?.windowsSandbox ?? null;
  const permissionProfiles = codexProviders.flatMap((provider) =>
    (provider.permissionProfiles ?? []).map((profile) => ({
      ...profile,
      providerInstanceId: provider.instanceId,
    })),
  );

  const handleSetup = useCallback(
    async (providerInstanceId: ProviderInstanceId) => {
      setSettingUpInstanceId(providerInstanceId);
      try {
        const { result, repairedFirewall, fellBackToUnelevated } =
          await runElevatedWindowsSandboxSetupFlow({
            providerInstanceId,
          });
        const isReady = result.windowsSandbox.readiness === "ready";
        toastManager.add(
          stackedThreadToast({
            type: isReady ? "success" : "warning",
            title: fellBackToUnelevated
              ? "已切换到基础隔离"
              : isReady
                ? repairedFirewall
                  ? "增强隔离已修复并就绪"
                  : "增强隔离已就绪"
                : result.started
                  ? "增强隔离初始化已启动"
                  : "增强隔离初始化未启动",
            description:
              result.windowsSandbox.lastError ??
              "当前模式：" +
                sandboxModeDisplay(result.windowsSandbox.mode) +
                "，状态：" +
                sandboxReadinessDisplay(result.windowsSandbox.readiness),
          }),
        );
        onRefreshProviders();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "无法初始化隔离环境",
            description:
              error instanceof Error
                ? error.message
                : "初始化调用失败，请检查系统策略后重试。",
          }),
        );
      } finally {
        setSettingUpInstanceId(null);
      }
    },
    [onRefreshProviders],
  );

  return (
    <SettingsSection title="安全与权限">
      <SettingsRow
        title="默认执行权限"
        description="AI 默认只能修改当前工作区文件；需要执行更高风险操作或访问网络时，会先征得你的确认。"
        status={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <span>文件访问：当前工作区</span>
            <span>高风险操作：先询问</span>
            <span>网络访问：默认关闭</span>
            <span>沙箱：{sandboxModeDisplay(primarySandbox?.mode ?? "elevated")}</span>
          </span>
        }
      />
      <SettingsRow
        title="可选权限方案"
        description="如果本地引擎提供额外权限方案，会显示在这里，供对话运行时选择。"
        status={
          permissionProfiles.length > 0 ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {permissionProfiles.map((profile) => (
                <span key={profile.providerInstanceId + ":" + profile.id}>
                  {profile.id}
                  {profile.description ? ": " + profile.description : ""}
                </span>
              ))}
            </span>
          ) : (
            <span>暂无额外方案</span>
          )
        }
      />
      {sandboxProviders.length === 0 ? (
        <SettingsRow
          title="AI 执行环境"
          description="尚未收到本地引擎的隔离环境状态。你可以先尝试启用增强隔离，或刷新后重新检查。"
          control={
            <span className="flex gap-2">
              {codexProviders[0] ? (
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  disabled={settingUpInstanceId === codexProviders[0].instanceId}
                  onClick={() => void handleSetup(codexProviders[0]!.instanceId)}
                >
                  {settingUpInstanceId === codexProviders[0].instanceId ? (
                    <LoaderIcon className="size-3 animate-spin" />
                  ) : (
                    <ShieldCheckIcon className="size-3" />
                  )}
                  <span>启用增强隔离</span>
                </Button>
              ) : null}
              <Button type="button" size="xs" variant="outline" onClick={onRefreshProviders}>
                <RefreshCwIcon className="size-3" />
                <span>刷新</span>
              </Button>
            </span>
          }
        />
      ) : (
        sandboxProviders.map((provider) => {
          const sandbox = provider.windowsSandbox!;
          const needsSetup =
            sandbox.mode === "elevated" &&
            (sandbox.readiness === "notConfigured" ||
              sandbox.readiness === "updateRequired" ||
              sandbox.readiness === "error");
          const canRestoreElevated = sandbox.mode === "unelevated" && sandbox.readiness === "ready";
          const settingUp = settingUpInstanceId === provider.instanceId;
          return (
            <SettingsRow
              key={provider.instanceId}
              title={(provider.displayName ?? provider.instanceId) + " 执行环境"}
              description={
                (sandbox.lastError
                  ? getFriendlyProviderInfrastructureMessage(
                      getServerProviderLabel(provider),
                      sandbox.lastError,
                      sandbox.lastError,
                    )
                  : null) ??
                (canRestoreElevated
                  ? "当前使用基础隔离，仍有基本保护。修复系统环境后，可在这里重新尝试增强隔离。"
                  : needsSetup
                    ? "增强隔离需要初始化或更新；如果当前系统暂时无法启用，会自动使用基础隔离。"
                    : "本地执行环境已准备好，会在隔离保护下处理文件和命令。")
              }
              status={
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>隔离模式：{sandboxModeDisplay(sandbox.mode)}</span>
                  <span>状态：{sandboxReadinessDisplay(sandbox.readiness)}</span>
                  <span>命令执行：{sandbox.commandRunnerAvailable ? "可用" : "不可用"}</span>
                  <span>环境配置工具：{sandbox.setupHelperAvailable ? "可用" : "不可用"}</span>
                </span>
              }
              control={
                needsSetup || canRestoreElevated ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="default"
                    disabled={settingUp}
                    onClick={() => void handleSetup(provider.instanceId)}
                  >
                    {settingUp ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      <ShieldCheckIcon className="size-3" />
                    )}
                    <span>
                      {canRestoreElevated
                        ? "重新尝试增强隔离"
                        : sandbox.readiness === "error"
                          ? "重新启用增强隔离"
                          : "启用增强隔离"}
                    </span>
                  </Button>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    {sandbox.readiness === "ready" ? "已就绪" : "检查失败"}
                  </span>
                )
              }
            />
          );
        })
      )}
    </SettingsSection>
  );
}

function CommercialGatewaySection() {
  const { t } = useI18n();
  const [authState, setAuthState] = useState<DesktopCommercialAuthState | null>(null);
  const [webAccessToken, setWebAccessToken] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const bridge = typeof window !== "undefined" ? window.desktopBridge : undefined;
  const canManageCommercialAuth =
    bridge?.getCommercialAuthState && bridge.signInCommercialAuth && bridge.signOutCommercialAuth;

  useEffect(() => {
    if (!bridge?.getCommercialAuthState) return;
    let disposed = false;
    void bridge
      .getCommercialAuthState()
      .then((state) => {
        if (disposed) return;
        setAuthState(state);
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not load gateway session",
            description: error instanceof Error ? error.message : "Gateway session is unavailable.",
          }),
        );
      });
    return () => {
      disposed = true;
    };
  }, [bridge]);

  const handleSignIn = useCallback(() => {
    if (!bridge?.signInCommercialAuth) return;
    setIsWorking(true);
    void bridge
      .signInCommercialAuth({
        gatewayBaseUrl: authState?.gatewayBaseUrl ?? "",
        webAccessToken,
      })
      .then((state) => {
        setAuthState(state);
        setWebAccessToken("");
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Commercial gateway connected",
            description: state.userLabel ? `Signed in as ${state.userLabel}.` : "IDE token saved.",
          }),
        );
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not connect gateway",
            description: error instanceof Error ? error.message : "Gateway sign-in failed.",
          }),
        );
      })
      .finally(() => {
        setIsWorking(false);
      });
  }, [bridge, webAccessToken]);

  const handleSignOut = useCallback(() => {
    if (!bridge?.signOutCommercialAuth) return;
    setIsWorking(true);
    void bridge
      .signOutCommercialAuth()
      .then((state) => {
        setAuthState(state);
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not clear gateway session",
            description: error instanceof Error ? error.message : "Gateway sign-out failed.",
          }),
        );
      })
      .finally(() => {
        setIsWorking(false);
      });
  }, [bridge]);

  if (!canManageCommercialAuth) {
    return null;
  }

  const signedIn = authState?.signedIn ?? false;
  const canSignIn = webAccessToken.trim().length > 0;

  return (
    <SettingsSection title={t("settings.section.account")}>
      <SettingsRow
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
            {signedIn ? t("settings.gatewayConnected") : t("settings.gatewayNotConnected")}
          </span>
        }
        description={
          signedIn
            ? (authState?.userLabel ?? t("settings.gatewayConnectedDescription"))
            : t("settings.gatewayNotConnectedDescription")
        }
        control={
          signedIn ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={isWorking}
              onClick={handleSignOut}
            >
              {isWorking ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : (
                <LogOutIcon className="size-3" />
              )}
              <span>{t("settings.signOut")}</span>
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="default"
              disabled={isWorking || !canSignIn}
              onClick={handleSignIn}
            >
              {isWorking ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : (
                <LogInIcon className="size-3" />
              )}
              <span>{t("settings.connect")}</span>
            </Button>
          )
        }
      />
      {!signedIn ? (
        <SettingsRow
          title={t("settings.webToken")}
          description={t("settings.webTokenDescription")}
          control={
            <DraftInput
              className="w-full sm:w-80"
              value={webAccessToken}
              onCommit={setWebAccessToken}
              placeholder="eyJ..."
              spellCheck={false}
              type="password"
              aria-label={t("settings.webToken")}
            />
          }
        />
      ) : null}
    </SettingsSection>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "light" ? ["Theme"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? ["Language"] : []),
      ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
        ? ["Visible threads"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? ["Diff whitespace changes"]
        : []),
      ...(settings.autoOpenPlanSidebar !== DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar
        ? ["Auto-open task panel"]
        : []),
      ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
        ? ["Assistant output"]
        : []),
      ...(Duration.toMillis(settings.automaticGitFetchInterval) !==
      Duration.toMillis(DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval)
        ? ["Automatic Git fetch interval"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.layoutMode !== DEFAULT_UNIFIED_SETTINGS.layoutMode ? ["Layout mode"] : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add project base directory"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(!Equal.equals(settings.telemetryConsent, DEFAULT_UNIFIED_SETTINGS.telemetryConsent)
        ? ["Telemetry consent"]
        : []),
    ],
    [
      settings.autoOpenPlanSidebar,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.telemetryConsent,
      settings.addProjectBaseDirectory,
      settings.defaultThreadEnvMode,
      settings.layoutMode,
      settings.diffIgnoreWhitespace,
      settings.diffWordWrap,
      settings.automaticGitFetchInterval,
      settings.enableAssistantStreaming,
      settings.sidebarThreadPreviewCount,
      settings.timestampFormat,
      settings.language,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("light");
    updateSettings({
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      language: DEFAULT_UNIFIED_SETTINGS.language,
      diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      autoOpenPlanSidebar: DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar,
      enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      telemetryConsent: DEFAULT_UNIFIED_SETTINGS.telemetryConsent,
    });
    onRestored?.();
  }, [changedSettingLabels, onRestored, setTheme, updateSettings]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

function CodexGlobalGuidanceSection() {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [filePath, setFilePath] = useState("");
  const [overrideFilePath, setOverrideFilePath] = useState("");
  const [overrideActive, setOverrideActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isDirty = draft !== saved;

  useEffect(() => {
    let disposed = false;

    const loadGuidance = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const guidance = await ensureLocalApi().server.getCodexGlobalGuidance();
        if (disposed) return;
        setDraft(guidance.content);
        setSaved(guidance.content);
        setFilePath(guidance.filePath);
        setOverrideFilePath(guidance.overrideFilePath);
        setOverrideActive(guidance.overrideActive);
      } catch (error) {
        if (disposed) return;
        setLoadError(
          error instanceof Error ? error.message : t("settings.customInstructionsLoadFailed"),
        );
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    };

    void loadGuidance();
    return () => {
      disposed = true;
    };
  }, [t]);

  const handleSave = useCallback(async () => {
    if (isSaving || !isDirty) return;
    setIsSaving(true);
    try {
      const guidance = await ensureLocalApi().server.updateCodexGlobalGuidance({
        content: draft,
      });
      setDraft(guidance.content);
      setSaved(guidance.content);
      setFilePath(guidance.filePath);
      setOverrideFilePath(guidance.overrideFilePath);
      setOverrideActive(guidance.overrideActive);
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: t("settings.customInstructionsSaved"),
          description: guidance.filePath,
        }),
      );
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settings.customInstructionsSaveFailed"),
          description:
            error instanceof Error ? error.message : t("settings.customInstructionsSaveFailed"),
        }),
      );
    } finally {
      setIsSaving(false);
    }
  }, [draft, isDirty, isSaving, t]);

  const description = (
    <>
      {t("settings.customInstructionsDescription")}{" "}
      <a
        className="font-medium text-primary hover:underline"
        href="https://developers.openai.com/codex/guides/agents-md#create-global-guidance"
        rel="noreferrer"
        target="_blank"
      >
        {t("skills.learnMore")}
      </a>
    </>
  );

  const status = (
    <span className="flex flex-col gap-1">
      {filePath ? <span>{filePath}</span> : null}
      {overrideActive ? (
        <span className="text-amber-600 dark:text-amber-400">
          {t("settings.customInstructionsOverrideActive", { path: overrideFilePath })}
        </span>
      ) : null}
      {loadError ? <span className="text-destructive">{loadError}</span> : null}
    </span>
  );

  return (
    <SettingsSection title={t("settings.customInstructions")}>
      <SettingsRow
        title={t("settings.customInstructions")}
        description={description}
        status={status}
        control={
          <Button
            size="xs"
            disabled={isLoading || isSaving || !isDirty}
            onClick={() => void handleSave()}
          >
            {isSaving ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <SaveIcon className="size-3" />
            )}
            {t("settings.save")}
          </Button>
        }
      >
        <div className="pt-3.5">
          <Textarea
            className="min-h-60 rounded-lg"
            value={draft}
            disabled={isLoading}
            placeholder={
              isLoading
                ? t("settings.customInstructionsLoading")
                : t("settings.customInstructionsPlaceholder")
            }
            spellCheck={false}
            onChange={(event) => setDraft(event.currentTarget.value)}
            aria-label={t("settings.customInstructions")}
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

export function GeneralSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { t } = useI18n();
  const serverProviders = useServerProviders();
  const refreshingProvidersRef = useRef(false);

  const refreshProviders = useCallback(() => {
    if (refreshingProvidersRef.current) return;
    refreshingProvidersRef.current = true;
    void ensureLocalApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingProvidersRef.current = false;
      });
  }, []);

  return (
    <SettingsPageContainer>
      <SettingsSection title={t("settings.section.appearance")}>
        <SettingsRow
          title={t("settings.theme")}
          description={t("settings.themeDescription")}
          resetAction={
            theme !== "light" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("light")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {t(
                    THEME_OPTIONS.find((option) => option.value === theme)?.labelKey ??
                      "settings.themeLight",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title={t("settings.layoutMode")}
          description={t("settings.layoutModeDescription")}
          resetAction={
            settings.layoutMode !== DEFAULT_LAYOUT_MODE ? (
              <SettingResetButton
                label="layout mode"
                onClick={() =>
                  updateSettings({
                    layoutMode: DEFAULT_LAYOUT_MODE,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.layoutMode}
              onValueChange={(value) => {
                if (value === "codex" || value === "cursor") {
                  updateSettings({ layoutMode: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label={t("settings.layoutMode")}>
                <SelectValue>{settings.layoutMode === "cursor" ? "Cursor" : "Codex"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="codex">
                  Codex
                </SelectItem>
                <SelectItem hideIndicator value="cursor">
                  Cursor
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title={t("settings.language")}
          description={t("settings.languageDescription")}
          resetAction={
            settings.language !== DEFAULT_CLIENT_LANGUAGE ? (
              <SettingResetButton
                label="language"
                onClick={() =>
                  updateSettings({
                    language: DEFAULT_CLIENT_LANGUAGE,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.language}
              onValueChange={(value) => {
                if (value === "system" || value === "en" || value === "zh-CN") {
                  updateSettings({ language: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Language">
                <SelectValue>{languageOptionLabel(settings.language, t)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {LANGUAGE_OPTIONS.map((value) => (
                  <SelectItem hideIndicator key={value} value={value}>
                    {languageOptionLabel(value, t)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title={t("settings.timeFormat")}
          description={t("settings.timeFormatDescription")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{timestampFormatLabel(settings.timestampFormat, t)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {t("settings.timeFormatSystem")}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {t("settings.timeFormat12Hour")}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {t("settings.timeFormat24Hour")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title={t("settings.personality")}
          description={t("settings.personalityDescription")}
          resetAction={
            settings.defaultProviderPersonality !== DEFAULT_PROVIDER_PERSONALITY ? (
              <SettingResetButton
                label="personality"
                onClick={() =>
                  updateSettings({
                    defaultProviderPersonality: DEFAULT_PROVIDER_PERSONALITY,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultProviderPersonality}
              onValueChange={(value) => {
                if (value === "friendly" || value === "pragmatic" || value === "none") {
                  updateSettings({ defaultProviderPersonality: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-60" aria-label={t("settings.personality")}>
                <SelectValue>
                  {personalityOptionLabel(settings.defaultProviderPersonality, t)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {PERSONALITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="grid min-w-0 gap-0.5 text-left">
                      <span>{t(option.labelKey)}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(option.descriptionKey)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <CodexGlobalGuidanceSection />

      <SandboxPermissionsSection
        providers={serverProviders}
        onRefreshProviders={refreshProviders}
      />

      <SettingsSection title={t("settings.section.editor")}>
        <SettingsRow
          title={t("settings.diffLineWrapping")}
          description={t("settings.diffLineWrappingDescription")}
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
              aria-label={t("settings.diffLineWrapping")}
            />
          }
        />

        <SettingsRow
          title={t("settings.hideWhitespaceChanges")}
          description={t("settings.hideWhitespaceChangesDescription")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label="diff whitespace changes"
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={t("settings.hideWhitespaceChanges")}
            />
          }
        />

        <SettingsRow
          title={t("settings.assistantOutput")}
          description={t("settings.assistantOutputDescription")}
          resetAction={
            settings.enableAssistantStreaming !==
            DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
              <SettingResetButton
                label="assistant output"
                onClick={() =>
                  updateSettings({
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableAssistantStreaming}
              onCheckedChange={(checked) =>
                updateSettings({ enableAssistantStreaming: Boolean(checked) })
              }
              aria-label={t("settings.assistantOutput")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.section.workflow")}>
        <SettingsRow
          title={t("settings.autoOpenTaskPanel")}
          description={t("settings.autoOpenTaskPanelDescription")}
          resetAction={
            settings.autoOpenPlanSidebar !== DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar ? (
              <SettingResetButton
                label="auto-open task panel"
                onClick={() =>
                  updateSettings({
                    autoOpenPlanSidebar: DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.autoOpenPlanSidebar}
              onCheckedChange={(checked) =>
                updateSettings({ autoOpenPlanSidebar: Boolean(checked) })
              }
              aria-label={t("settings.autoOpenTaskPanel")}
            />
          }
        />

        <SettingsRow
          title={t("settings.newThreads")}
          description={t("settings.newThreadsDescription")}
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label={t("settings.newThreads")}>
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree"
                    ? t("settings.threadModeWorktree")
                    : t("settings.threadModeLocal")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  {t("settings.threadModeLocal")}
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  {t("settings.threadModeWorktree")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title={t("settings.addProjectStartsIn")}
          description={t("settings.addProjectStartsInDescription")}
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              className="w-full sm:w-72"
              value={settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder="~/"
              spellCheck={false}
              aria-label={t("settings.addProjectStartsIn")}
            />
          }
        />

        <SettingsRow
          title={t("settings.archiveConfirmation")}
          description={t("settings.archiveConfirmationDescription")}
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={t("settings.archiveConfirmation")}
            />
          }
        />

        <SettingsRow
          title={t("settings.deleteConfirmation")}
          description={t("settings.deleteConfirmationDescription")}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={t("settings.deleteConfirmation")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.section.privacy")}>
        <SettingsRow
          title={t("settings.operationalTelemetry")}
          description={t("settings.operationalTelemetryDescription")}
          resetAction={
            settings.telemetryConsent.operationalTelemetry !==
            DEFAULT_UNIFIED_SETTINGS.telemetryConsent.operationalTelemetry ? (
              <SettingResetButton
                label="operational telemetry"
                onClick={() =>
                  updateSettings({
                    telemetryConsent: {
                      ...settings.telemetryConsent,
                      operationalTelemetry:
                        DEFAULT_UNIFIED_SETTINGS.telemetryConsent.operationalTelemetry,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.telemetryConsent.operationalTelemetry}
              onCheckedChange={(checked) =>
                updateSettings({
                  telemetryConsent: {
                    ...settings.telemetryConsent,
                    operationalTelemetry: Boolean(checked),
                  },
                })
              }
              aria-label={t("settings.operationalTelemetry")}
            />
          }
        />
        <SettingsRow
          title={t("settings.usageAnalytics")}
          description={t("settings.usageAnalyticsDescription")}
          resetAction={
            settings.telemetryConsent.usageAnalytics !==
            DEFAULT_UNIFIED_SETTINGS.telemetryConsent.usageAnalytics ? (
              <SettingResetButton
                label="usage analytics"
                onClick={() =>
                  updateSettings({
                    telemetryConsent: {
                      ...settings.telemetryConsent,
                      usageAnalytics: DEFAULT_UNIFIED_SETTINGS.telemetryConsent.usageAnalytics,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.telemetryConsent.usageAnalytics}
              onCheckedChange={(checked) =>
                updateSettings({
                  telemetryConsent: {
                    ...settings.telemetryConsent,
                    usageAnalytics: Boolean(checked),
                  },
                })
              }
              aria-label={t("settings.usageAnalytics")}
            />
          }
        />
        <SettingsRow
          title={t("settings.crashReporting")}
          description={t("settings.crashReportingDescription")}
          resetAction={
            settings.telemetryConsent.crashReporting !==
            DEFAULT_UNIFIED_SETTINGS.telemetryConsent.crashReporting ? (
              <SettingResetButton
                label="crash reporting"
                onClick={() =>
                  updateSettings({
                    telemetryConsent: {
                      ...settings.telemetryConsent,
                      crashReporting: DEFAULT_UNIFIED_SETTINGS.telemetryConsent.crashReporting,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.telemetryConsent.crashReporting}
              onCheckedChange={(checked) =>
                updateSettings({
                  telemetryConsent: {
                    ...settings.telemetryConsent,
                    crashReporting: Boolean(checked),
                  },
                })
              }
              aria-label={t("settings.crashReporting")}
            />
          }
        />
        <SettingsRow
          title={t("settings.improveProduct")}
          description={t("settings.improveProductDescription")}
          resetAction={
            settings.telemetryConsent.improveProduct !==
            DEFAULT_UNIFIED_SETTINGS.telemetryConsent.improveProduct ? (
              <SettingResetButton
                label="improve product telemetry"
                onClick={() =>
                  updateSettings({
                    telemetryConsent: {
                      ...settings.telemetryConsent,
                      improveProduct: DEFAULT_UNIFIED_SETTINGS.telemetryConsent.improveProduct,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.telemetryConsent.improveProduct}
              onCheckedChange={(checked) =>
                updateSettings({
                  telemetryConsent: {
                    ...settings.telemetryConsent,
                    improveProduct: Boolean(checked),
                  },
                })
              }
              aria-label={t("settings.improveProduct")}
            />
          }
        />
      </SettingsSection>

      <CommercialGatewaySection />
    </SettingsPageContainer>
  );
}

export function AboutSettingsPanel() {
  const { t } = useI18n();

  return (
    <SettingsPageContainer>
      <SettingsSection title={t("settings.section.about")}>
        <SettingsRow
          title={t("settings.about.coreEngine")}
          description={t("settings.about.coreEngineDescription")}
        />
        <SettingsRow
          title={t("settings.about.productPositioning")}
          description={t("settings.about.productPositioningDescription")}
        />
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow title={<AboutVersionTitle />} description={t("settings.currentVersion")} />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ProviderSettingsPanel() {
  const serverProviders = useServerProviders();
  const refreshingRef = useRef(false);

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    void ensureLocalApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = false;
      });
  }, []);

  return (
    <SettingsPageContainer>
      <SandboxPermissionsSection
        providers={serverProviders}
        onRefreshProviders={refreshProviders}
      />
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const { t } = useI18n();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(environmentIds);

  const archivedGroups = useMemo(() => {
    const projectsByEnvironmentAndId = new Map(
      archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.projects.map(
          (project) =>
            [
              `${environmentId}:${project.id}`,
              {
                id: project.id,
                environmentId,
                name: project.title,
                cwd: project.workspaceRoot,
              },
            ] as const,
        ),
      ),
    );
    const threads = archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => ({
        ...thread,
        environmentId,
      })),
    );

    return [...projectsByEnvironmentAndId.values()]
      .map((project) => ({
        project,
        threads: threads
          .filter(
            (thread) =>
              thread.projectId === project.id && thread.environmentId === project.environmentId,
          )
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
      }))
      .filter((group) => group.threads.length > 0);
  }, [archivedSnapshots]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: t("settings.unarchive") },
          { id: "delete", label: t("settings.delete"), destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        try {
          await unarchiveThread(threadRef);
          refreshArchivedThreads();
        } catch (error) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to unarchive thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }

      if (clicked === "delete") {
        await confirmAndDeleteThread(threadRef);
        refreshArchivedThreads();
      }
    },
    [confirmAndDeleteThread, refreshArchivedThreads, t, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection title={t("settings.archivedThreads")}>
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? t("settings.loadingArchivedThreads")
                  : archiveError
                    ? t("settings.couldNotLoadArchivedThreads")
                    : t("settings.noArchivedThreads")}
              </span>
            }
            description={
              isLoadingArchive
                ? t("settings.checkingConnectedEnvironments")
                : (archiveError ?? t("settings.archivedThreadsEmpty"))
            }
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <SettingsRow
                key={thread.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleArchivedThreadContextMenu(
                    scopeThreadRef(thread.environmentId, thread.id),
                    {
                      x: event.clientX,
                      y: event.clientY,
                    },
                  );
                }}
                title={thread.title}
                description={t("settings.archivedAtCreatedAt", {
                  archivedAt: formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt),
                  createdAt: formatRelativeTimeLabel(thread.createdAt),
                })}
                control={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                    onClick={() =>
                      void unarchiveThread(scopeThreadRef(thread.environmentId, thread.id))
                        .then(() => refreshArchivedThreads())
                        .catch((error) => {
                          toastManager.add(
                            stackedThreadToast({
                              type: "error",
                              title: "Failed to unarchive thread",
                              description:
                                error instanceof Error ? error.message : "An error occurred.",
                            }),
                          );
                        })
                    }
                  >
                    <ArchiveX className="size-3.5" />
                    <span>{t("settings.unarchive")}</span>
                  </Button>
                }
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
