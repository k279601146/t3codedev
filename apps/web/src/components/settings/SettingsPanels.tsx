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
  ProviderDriverKind,
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
import { runElevatedWindowsSandboxSetupFlow } from "../../lib/windowsSandboxSetupFlow";
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

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

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
      return "ready";
    case "notConfigured":
      return "\u5c1a\u672a\u914d\u7f6e";
    case "updateRequired":
      return "\u9700\u8981\u66f4\u65b0";
    case "error":
      return "\u9519\u8bef";
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
        const { result, repairedFirewall, fellBackToUnelevated } =
          await runElevatedWindowsSandboxSetupFlow({
            providerInstanceId,
          });
        const isReady = result.windowsSandbox.readiness === "ready";
        toastManager.add(
          stackedThreadToast({
            type: isReady ? "success" : "warning",
            title: fellBackToUnelevated
              ? "\u5df2\u5207\u6362\u5230 unelevated \u540e\u5907\u6c99\u7bb1"
              : isReady
                ? repairedFirewall
                  ? "Windows elevated \u6c99\u7bb1\u5df2\u4fee\u590d\u5e76\u5c31\u7eea"
                  : "Windows elevated \u6c99\u7bb1\u5df2\u5c31\u7eea"
                : result.started
                  ? "Windows elevated \u6c99\u7bb1\u521d\u59cb\u5316\u5df2\u542f\u52a8"
                  : "Windows elevated \u6c99\u7bb1\u521d\u59cb\u5316\u672a\u542f\u52a8",
            description:
              result.windowsSandbox.lastError ??
              "\u5f53\u524d\u6a21\u5f0f: " +
                result.windowsSandbox.mode +
                "\uff0creadiness: " +
                sandboxReadinessDisplay(result.windowsSandbox.readiness),
          }),
        );
        onRefreshProviders();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "\u65e0\u6cd5\u521d\u59cb\u5316 Windows \u6c99\u7bb1",
            description:
              error instanceof Error
                ? error.message
                : "setupStart \u8c03\u7528\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 elevated helper \u548c\u7cfb\u7edf\u7b56\u7565\u3002",
          }),
        );
      } finally {
        setSettingUpInstanceId(null);
      }
    },
    [onRefreshProviders],
  );

  return (
    <SettingsSection title="\u6c99\u7bb1\u4e0e\u6743\u9650">
      <SettingsRow
        title="\u5f53\u524d\u9ed8\u8ba4\u914d\u7f6e"
        description="\u672c\u5730\u5f15\u64ce\u9ed8\u8ba4\u4f7f\u7528 workspace-write \u4e0e on-request\uff1b\u8f93\u5165\u6846\u6743\u9650\u9009\u62e9\u4f1a\u5728 turn/start \u65f6\u8986\u76d6\u4e3a\u5bf9\u5e94 sandboxPolicy\u3002"
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
        title="\u6743\u9650 Profile"
        description="\u6765\u81ea\u5b98\u65b9 permissionProfile/list\u3002\u5f53\u524d\u4e09\u6863\u6743\u9650\u4f7f\u7528\u663e\u5f0f sandboxPolicy\uff1b\u9009\u62e9\u5177\u4f53 profile \u65f6\u624d\u4f1a\u6539\u4f20 permissions\uff0c\u4e8c\u8005\u4e0d\u6df7\u7528\u3002"
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
            <span>\u672a\u8fd4\u56de profile</span>
          )
        }
      />
      {sandboxProviders.length === 0 ? (
        <SettingsRow
          title="Agent \u6c99\u7bb1\u8bbe\u7f6e"
          description="\u5c1a\u672a\u6536\u5230 Codex provider \u7684 Windows sandbox readiness\u3002\u53ef\u4ee5\u76f4\u63a5\u521d\u59cb\u5316 elevated \u6c99\u7bb1\uff0c\u6216\u5237\u65b0\u540e\u91cd\u65b0\u68c0\u67e5\u3002"
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
                  <span>\u542f\u52a8 elevated \u6c99\u7bb1</span>
                </Button>
              ) : null}
              <Button type="button" size="xs" variant="outline" onClick={onRefreshProviders}>
                <RefreshCwIcon className="size-3" />
                <span>\u5237\u65b0</span>
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
              title={(provider.displayName ?? provider.instanceId) + " Agent \u6c99\u7bb1"}
              description={
                (sandbox.lastError
                  ? getFriendlyProviderInfrastructureMessage(
                      getServerProviderLabel(provider),
                      sandbox.lastError,
                      sandbox.lastError,
                    )
                  : null) ??
                (canRestoreElevated
                  ? "\u5f53\u524d\u4f7f\u7528 unelevated \u540e\u5907\u6c99\u7bb1\uff0c\u4ecd\u6709\u57fa\u7840\u9694\u79bb\u4fdd\u62a4\u3002\u4fee\u590d\u7cfb\u7edf\u73af\u5883\u540e\u53ef\u5728\u8fd9\u91cc\u91cd\u65b0\u5c1d\u8bd5 elevated\u3002"
                  : needsSetup
                    ? "Elevated \u6c99\u7bb1\u9700\u8981\u521d\u59cb\u5316\u6216\u66f4\u65b0\uff1b\u5982\u679c\u5e38\u89c1\u539f\u56e0\u65e0\u6cd5\u4fee\u590d\uff0c\u5c06\u81ea\u52a8\u56de\u9000\u5230 unelevated\u3002"
                    : "Windows sandbox readiness \u6765\u81ea ai-engine.exe \u7684 app-server \u534f\u8bae\u3002")
              }
              status={
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>mode: {sandbox.mode}</span>
                  <span>readiness: {sandboxReadinessDisplay(sandbox.readiness)}</span>
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
                        ? "\u91cd\u65b0\u5c1d\u8bd5 elevated"
                        : sandbox.readiness === "error"
                          ? "\u91cd\u65b0\u542f\u52a8 elevated"
                          : "\u542f\u52a8 elevated"}
                    </span>
                  </Button>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    {sandbox.readiness === "ready" ? "ready" : "\u68c0\u67e5\u5931\u8d25"}
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
