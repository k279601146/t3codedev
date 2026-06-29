import type { DesktopCommercialAuthState } from "@t3tools/contracts";
import {
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineWebAuthBaseUrl,
} from "@t3tools/shared/commercialEngine";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleUserRoundIcon,
  Code2Icon,
  GitBranchIcon,
  LoaderIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { APP_BASE_NAME } from "../../branding";
import {
  publishDesktopCommercialAuthState,
  readDesktopCommercialAuthStateSnapshot,
  subscribeDesktopCommercialAuthState,
} from "../../commercialAuthState";
import { useI18n } from "../../i18n";
import { Button } from "../ui/button";

type CommercialAuthGateState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "signed-in"; authState: DesktopCommercialAuthState }
  | { status: "requires-sign-in"; authState: DesktopCommercialAuthState; errorMessage?: string };

export function useDesktopCommercialAuthGate(enabled: boolean): CommercialAuthGateState {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const [state, setState] = useState<CommercialAuthGateState>(() =>
    enabled && bridge?.getCommercialAuthState && bridge.signInCommercialAuthWithBrowser
      ? { status: "loading" }
      : { status: "unavailable" },
  );
  const canUseCommercialAuth =
    enabled && bridge?.getCommercialAuthState && bridge.signInCommercialAuthWithBrowser;

  useEffect(() => {
    if (!enabled) {
      setState({ status: "unavailable" });
      return;
    }

    if (!canUseCommercialAuth || !bridge?.getCommercialAuthState) {
      setState({ status: "unavailable" });
      return;
    }

    let disposed = false;
    setState({ status: "loading" });
    void bridge
      .getCommercialAuthState()
      .then((authState) => {
        if (disposed) return;
        setState(
          authState.signedIn
            ? { status: "signed-in", authState }
            : { status: "requires-sign-in", authState },
        );
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setState({
          status: "requires-sign-in",
          authState: {
            gatewayBaseUrl: "",
            webAuthBaseUrl: "",
            signedIn: false,
            authenticatedAt: null,
            tokenExpiresAt: null,
            userLabel: null,
          },
          errorMessage: errorMessageFromUnknown(error),
        });
      });

    return () => {
      disposed = true;
    };
  }, [bridge, canUseCommercialAuth, enabled]);

  useEffect(() => {
    if (!enabled || !canUseCommercialAuth) {
      return;
    }

    const applyPublishedState = () => {
      const authState = readDesktopCommercialAuthStateSnapshot();
      if (!authState) {
        return;
      }
      setState(
        authState.signedIn
          ? { status: "signed-in", authState }
          : { status: "requires-sign-in", authState },
      );
    };

    applyPublishedState();
    return subscribeDesktopCommercialAuthState(applyPublishedState);
  }, [canUseCommercialAuth, enabled]);

  return state;
}

