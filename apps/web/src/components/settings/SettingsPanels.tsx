import {
  ArchiveIcon,
  ArchiveX,
  LoaderIcon,
  LogInIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultInstanceIdForDriver,
  type DesktopCommercialAuthState,
  type DesktopUpdateChannel,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import {
  DEFAULT_CLIENT_LANGUAGE,
  DEFAULT_LAYOUT_MODE,
  DEFAULT_UNIFIED_SETTINGS,
} from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
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
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktopUpdateReactQuery";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { useShallow } from "zustand/react/shallow";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { formatRelativeTime, formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  hasOneClickUpdateProviderCandidate,
  isProviderUpdateActive,
  type ProviderUpdateCandidate,
} from "../ProviderUpdateLaunchNotification.logic";
import { ProviderInstanceCard } from "./ProviderInstanceCard";
import { DRIVER_OPTIONS, getDriverOption } from "./providerDriverMeta";
import {
  buildProviderInstanceUpdatePatch,
  formatDiagnosticsDescription,
} from "./SettingsPanels.logic";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { ProjectFavicon } from "../ProjectFavicon";
import { useServerObservability, useServerProviders } from "../../rpc/serverState";
import { useI18n } from "../../i18n";

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

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

function withoutProviderInstanceKey<V>(
  record: Readonly<Record<ProviderInstanceId, V>> | undefined,
  key: ProviderInstanceId,
): Record<ProviderInstanceId, V> {
  const next = { ...record } as Record<ProviderInstanceId, V>;
  delete next[key];
  return next;
}

function withoutProviderInstanceFavorites(
  favorites: ReadonlyArray<{ readonly provider: ProviderInstanceId; readonly model: string }>,
  instanceId: ProviderInstanceId,
) {
  return favorites.filter((favorite) => favorite.provider !== instanceId);
}

