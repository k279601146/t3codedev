import type { DesktopCommercialAuthState } from "@t3tools/contracts";
import { DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL } from "@t3tools/shared/commercialEngine";
import { CheckIcon, ExternalLinkIcon, LoaderIcon, LogInIcon } from "lucide-react";
import type React from "react";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";

import { APP_BASE_NAME } from "../../branding";
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
            gatewayBaseUrl: DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
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
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(
    () => authState?.gatewayBaseUrl ?? DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
  );
  const [webAccessToken, setWebAccessToken] = useState("");
  const [isBrowserSignIn, setIsBrowserSignIn] = useState(false);
  const [isTokenSignIn, setIsTokenSignIn] = useState(false);
  const [showTokenFallback, setShowTokenFallback] = useState(false);
  const [currentErrorMessage, setCurrentErrorMessage] = useState(errorMessage ?? "");

  useEffect(() => {
    if (authState?.gatewayBaseUrl) {
      setGatewayBaseUrl(authState.gatewayBaseUrl);
    }
  }, [authState?.gatewayBaseUrl]);

  useEffect(() => {
    setCurrentErrorMessage(errorMessage ?? "");
  }, [errorMessage]);

  const canBrowserSignIn = Boolean(bridge?.signInCommercialAuthWithBrowser);
  const canTokenSignIn = Boolean(bridge?.signInCommercialAuth) && webAccessToken.trim().length > 0;
  const isWorking = isBrowserSignIn || isTokenSignIn;

  const normalizedGateway = useMemo(() => gatewayBaseUrl.trim(), [gatewayBaseUrl]);

  const handleBrowserSignIn = useCallback(() => {
    if (!bridge?.signInCommercialAuthWithBrowser) return;
    setIsBrowserSignIn(true);
    setCurrentErrorMessage("");
    void bridge
      .signInCommercialAuthWithBrowser({ gatewayBaseUrl: normalizedGateway })
      .then((nextState) => {
        startTransition(() => onAuthenticated(nextState));
      })
      .catch((error: unknown) => {
        setCurrentErrorMessage(errorMessageFromUnknown(error));
      })
      .finally(() => {
        setIsBrowserSignIn(false);
      });
  }, [bridge, normalizedGateway, onAuthenticated]);

  const handleTokenSignIn = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!bridge?.signInCommercialAuth) return;
      setIsTokenSignIn(true);
      setCurrentErrorMessage("");
      void bridge
        .signInCommercialAuth({
          gatewayBaseUrl: normalizedGateway,
          webAccessToken,
        })
        .then((nextState) => {
          setWebAccessToken("");
          startTransition(() => onAuthenticated(nextState));
        })
        .catch((error: unknown) => {
          setCurrentErrorMessage(errorMessageFromUnknown(error));
        })
        .finally(() => {
          setIsTokenSignIn(false);
        });
    },
    [bridge, normalizedGateway, onAuthenticated, webAccessToken],
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <section className="flex w-full max-w-[360px] flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#6f7cff,#2548ff)] text-white shadow-[0_14px_32px_rgba(37,72,255,0.22)]">
          <span className="text-lg font-semibold leading-none">{APP_BASE_NAME.slice(0, 1)}</span>
        </div>

        <h1 className="mt-8 text-3xl font-semibold tracking-normal">欢迎使用 {APP_BASE_NAME}</h1>

        <div className="mt-4 inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[#eef2ff] px-3 text-sm font-medium text-[#3154ff] dark:bg-white/10 dark:text-[#9facff]">
          <CheckIcon className="size-4 shrink-0" />
          <span className="truncate">所有 IDE 套餐均包含</span>
        </div>

        <div className="mt-8 flex w-full flex-col gap-3">
          <Button
            className="h-12 w-full rounded-full border-neutral-900 bg-neutral-900 text-[15px] text-white shadow-none hover:bg-neutral-800 dark:border-white dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            disabled={isWorking || !canBrowserSignIn}
            onClick={handleBrowserSignIn}
            size="lg"
          >
            {isBrowserSignIn ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <OpenAI className="size-4" />
            )}
            <span>{isBrowserSignIn ? "等待浏览器授权" : "使用账户继续"}</span>
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
            <span>使用其他方式登录</span>
          </Button>
        </div>

        <label className="mt-5 w-full text-left text-xs font-medium text-neutral-500">
          Gateway
          <Input
            className="mt-2 rounded-full border-neutral-200 bg-white text-left dark:border-white/12 dark:bg-neutral-950"
            nativeInput
            onChange={(event) => setGatewayBaseUrl(event.currentTarget.value)}
            spellCheck={false}
            value={gatewayBaseUrl}
          />
        </label>

        {showTokenFallback ? (
          <form className="mt-4 w-full space-y-3" onSubmit={handleTokenSignIn}>
            <Input
              className="rounded-full border-neutral-200 bg-white text-left dark:border-white/12 dark:bg-neutral-950"
              nativeInput
              onChange={(event) => setWebAccessToken(event.currentTarget.value)}
              placeholder="Web access token"
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
              <span>{isTokenSignIn ? "正在连接" : "连接"}</span>
            </Button>
          </form>
        ) : null}

        {currentErrorMessage ? (
          <p className="mt-4 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm leading-5 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {currentErrorMessage}
          </p>
        ) : null}

        <button
          className="mt-5 cursor-pointer text-sm text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
          onClick={() => {
            const registerUrl = resolveRegisterUrl(
              normalizedGateway || DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
            );
            void window.desktopBridge?.openExternal(registerUrl);
          }}
          type="button"
        >
          注册
        </button>
      </section>
    </main>
  );
}

export function CommercialGatewayLoginPending() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <section className="flex w-full max-w-[360px] flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#6f7cff,#2548ff)] text-white shadow-[0_14px_32px_rgba(37,72,255,0.22)]">
          <LoaderIcon className="size-5 animate-spin" />
        </div>
        <h1 className="mt-8 text-3xl font-semibold tracking-normal">正在检查登录状态</h1>
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
  return "登录失败，请稍后再试。";
}

function resolveRegisterUrl(gatewayBaseUrl: string): string {
  try {
    const url = new URL(gatewayBaseUrl);
    url.pathname = "/register";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "https://api.yourservice.com/register";
  }
}
