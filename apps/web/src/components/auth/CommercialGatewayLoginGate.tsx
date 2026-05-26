import type { DesktopCommercialAuthState } from "@t3tools/contracts";
import { resolveCommercialEngineGatewayBaseUrl } from "@t3tools/shared/commercialEngine";
import { CheckIcon, ExternalLinkIcon, LoaderIcon, LogInIcon, XIcon } from "lucide-react";
import type React from "react";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { APP_BASE_NAME } from "../../branding";
import {
  publishDesktopCommercialAuthState,
  readDesktopCommercialAuthStateSnapshot,
  subscribeDesktopCommercialAuthState,
} from "../../commercialAuthState";
import { useI18n } from "../../i18n";
import { OpenAI } from "../Icons";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
  const [webAccessToken, setWebAccessToken] = useState("");
  const [isBrowserSignIn, setIsBrowserSignIn] = useState(false);
  const [isTokenSignIn, setIsTokenSignIn] = useState(false);
  const [showTokenFallback, setShowTokenFallback] = useState(false);
  const [currentErrorMessage, setCurrentErrorMessage] = useState(errorMessage ?? "");
  const browserSignInRequestIdRef = useRef<string | null>(null);
  const gatewayBaseUrl = authState?.gatewayBaseUrl || resolveCommercialEngineGatewayBaseUrl();
  const registerGatewayBaseUrl = gatewayBaseUrl;

  useEffect(() => {
    setCurrentErrorMessage(errorMessage ?? "");
  }, [errorMessage]);

  const canBrowserSignIn = Boolean(bridge?.signInCommercialAuthWithBrowser);
  const canTokenSignIn = Boolean(bridge?.signInCommercialAuth) && webAccessToken.trim().length > 0;
  const isWorking = isBrowserSignIn || isTokenSignIn;

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
      .signInCommercialAuthWithBrowser({ gatewayBaseUrl, requestId })
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
  }, [bridge, gatewayBaseUrl, isBrowserSignIn, onAuthenticated]);

  const handleTokenSignIn = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!bridge?.signInCommercialAuth) return;
      setIsTokenSignIn(true);
      setCurrentErrorMessage("");
      void bridge
        .signInCommercialAuth({
          gatewayBaseUrl,
          webAccessToken,
        })
        .then((nextState) => {
          setWebAccessToken("");
          publishDesktopCommercialAuthState(nextState);
          startTransition(() => onAuthenticated(nextState));
        })
        .catch((error: unknown) => {
          setCurrentErrorMessage(errorMessageFromUnknown(error));
        })
        .finally(() => {
          setIsTokenSignIn(false);
        });
    },
    [bridge, gatewayBaseUrl, onAuthenticated, webAccessToken],
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <section className="flex w-full max-w-[360px] flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#6f7cff,#2548ff)] text-white shadow-[0_14px_32px_rgba(37,72,255,0.22)]">
          <span className="text-lg font-semibold leading-none">{APP_BASE_NAME.slice(0, 1)}</span>
        </div>

        <h1 className="mt-8 text-3xl font-semibold tracking-normal">
          {t("auth.welcome", { appName: APP_BASE_NAME })}
        </h1>

        <div className="mt-4 inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[#eef2ff] px-3 text-sm font-medium text-[#3154ff] dark:bg-white/10 dark:text-[#9facff]">
          <CheckIcon className="size-4 shrink-0" />
          <span className="truncate">{t("auth.planIncluded")}</span>
        </div>

        <div className="mt-8 flex w-full flex-col gap-3">
          <Button
            className="h-12 w-full rounded-full border-neutral-900 bg-neutral-900 text-[15px] text-white shadow-none hover:bg-neutral-800 dark:border-white dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            disabled={isTokenSignIn || !canBrowserSignIn}
            onClick={handleBrowserSignIn}
            size="lg"
          >
            {isBrowserSignIn ? <XIcon className="size-4" /> : <OpenAI className="size-4" />}
            <span>{isBrowserSignIn ? t("auth.cancelLogin") : t("auth.continueWithAccount")}</span>
            {!isBrowserSignIn ? <ExternalLinkIcon className="size-4 opacity-70" /> : null}
          </Button>

          <Button
            className="h-12 w-full rounded-full border-neutral-200 bg-white text-[15px] text-neutral-950 shadow-none hover:bg-neutral-50 dark:border-white/12 dark:bg-neutral-950 dark:text-neutral-50 dark:hover:bg-white/6"
            disabled={isWorking}
            onClick={() => setShowTokenFallback((value) => !value)}
            size="lg"
            variant="outline"
          >
            <LogInIcon className="size-4" />
            <span>{t("auth.otherLogin")}</span>
          </Button>
        </div>

        {showTokenFallback ? (
          <form className="mt-4 w-full space-y-3" onSubmit={handleTokenSignIn}>
            <Input
              className="rounded-full border-neutral-200 bg-white text-left dark:border-white/12 dark:bg-neutral-950"
              nativeInput
              onChange={(event) => setWebAccessToken(event.currentTarget.value)}
              placeholder={t("auth.webAccessToken")}
              spellCheck={false}
              type="password"
              value={webAccessToken}
            />
            <Button
              className="h-10 w-full rounded-full"
              disabled={isWorking || !canTokenSignIn}
              type="submit"
            >
              {isTokenSignIn ? <LoaderIcon className="size-4 animate-spin" /> : null}
              <span>{isTokenSignIn ? t("auth.connecting") : t("auth.connect")}</span>
            </Button>
          </form>
        ) : null}

        {currentErrorMessage ? (
          <p className="mt-4 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm leading-5 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {currentErrorMessage}
          </p>
        ) : null}

        {registerGatewayBaseUrl ? (
          <button
            className="mt-5 cursor-pointer text-sm text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
            onClick={() => {
              const registerUrl = resolveRegisterUrl(registerGatewayBaseUrl);
              void window.desktopBridge?.openExternal(registerUrl);
            }}
            type="button"
          >
            {t("auth.register")}
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function CommercialGatewayLoginPending() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <section className="flex w-full max-w-[360px] flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#6f7cff,#2548ff)] text-white shadow-[0_14px_32px_rgba(37,72,255,0.22)]">
          <LoaderIcon className="size-5 animate-spin" />
        </div>
        <h1 className="mt-8 text-3xl font-semibold tracking-normal">{t("auth.checking")}</h1>
      </section>
    </main>
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

function resolveRegisterUrl(gatewayBaseUrl: string): string {
  try {
    const url = new URL(gatewayBaseUrl);
    url.pathname = "/register";
    url.search = "";
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