const PROVIDER_SETTINGS = DRIVER_OPTIONS.map((definition) => ({
  provider: definition.value,
}));

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  useRelativeTimeTick();
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null;

  if (!lastCheckedRelative) {
    return null;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{" "}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
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
          updateState ?? { availableVersion: null, downloadedVersion: null },
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

function sandboxReadinessLabel(readiness: string): string {
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
      return readiness;
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
        const result = await ensureLocalApi().server.windowsSandboxSetupStart({
          providerInstanceId,
          mode: "elevated",
        });
        const fellBackToUnelevated =
          result.windowsSandbox.mode === "unelevated" &&
          result.windowsSandbox.readiness === "ready";
        toastManager.add(
          stackedThreadToast({
            type: fellBackToUnelevated ? "warning" : result.started ? "success" : "warning",
            title: fellBackToUnelevated
              ? "已降级为 unelevated 沙箱"
              : result.started
                ? "Windows 沙箱初始化已启动"
                : "Windows 沙箱初始化未启动",
            description:
              result.windowsSandbox.lastError ??
              `当前模式: ${result.windowsSandbox.mode}，readiness: ${sandboxReadinessLabel(
                result.windowsSandbox.readiness,
              )}`,
          }),
        );
        onRefreshProviders();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "无法初始化 Windows 沙箱",
            description:
              error instanceof Error
                ? error.message
                : "setupStart 调用失败，可临时切换 unelevated 排查。",
          }),
        );
      } finally {
        setSettingUpInstanceId(null);
      }
    },
    [onRefreshProviders],
  );

  return (
    <SettingsSection title="沙箱与权限">
      <SettingsRow
        title="当前有效配置"
        description="T3 显式传给 ai-engine.exe 的官方 Codex 沙箱默认值。"
        status={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <code>sandbox_mode=workspace-write</code>
            <code>approval_policy=on-request</code>
            <code>approvals_reviewer=user</code>
            <code>network_access=false</code>
            <code>windows.sandbox={primarySandbox?.mode ?? "elevated"}</code>
          </span>
        }
      />
      <SettingsRow
        title="权限 Profile"
        description="来自官方 permissionProfile/list。T3 当前三档权限仍使用显式 sandboxPolicy，不与 permission profile 混用。"
        status={
          permissionProfiles.length > 0 ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {permissionProfiles.map((profile) => (
                <span key={`${profile.providerInstanceId}:${profile.id}`}>
                  {profile.id}
                  {profile.description ? `: ${profile.description}` : ""}
                </span>
              ))}
            </span>
          ) : (
            <span>未返回 profile</span>
          )
        }
      />
      {sandboxProviders.length === 0 ? (
        <SettingsRow
          title="Agent 沙箱设置"
          description="尚未收到 Codex provider 的 Windows sandbox readiness。可以直接初始化 elevated 沙箱，或刷新后重新检查。"
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
                  <span>启动 elevated 沙箱</span>
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
            sandbox.readiness === "notConfigured" ||
            sandbox.readiness === "updateRequired" ||
            sandbox.readiness === "error";
          const canRestoreElevated = sandbox.mode === "unelevated" && sandbox.readiness === "ready";
          const settingUp = settingUpInstanceId === provider.instanceId;
          return (
            <SettingsRow
              key={provider.instanceId}
              title={`${provider.displayName ?? provider.instanceId} Agent 沙箱`}
              description={
                sandbox.lastError ??
                (canRestoreElevated
                  ? "当前已降级为 unelevated，用户可以继续使用。修复系统环境后可恢复 elevated。"
                  : needsSetup
                    ? "elevated 沙箱需要初始化或更新。失败时会自动降级到 unelevated，避免阻塞使用。"
                    : "Windows sandbox readiness 来自 ai-engine.exe 的 app-server 协议。")
              }
              status={
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>mode: {sandbox.mode}</span>
                  <span>readiness: {sandboxReadinessLabel(sandbox.readiness)}</span>
                  <span>
                    command runner: {sandbox.commandRunnerAvailable ? "present" : "missing"}
                  </span>
                  <span>setup helper: {sandbox.setupHelperAvailable ? "present" : "missing"}</span>
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
                        ? "恢复 elevated 沙箱"
                        : sandbox.readiness === "error"
                          ? "重新启动 elevated 沙箱"
                          : "启动 elevated 沙箱"}
                    </span>
                  </Button>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    {sandbox.readiness === "ready" ? "ready" : "检查失败"}
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
        ...(authState?.webAuthBaseUrl ? { webAuthBaseUrl: authState.webAuthBaseUrl } : {}),
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
      <SettingsRow
        title={t("settings.gatewayUrl")}
        description={t("settings.gatewayUrlDescription")}
        control={
          <span className="max-w-full truncate text-xs font-medium text-muted-foreground sm:max-w-80">
            {authState?.gatewayBaseUrl ?? t("settings.unavailable")}
          </span>
        }
      />
      <SettingsRow
        title={t("settings.webAuthUrl")}
        description={t("settings.webAuthUrlDescription")}
        control={
          <span className="max-w-full truncate text-xs font-medium text-muted-foreground sm:max-w-80">
            {authState?.webAuthBaseUrl ?? t("settings.unavailable")}
          </span>
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
              aria-label="Commercial gateway web access token"
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

  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

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
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
    ],
    [
      isGitWritingModelDirty,
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
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
    });
    onRestored?.();
  }, [changedSettingLabels, onRestored, setTheme, updateSettings]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

export function GeneralSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { t } = useI18n();
  const observability = useServerObservability();
  const serverProviders = useServerProviders();
  const diagnosticsDescription = formatDiagnosticsDescription({
    localTracingEnabled: observability?.localTracingEnabled ?? false,
    otlpTracesEnabled: observability?.otlpTracesEnabled ?? false,
    otlpTracesUrl: observability?.otlpTracesUrl,
    otlpMetricsEnabled: observability?.otlpMetricsEnabled ?? false,
    otlpMetricsUrl: observability?.otlpMetricsUrl,
  });

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelInstanceEntries = sortProviderInstanceEntries(
    deriveProviderInstanceEntries(serverProviders),
  );
  const textGenInstanceEntry = gitModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const gitModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

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
      </SettingsSection>

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

      <SettingsSection title={t("settings.section.aiGit")}>
        <SettingsRow
          title={t("settings.textGenerationModel")}
          description={t("settings.textGenerationModelDescription")}
          resetAction={
            isGitWritingModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                lockedProvider={null}
                instanceEntries={gitModelInstanceEntries}
                modelOptionsByInstance={gitModelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(instanceId, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider}
                models={
                  // Use the exact instance's models (rather than the
                  // first-kind-match) so a custom text-gen instance like
                  // `codex_personal` gets its own model list, not the
                  // default Codex one.
                  textGenInstanceEntry?.models ?? []
                }
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(
                          textGenInstanceId,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.section.privacy")}>
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

      <SettingsSection title={t("settings.section.about")}>
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow title={<AboutVersionTitle />} description={t("settings.currentVersion")} />
        )}
        <SettingsRow
          title={t("settings.diagnostics")}
          description={diagnosticsDescription}
          control={
            <Button render={<Link to="/settings/diagnostics" />} size="xs" variant="outline">
              {t("settings.viewDiagnostics")}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ProviderSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { t } = useI18n();
  const serverProviders = useServerProviders();
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [isAddInstanceDialogOpen, setIsAddInstanceDialogOpen] = useState(false);
  const [updatingProviderDrivers, setUpdatingProviderDrivers] = useState<
    ReadonlySet<ProviderDriverKind>
  >(() => new Set());
  const [openInstanceDetails, setOpenInstanceDetails] = useState<Record<string, boolean>>({});
  const refreshingRef = useRef(false);

  const providerUpdateCandidates = useMemo(
    () => collectProviderUpdateCandidates(serverProviders),
    [serverProviders],
  );
  const providerUpdateCandidateByInstanceId = useMemo(
    () => new Map(providerUpdateCandidates.map((candidate) => [candidate.instanceId, candidate])),
    [providerUpdateCandidates],
  );
  const visibleProviderSettings = PROVIDER_SETTINGS.filter(
    (providerSettings) =>
      providerSettings.provider !== "cursor" ||
      serverProviders.some(
        (provider) =>
          provider.instanceId === defaultInstanceIdForDriver(ProviderDriverKind.make("cursor")),
      ),
  );
  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest),
          serverProviders[0]!.checkedAt,
        )
      : null;

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void ensureLocalApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  const runProviderUpdate = useCallback(async (candidate: ProviderUpdateCandidate) => {
    let started = false;
    setUpdatingProviderDrivers((previous) => {
      if (previous.has(candidate.driver)) {
        return previous;
      }
      started = true;
      const next = new Set(previous);
      next.add(candidate.driver);
      return next;
    });
    if (!started) {
      return;
    }

    try {
      await ensureLocalApi().server.updateProvider({
        provider: candidate.driver,
        instanceId: candidate.instanceId,
      });
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not update ${PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver}`,
          description:
            error instanceof Error
              ? error.message
              : "The provider update command could not be started.",
        }),
      );
    } finally {
      setUpdatingProviderDrivers((previous) => {
        if (!previous.has(candidate.driver)) {
          return previous;
        }
        const next = new Set(previous);
        next.delete(candidate.driver);
        return next;
      });
    }
  }, []);

  interface InstanceRow {
    readonly instanceId: ProviderInstanceId;
    readonly instance: ProviderInstanceConfig;
    readonly driver: ProviderDriverKind;
    readonly isDefault: boolean;
    readonly isDirty?: boolean;
  }

  const instancesByDriver = new Map<
    ProviderDriverKind,
    Array<[ProviderInstanceId, ProviderInstanceConfig]>
  >();
  for (const [rawId, instance] of Object.entries(settings.providerInstances ?? {})) {
    const driver = instance.driver;
    const list = instancesByDriver.get(driver) ?? [];
    list.push([rawId as ProviderInstanceId, instance]);
    instancesByDriver.set(driver, list);
  }

  const defaultSlotIdsBySource = new Set<string>(
    visibleProviderSettings.map((providerSettings) =>
      String(defaultInstanceIdForDriver(providerSettings.provider)),
    ),
  );

  const rows: InstanceRow[] = [];
  const visibleDriverKinds = new Set<ProviderDriverKind>(
    visibleProviderSettings.map((providerSettings) => providerSettings.provider),
  );

  for (const providerSettings of visibleProviderSettings) {
    type LegacyProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const legacyProviders = settings.providers as Record<string, LegacyProviderSettings>;
    const defaultLegacyProviders = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      LegacyProviderSettings
    >;
    const driver = providerSettings.provider;
    const defaultInstanceId = defaultInstanceIdForDriver(driver);
    const explicitInstance = settings.providerInstances?.[defaultInstanceId];
    const legacyConfig = legacyProviders[providerSettings.provider]!;
    const defaultLegacyConfig = defaultLegacyProviders[providerSettings.provider]!;
    const effectiveInstance: ProviderInstanceConfig =
      explicitInstance ??
      ({
        driver,
        enabled: legacyConfig.enabled,
        config: legacyConfig,
      } satisfies ProviderInstanceConfig);
    const isDirty =
      explicitInstance !== undefined || !Equal.equals(legacyConfig, defaultLegacyConfig);
    rows.push({
      instanceId: defaultInstanceId,
      instance: effectiveInstance,
      driver,
      isDefault: true,
      isDirty,
    });
    for (const [id, instance] of instancesByDriver.get(providerSettings.provider) ?? []) {
      if (id === defaultInstanceId) continue;
      rows.push({ instanceId: id, instance, driver: instance.driver, isDefault: false });
    }
  }
  for (const [driver, list] of instancesByDriver) {
    if (visibleDriverKinds.has(driver)) continue;
    for (const [id, instance] of list) {
      rows.push({
        instanceId: id,
        instance,
        driver: instance.driver,
        isDefault: defaultSlotIdsBySource.has(String(id)),
      });
    }
  }

  const updateProviderInstance = (
    row: InstanceRow,
    next: ProviderInstanceConfig,
    options?: {
      readonly textGenerationModelSelection?: Parameters<
        typeof buildProviderInstanceUpdatePatch
      >[0]["textGenerationModelSelection"];
    },
  ) => {
    updateSettings(
      buildProviderInstanceUpdatePatch({
        settings,
        instanceId: row.instanceId,
        instance: next,
        driver: row.driver,
        isDefault: row.isDefault,
        textGenerationModelSelection: options?.textGenerationModelSelection,
      }),
    );
  };

  const deleteProviderInstance = (id: ProviderInstanceId) => {
    updateSettings({
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, id),
      providerModelPreferences: withoutProviderInstanceKey(settings.providerModelPreferences, id),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], id),
    });
  };

  const updateProviderModelPreferences = (
    instanceId: ProviderInstanceId,
    next: {
      readonly hiddenModels: ReadonlyArray<string>;
      readonly modelOrder: ReadonlyArray<string>;
    },
  ) => {
    const hiddenModels = [...new Set(next.hiddenModels.filter((slug) => slug.trim().length > 0))];
    const modelOrder = [...new Set(next.modelOrder.filter((slug) => slug.trim().length > 0))];
    const rest = withoutProviderInstanceKey(settings.providerModelPreferences, instanceId);
    updateSettings({
      providerModelPreferences:
        hiddenModels.length === 0 && modelOrder.length === 0
          ? rest
          : {
              ...rest,
              [instanceId]: {
                hiddenModels,
                modelOrder,
              },
            },
    });
  };

  const updateProviderFavoriteModels = (
    instanceId: ProviderInstanceId,
    nextFavoriteModels: ReadonlyArray<string>,
  ) => {
    const favoriteModels = [
      ...new Set(nextFavoriteModels.map((slug) => slug.trim()).filter((slug) => slug.length > 0)),
    ];
    updateSettings({
      favorites: [
        ...withoutProviderInstanceFavorites(settings.favorites ?? [], instanceId),
        ...favoriteModels.map((model) => ({ provider: instanceId, model })),
      ],
    });
  };

  const resetDefaultInstance = (driverKind: ProviderDriverKind) => {
    type LegacyProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const defaultLegacyProviders = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      LegacyProviderSettings | undefined
    >;
    const defaultInstanceId = defaultInstanceIdForDriver(driverKind);
    const defaultLegacyProvider = defaultLegacyProviders[driverKind];
    if (defaultLegacyProvider === undefined) return;
    updateSettings({
      providers: {
        ...settings.providers,
        [driverKind]: defaultLegacyProvider,
      } as typeof settings.providers,
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, defaultInstanceId),
      providerModelPreferences: withoutProviderInstanceKey(
        settings.providerModelPreferences,
        defaultInstanceId,
      ),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], defaultInstanceId),
    });
  };

  return (
    <SettingsPageContainer>
      <SandboxPermissionsSection
        providers={serverProviders}
        onRefreshProviders={refreshProviders}
      />

      <SettingsSection
        title={t("settings.providers")}
        headerAction={
          <div className="flex items-center gap-1.5">
            <ProviderLastChecked lastCheckedAt={lastCheckedAt} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsAddInstanceDialogOpen(true)}
                    aria-label={t("settings.addProviderInstance")}
                  >
                    <PlusIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">{t("settings.addProviderInstance")}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={isRefreshingProviders}
                    onClick={() => void refreshProviders()}
                    aria-label={t("settings.refreshProviderStatus")}
                  >
                    {isRefreshingProviders ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                  </Button>
                }
              />
              <TooltipPopup side="top">{t("settings.refreshProviderStatus")}</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        {rows.map((row) => {
          const driverOption = getDriverOption(row.driver);
          const liveProvider = serverProviders.find(
            (candidate) => candidate.instanceId === row.instanceId,
          );
          const updateCandidate = liveProvider
            ? providerUpdateCandidateByInstanceId.get(liveProvider.instanceId)
            : undefined;
          const isDriverUpdateRunning =
            updateCandidate !== undefined &&
            (updatingProviderDrivers.has(updateCandidate.driver) ||
              serverProviders.some(
                (provider) =>
                  provider.driver === updateCandidate.driver && isProviderUpdateActive(provider),
              ));
          const showInlineUpdateButton =
            updateCandidate !== undefined &&
            hasOneClickUpdateProviderCandidate(updateCandidate, serverProviders);
          const canRunInlineUpdate =
            updateCandidate !== undefined &&
            canOneClickUpdateProviderCandidate(updateCandidate, serverProviders) &&
            !updatingProviderDrivers.has(updateCandidate.driver);
          const modelPreferences = settings.providerModelPreferences?.[row.instanceId] ?? {
            hiddenModels: [],
            modelOrder: [],
          };
          const favoriteModels = (settings.favorites ?? [])
            .filter((favorite) => favorite.provider === row.instanceId)
            .map((favorite) => favorite.model);
          const resetLabel = driverOption?.label ?? String(row.driver);
          const headerAction =
            row.isDefault && row.isDirty ? (
              <SettingResetButton
                label={`${resetLabel} provider settings`}
                onClick={() => resetDefaultInstance(row.driver)}
              />
            ) : null;
          return (
            <ProviderInstanceCard
              key={row.instanceId}
              instanceId={row.instanceId}
              instance={row.instance}
              driverOption={driverOption}
              liveProvider={liveProvider}
              isExpanded={openInstanceDetails[row.instanceId] ?? false}
              onExpandedChange={(open) =>
                setOpenInstanceDetails((existing) => ({
                  ...existing,
                  [row.instanceId]: open,
                }))
              }
              onUpdate={(next) => {
                const wasEnabled = row.instance.enabled ?? true;
                const isDisabling = next.enabled === false && wasEnabled;
                const shouldClearTextGen = isDisabling && textGenInstanceId === row.instanceId;
                if (shouldClearTextGen) {
                  updateProviderInstance(row, next, {
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  });
                } else {
                  updateProviderInstance(row, next);
                }
              }}
              onDelete={row.isDefault ? undefined : () => deleteProviderInstance(row.instanceId)}
              headerAction={headerAction}
              hiddenModels={modelPreferences.hiddenModels}
              favoriteModels={favoriteModels}
              modelOrder={modelPreferences.modelOrder}
              onHiddenModelsChange={(hiddenModels) =>
                updateProviderModelPreferences(row.instanceId, {
                  ...modelPreferences,
                  hiddenModels,
                })
              }
              onFavoriteModelsChange={(favoriteModels) =>
                updateProviderFavoriteModels(row.instanceId, favoriteModels)
              }
              onModelOrderChange={(modelOrder) =>
                updateProviderModelPreferences(row.instanceId, {
                  ...modelPreferences,
                  modelOrder,
                })
              }
              onRunUpdate={
                showInlineUpdateButton && updateCandidate
                  ? () => {
                      if (!canRunInlineUpdate) {
                        return;
                      }
                      void runProviderUpdate(updateCandidate);
                    }
                  : undefined
              }
              isUpdating={showInlineUpdateButton ? isDriverUpdateRunning : undefined}
            />
          );
        })}
      </SettingsSection>

      <AddProviderInstanceDialog
        open={isAddInstanceDialogOpen}
        onOpenChange={setIsAddInstanceDialogOpen}
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
