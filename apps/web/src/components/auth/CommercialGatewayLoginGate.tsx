import type { DesktopCommercialAuthState } from "@t3tools/contracts";
import {
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineWebAuthBaseUrl,
} from "@t3tools/shared/commercialEngine";
import { ArrowRightIcon, Code2Icon, LoaderIcon, XIcon } from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

export interface CommercialAuthErrorMessages {
  readonly failed: string;
  readonly timedOut: string;
  readonly cancelled: string;
  readonly browserOpenFailed: string;
  readonly authorizationFailed: string;
  readonly tokenExchangeFailed: string;
  readonly secureStorageUnavailable: string;
}

export function useDesktopCommercialAuthGate(enabled: boolean): CommercialAuthGateState {
  const { t } = useI18n();
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const errorMessages = useMemo(() => makeCommercialAuthErrorMessages(t), [t]);
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
          errorMessage: formatCommercialAuthErrorMessage(error, errorMessages),
        });
      });

    return () => {
      disposed = true;
    };
  }, [bridge, canUseCommercialAuth, enabled, errorMessages]);

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
  const errorMessages = useMemo(() => makeCommercialAuthErrorMessages(t), [t]);
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
        setCurrentErrorMessage(formatCommercialAuthErrorMessage(error, errorMessages));
      })
      .finally(() => {
        if (browserSignInRequestIdRef.current === requestId) {
          browserSignInRequestIdRef.current = null;
          setIsBrowserSignIn(false);
        }
      });
  }, [bridge, errorMessages, gatewayBaseUrl, isBrowserSignIn, onAuthenticated, webAuthBaseUrl]);

  return (
    <main className="drag-region relative min-h-screen overflow-hidden bg-background text-foreground">
      <header className="absolute left-7 top-7 flex items-center gap-2 sm:left-10 sm:top-9">
        <span className="flex size-7 items-center justify-center rounded-[7px] border border-border/70 bg-card text-foreground shadow-sm/5">
          <Code2Icon className="size-[15px]" />
        </span>
        <span className="text-[12px] font-medium text-foreground/78">{APP_BASE_NAME}</span>
      </header>

      <section className="mx-auto flex min-h-screen w-full max-w-[460px] flex-col justify-center px-7 py-24 sm:px-10">
        <p className="text-center text-[12px] font-medium text-muted-foreground">
          {t("auth.productTagline")}
        </p>
        <h1 className="mt-4 text-center text-balance text-[36px] font-medium leading-[1.14] text-foreground">
          {t("auth.heroTitle")}
        </h1>
        <p className="mx-auto mt-4 max-w-[360px] text-center text-pretty text-[14px] leading-6 text-muted-foreground">
          {t("auth.heroDescription")}
        </p>

        <div className="mx-auto mt-10 w-full max-w-[300px]">
          <Button
            className="h-[46px] w-full justify-center gap-2 rounded-[8px] border-primary bg-primary px-4 text-[14px] font-medium text-primary-foreground shadow-md shadow-primary/15 transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-primary/90 active:scale-[0.985] disabled:scale-100 disabled:shadow-none sm:h-[46px]"
            disabled={!canBrowserSignIn}
            onClick={handleBrowserSignIn}
          >
            <span>{isBrowserSignIn ? t("auth.cancelLogin") : t("auth.continueWithAccount")}</span>
            {isBrowserSignIn ? <XIcon className="size-4" /> : <ArrowRightIcon className="size-4" />}
          </Button>

          {registerWebAuthBaseUrl ? (
            <p className="mt-4 text-center text-[12px] text-muted-foreground">
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

          {currentErrorMessage ? (
            <p className="mt-5 rounded-[8px] border border-red-500/20 bg-red-500/[0.04] px-3 py-2.5 text-[12px] leading-5 text-red-600 dark:text-red-300">
              {currentErrorMessage}
            </p>
          ) : null}

          <p className="mt-7 text-center text-[12px] leading-5 text-muted-foreground/75">
            {t("auth.signInDescription")}
          </p>
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
        <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
        <h1 className="mt-5 text-[15px] font-medium text-muted-foreground">{t("auth.checking")}</h1>
      </section>
    </main>
  );
}

function makeCommercialAuthErrorMessages(
  t: ReturnType<typeof useI18n>["t"],
): CommercialAuthErrorMessages {
  return {
    failed: t("auth.failed"),
    timedOut: t("auth.errorTimedOut"),
    cancelled: t("auth.errorCancelled"),
    browserOpenFailed: t("auth.errorBrowserOpenFailed"),
    authorizationFailed: t("auth.errorAuthorizationFailed"),
    tokenExchangeFailed: t("auth.errorTokenExchangeFailed"),
    secureStorageUnavailable: t("auth.errorSecureStorageUnavailable"),
  };
}

export function formatCommercialAuthErrorMessage(
  error: unknown,
  messages: CommercialAuthErrorMessages,
): string {
  const rawMessage = extractCommercialAuthErrorMessage(error);
  if (!rawMessage) {
    return messages.failed;
  }

  const message = stripCommercialAuthTechnicalPrefix(rawMessage);
  const normalized = message.toLowerCase();

  if (normalized.includes("timed out waiting for browser sign-in")) {
    return messages.timedOut;
  }
  if (
    normalized.includes("browser sign-in cancelled") ||
    normalized.includes("browser sign-in canceled")
  ) {
    return messages.cancelled;
  }
  if (
    normalized.includes("could not open the browser") ||
    normalized.includes("could not open your browser")
  ) {
    return messages.browserOpenFailed;
  }
  if (
    normalized.includes("browser sign-in did not return an authorization code") ||
    normalized.includes("missing authorization code") ||
    normalized.includes("gateway authorization failed")
  ) {
    return messages.authorizationFailed;
  }
  if (
    normalized.includes("failed to exchange authorization code for an ide token") ||
    normalized.includes("gateway token exchange failed") ||
    normalized.includes("gateway response did not include an ide access token")
  ) {
    return messages.tokenExchangeFailed;
  }
  if (
    normalized.includes("safe storage") ||
    normalized.includes("safestorage") ||
    normalized.includes("secure storage") ||
    normalized.includes("encryption is unavailable")
  ) {
    return messages.secureStorageUnavailable;
  }

  return isCommercialAuthTechnicalMessage(message) ? messages.failed : message;
}

function extractCommercialAuthErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return null;
}

function stripCommercialAuthTechnicalPrefix(message: string): string {
  let next = message.trim();
  for (let index = 0; index < 4; index += 1) {
    const previous = next;
    next = next
      .replace(/^Error invoking remote method '[^']+':\s*/u, "")
      .replace(/^DesktopCommercialAuth(?:PKCE|Exchange|Write|SecretDecode)Error:\s*/u, "")
      .replace(/^ElectronSafeStorage(?:Availability|Encrypt|Decrypt)Error:\s*/u, "")
      .trim();
    if (next === previous) {
      break;
    }
  }
  return next;
}

function isCommercialAuthTechnicalMessage(message: string): boolean {
  if (message.length > 180 || message.includes("\n")) {
    return true;
  }

  const normalized = message.toLowerCase();
  return [
    "error invoking remote method",
    "desktop:",
    "desktopcommercialauth",
    "electron safestorage",
    "econnrefused",
    "enotfound",
    "etimedout",
    "enoent",
    "http://",
    "https://",
    "127.0.0.1",
    "localhost:",
    "oauth",
    "pkce",
    "unexpected token",
    "schema",
    "json",
  ].some((needle) => normalized.includes(needle));
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