export function CommercialGatewayLoginGate({
  authState,
  errorMessage,
  onAuthenticated,
}: {
  authState: DesktopCommercialAuthState | null;
  errorMessage?: string | undefined;
  onAuthenticated: (state: DesktopCommercialAuthState) => void;
}) {
  const { t } = useI18n();
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const [isBrowserSignIn, setIsBrowserSignIn] = useState(false);
  const [currentErrorMessage, setCurrentErrorMessage] = useState(errorMessage ?? "");
  const browserSignInRequestIdRef = useRef<string | null>(null);
  const gatewayBaseUrl = authState?.gatewayBaseUrl || resolveCommercialEngineGatewayBaseUrl();
  const webAuthBaseUrl = resolveCommercialEngineWebAuthBaseUrl();
  const registerWebAuthBaseUrl = webAuthBaseUrl;

  useEffect(() => {
    setCurrentErrorMessage(errorMessage ?? "");
  }, [errorMessage]);

  const canBrowserSignIn = Boolean(bridge?.signInCommercialAuthWithBrowser);

  const handleBrowserSignIn = useCallback(() => {
    if (!bridge?.signInCommercialAuthWithBrowser) return;
    if (isBrowserSignIn) {
      const requestId = browserSignInRequestIdRef.current;
      if (requestId) {
        void bridge.cancelCommercialAuthBrowserSignIn?.({ requestId });
      }
      browserSignInRequestIdRef.current = null;
      setIsBrowserSignIn(false);
      return;
    }

    const requestId = makeBrowserSignInRequestId();
    browserSignInRequestIdRef.current = requestId;
    setIsBrowserSignIn(true);
    setCurrentErrorMessage("");
    void bridge
      .signInCommercialAuthWithBrowser({ gatewayBaseUrl, webAuthBaseUrl, requestId })
      .then((nextState) => {
        if (browserSignInRequestIdRef.current !== requestId) return;
        publishDesktopCommercialAuthState(nextState);
        startTransition(() => onAuthenticated(nextState));
      })
      .catch((error: unknown) => {
        if (browserSignInRequestIdRef.current !== requestId) return;
        setCurrentErrorMessage(errorMessageFromUnknown(error));
      })
      .finally(() => {
        if (browserSignInRequestIdRef.current === requestId) {
          browserSignInRequestIdRef.current = null;
          setIsBrowserSignIn(false);
        }
      });
  }, [bridge, gatewayBaseUrl, isBrowserSignIn, onAuthenticated, webAuthBaseUrl]);

  return (
    <main className="drag-region flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
      <section className="grid w-full max-w-[820px] overflow-visible md:grid-cols-[0.9fr_1.1fr]">
        <div className="relative hidden min-h-[384px] p-8 text-foreground md:flex md:flex-col">
          <div className="absolute inset-0 rounded-[8px] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--muted)_36%,transparent)_0%,transparent_50%),linear-gradient(90deg,color-mix(in_srgb,var(--border)_36%,transparent)_1px,transparent_1px),linear-gradient(180deg,color-mix(in_srgb,var(--border)_30%,transparent)_1px,transparent_1px)] bg-[auto,28px_28px,28px_28px]" />
          <div className="relative flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-[8px] border border-border bg-card text-muted-foreground shadow-sm">
              <Code2Icon className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">{APP_BASE_NAME}</p>
              <p className="text-xs text-muted-foreground">{t("auth.productTagline")}</p>
            </div>
          </div>

          <div className="relative mt-auto max-w-[330px]">
            <p className="text-[11px] font-semibold text-info uppercase">
              {t("auth.ideAssistant")}
            </p>
            <h1 className="mt-3 max-w-[300px] text-[22px] font-semibold leading-snug tracking-normal text-foreground/88">
              {t("auth.heroTitle")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {t("auth.heroDescription")}
            </p>
          </div>

          <div className="relative mt-8 border-y border-border/80 py-2">
            <AuthFeature icon={TerminalSquareIcon} label={t("auth.featureLocalRuntime")} />
            <AuthFeature icon={GitBranchIcon} label={t("auth.featureGitAware")} />
            <AuthFeature icon={ShieldCheckIcon} label={t("auth.featurePrivateToken")} />
          </div>
        </div>

        <div className="flex min-h-[384px] flex-col justify-center border-border/80 px-6 py-8 sm:px-10 md:border-l">
          <div className="mx-auto flex w-full max-w-[360px] flex-col">
            <div className="flex items-center gap-3 md:hidden">
              <div className="flex size-11 items-center justify-center rounded-[8px] border border-border bg-muted text-muted-foreground">
                <Code2Icon className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">{APP_BASE_NAME}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t("auth.productTagline")}
                </p>
              </div>
            </div>

            <div className="mt-8 flex size-12 items-center justify-center rounded-[8px] border border-border bg-muted/70 text-info shadow-sm md:mt-0">
              <SparklesIcon className="size-5" />
            </div>

            <h2 className="mt-6 text-[28px] font-semibold leading-tight tracking-normal">
              {t("auth.welcome", { appName: APP_BASE_NAME })}
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
              {t("auth.signInDescription")}
            </p>

            <div className="mt-5 inline-flex h-8 w-fit max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
              <CheckIcon className="size-4 shrink-0" />
              <span className="truncate">{t("auth.planIncluded")}</span>
            </div>

            <Button
              className="mt-8 h-12 w-full rounded-[8px] border-[#2f6fed] bg-[#2f6fed] px-4 text-[15px] font-medium text-white shadow-[0_10px_22px_rgba(47,111,237,0.20)] hover:border-[#285fd0] hover:bg-[#285fd0] [:hover,[data-pressed]]:!border-[#285fd0] [:hover,[data-pressed]]:!bg-[#285fd0] dark:border-[#77a4ff] dark:bg-[#77a4ff] dark:text-neutral-950 dark:shadow-[0_10px_22px_rgba(119,164,255,0.16)] dark:hover:border-[#8db3ff] dark:hover:bg-[#8db3ff] dark:[:hover,[data-pressed]]:!border-[#8db3ff] dark:[:hover,[data-pressed]]:!bg-[#8db3ff]"
              disabled={!canBrowserSignIn}
              onClick={handleBrowserSignIn}
              size="lg"
            >
              {isBrowserSignIn ? (
                <XIcon className="size-4" />
              ) : (
                <CircleUserRoundIcon className="size-4" />
              )}
              <span>{isBrowserSignIn ? t("auth.cancelLogin") : t("auth.continueWithAccount")}</span>
              {!isBrowserSignIn ? <ArrowRightIcon className="ml-auto size-4 opacity-80" /> : null}
            </Button>

            {currentErrorMessage ? (
              <p className="mt-4 w-full rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-left text-sm leading-5 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {currentErrorMessage}
              </p>
            ) : null}

            {registerWebAuthBaseUrl ? (
              <p className="mt-5 text-center text-sm text-neutral-500 dark:text-neutral-400">
                {t("auth.noAccount")}{" "}
                <button
                  className="cursor-pointer font-medium text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-100"
                  onClick={() => {
                    const registerUrl = resolveRegisterUrl(registerWebAuthBaseUrl);
                    if (!registerUrl) return;
                    void window.desktopBridge?.openExternal(registerUrl);
                  }}
                  type="button"
                >
                  {t("auth.register")}
                </button>
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

export function CommercialGatewayLoginPending() {
  const { t } = useI18n();
  return (
    <main className="drag-region flex min-h-screen items-center justify-center bg-background px-5 py-12 text-foreground">
      <section className="flex w-full max-w-[360px] flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-[8px] border border-border bg-muted text-info shadow-sm">
          <LoaderIcon className="size-5 animate-spin" />
        </div>
        <h1 className="mt-8 text-[28px] font-semibold tracking-normal">{t("auth.checking")}</h1>
      </section>
    </main>
  );
}

function AuthFeature({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border/55 py-2 text-sm text-muted-foreground last:border-b-0">
      <Icon className="size-4 text-info/85" />
      <span>{label}</span>
    </div>
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return "Sign-in failed. Please try again.";
}

function resolveRegisterUrl(webAuthBaseUrl: string): string {
  try {
    const url = new URL("/", webAuthBaseUrl);
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("auth", "register");
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function makeBrowserSignInRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}