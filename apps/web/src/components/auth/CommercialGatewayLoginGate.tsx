import type { DesktopCommercialAuthState } from "@t3tools/contracts";
import {
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineWebAuthBaseUrl,
} from "@t3tools/shared/commercialEngine";
import {
  ArrowRightIcon,
  CheckIcon,
  Code2Icon,
  LoaderIcon,
  XIcon,
} from "lucide-react";
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
    <main className="drag-region relative flex min-h-screen items-center overflow-hidden bg-background px-8 py-16 sm:px-14 lg:justify-center lg:gap-24 lg:px-20">
      <div className="relative z-10 w-full max-w-[480px]">
        <div className="flex items-center gap-2.5">
          <Code2Icon className="size-[18px] text-foreground/70" />
          <span className="text-[13px] font-medium text-foreground/70">{APP_BASE_NAME}</span>
        </div>

        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t("auth.ideAssistant")}
        </p>
        <h1 className="mt-3 text-[40px] font-semibold leading-[1.15] tracking-tight text-foreground sm:text-[46px]">
          {t("auth.heroTitle")}
        </h1>
        <p className="mt-4 max-w-[420px] text-[15px] leading-[1.7] text-muted-foreground">
          {t("auth.heroDescription")}
        </p>
        <p className="mt-2 max-w-[420px] text-[15px] leading-[1.7] text-muted-foreground">
          {t("auth.signInDescription")}
        </p>

        <div className="mt-9 flex items-center gap-2 border-t border-border/70 pt-5 text-[13px] text-muted-foreground">
          <CheckIcon className="size-[14px] shrink-0 text-info" />
          <span>{t("auth.planIncluded")}</span>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            className="h-11 px-6 text-[14px] font-medium sm:w-auto"
            disabled={!canBrowserSignIn}
            onClick={handleBrowserSignIn}
            size="lg"
          >
            <span>{isBrowserSignIn ? t("auth.cancelLogin") : t("auth.continueWithAccount")}</span>
            {isBrowserSignIn ? <XIcon className="size-4" /> : <ArrowRightIcon className="size-4" />}
          </Button>

          {registerWebAuthBaseUrl ? (
            <p className="text-[13px] text-muted-foreground">
              {t("auth.noAccount")}{" "}
              <button
                className="cursor-pointer font-medium text-foreground underline-offset-4 hover:underline"
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

        {currentErrorMessage ? (
          <p className="mt-4 max-w-[420px] border-l-2 border-red-400 pl-3 text-[13px] leading-5 text-red-600 dark:border-red-500/50 dark:text-red-300">
            {currentErrorMessage}
          </p>
        ) : null}
      </div>

      {/* live preview panel — embedded card, not a fake OS window */}
      <div className="relative z-10 hidden w-[360px] shrink-0 lg:block">
        <span className="absolute -top-7 left-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          实时预览
        </span>
        <div className="overflow-hidden rounded-[14px] border border-border/60 bg-[#101113] shadow-[0_30px_70px_-25px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
              <span className="size-[6px] rounded-full bg-emerald-400" />
              运行中
            </span>
            <span className="truncate text-[11.5px] text-zinc-500">为结算页接入优惠券校验逻辑</span>
          </div>

          <div className="flex">
            <div className="w-[100px] shrink-0 border-r border-white/[0.06] px-3 py-3.5">
              <p className="truncate text-[11px] font-medium text-zinc-400">app</p>
              <div className="mt-2.5 space-y-[7px] text-[11px] text-zinc-600">
                <p className="text-zinc-500">▾ src</p>
                <p className="pl-3 text-zinc-600">▾ routes</p>
                <p className="pl-5 text-zinc-300">checkout.tsx</p>
                <p className="pl-3 text-zinc-600">lib/</p>
              </div>
            </div>

            <div className="flex flex-1 flex-col px-4 py-3.5">
              <div className="space-y-[6px]">
                <StepRow done text="读取 src/routes/checkout.tsx" />
                <StepRow done text="新增 validateCoupon 校验函数" />
                <StepRow active text="运行测试 — pnpm test checkout" />
              </div>

              <div className="mt-3.5 overflow-hidden rounded-[8px] border border-white/[0.06] bg-black/30">
                <div className="border-b border-white/[0.06] px-3 py-[7px] font-mono text-[10.5px] text-zinc-500">
                  src/routes/checkout.tsx
                </div>
                <div className="px-3 py-2.5 font-mono text-[11px] leading-[1.85]">
                  <p className="text-zinc-600">12&nbsp;&nbsp;const total = getCartTotal(items);</p>
                  <p className="bg-emerald-500/[0.08] text-emerald-400">
                    13&nbsp;&nbsp;+ const coupon = validateCoupon(code, total);
                  </p>
                  <p className="text-zinc-600">14&nbsp;&nbsp;return total - coupon.discount;</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] px-4 py-2.5 font-mono text-[10.5px] text-zinc-600">
            main · 3 files changed
          </div>
        </div>
      </div>
    </main>
  );
}

function StepRow({ text, done, active }: { text: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span
        className={`flex size-[13px] shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500/15 text-emerald-400" : "border border-white/10 text-transparent"
        }`}
      >
        {done && <CheckIcon className="size-[8px]" strokeWidth={3} />}
      </span>
      <span className={done ? "text-zinc-600 line-through decoration-zinc-700" : active ? "text-zinc-300" : "text-zinc-600"}>
        {text}
      </span>
    </div>
  );
}

export function CommercialGatewayLoginPending() {
  const { t } = useI18n();
  return (
    <main className="drag-region flex min-h-screen items-center justify-center bg-background px-5 py-12 text-foreground">
      <section className="flex w-full max-w-[360px] flex-col items-center text-center">
        <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
        <h1 className="mt-5 text-[15px] font-medium text-muted-foreground">{t("auth.checking")}</h1>
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
