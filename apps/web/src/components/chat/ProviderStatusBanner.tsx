import { type ServerProvider } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, LoaderIcon, RefreshCwIcon, XIcon } from "lucide-react";
import {
  getProviderStatusAlertCopy,
  shouldShowProviderStatusBanner,
} from "../../providerStatusCopy";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import {
  getWsConnectionUiState,
  type WsConnectionUiState,
  useWsConnectionStatus,
} from "../../rpc/wsConnectionState";
import { usePendingRpcAckRequests } from "../../rpc/requestLatencyState";

const DISMISSED_PROVIDER_STATUS_BANNERS = new Set<string>();

function getProviderStatusBannerDismissKey(provider: ServerProvider): string {
  return [
    provider.instanceId,
    provider.status,
    provider.auth.status,
    provider.message ?? "",
  ].join(":");
}

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status: provider,
}: {
  status: ServerProvider | null;
}) {
  const wsStatus = useWsConnectionStatus();
  const wsUiState = getWsConnectionUiState(wsStatus);
  const pendingRpcAckRequests = usePendingRpcAckRequests();
  const hasPendingBackendRequests = pendingRpcAckRequests.length > 0;
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const previousWsUiStateRef = useRef<WsConnectionUiState>(wsUiState);
  const previousHasPendingBackendRequestsRef = useRef(hasPendingBackendRequests);
  const backendIdleRecoverySequenceRef = useRef(0);
  const lastAutoRefreshKeyRef = useRef<string | null>(null);
  const dismissKey = provider ? getProviderStatusBannerDismissKey(provider) : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(() =>
    dismissKey && DISMISSED_PROVIDER_STATUS_BANNERS.has(dismissKey) ? dismissKey : null,
  );

  const refreshProviderStatus = useCallback(async () => {
    if (!provider || isRetrying) {
      return;
    }

    setIsRetrying(true);
    setRetryError(null);
    try {
      await ensureLocalApi().server.refreshProviders({ instanceId: provider.instanceId });
    } catch {
      setRetryError("重试检查失败，请稍后再试或重启本地服务。");
    } finally {
      setIsRetrying(false);
    }
  }, [isRetrying, provider]);

  useEffect(() => {
    if (!dismissKey) {
      setDismissedKey(null);
      return;
    }
    setDismissedKey(DISMISSED_PROVIDER_STATUS_BANNERS.has(dismissKey) ? dismissKey : null);
  }, [dismissKey]);

  useEffect(() => {
    const previousWsUiState = previousWsUiStateRef.current;
    const previousHasPendingBackendRequests = previousHasPendingBackendRequestsRef.current;
    previousWsUiStateRef.current = wsUiState;
    previousHasPendingBackendRequestsRef.current = hasPendingBackendRequests;

    if (!provider || provider.status === "ready" || provider.status === "disabled") {
      return;
    }
    if (wsUiState !== "connected" || hasPendingBackendRequests) {
      return;
    }
    const didRecoverConnection = previousWsUiState !== "connected";
    const didRecoverBackendIdle = previousHasPendingBackendRequests;

    if (!didRecoverConnection && !didRecoverBackendIdle) {
      return;
    }

    const recoveryKey = didRecoverConnection
      ? (wsStatus.connectedAt ?? "connected")
      : `backend-idle:${++backendIdleRecoverySequenceRef.current}`;
    const autoRefreshKey = `${provider.instanceId}:${recoveryKey}`;
    if (lastAutoRefreshKeyRef.current === autoRefreshKey) {
      return;
    }
    lastAutoRefreshKeyRef.current = autoRefreshKey;
    void refreshProviderStatus();
  }, [
    hasPendingBackendRequests,
    provider,
    refreshProviderStatus,
    wsStatus.connectedAt,
    wsUiState,
  ]);

  if (!provider || !shouldShowProviderStatusBanner(provider)) {
    return null;
  }

  if (wsUiState !== "connected" || (hasPendingBackendRequests && !isRetrying)) {
    return null;
  }

  if (dismissKey && dismissedKey === dismissKey) {
    return null;
  }

  const copy = getProviderStatusAlertCopy(provider);
  const detail = retryError ?? copy.detail;
  const dismissBanner = () => {
    if (!dismissKey) {
      return;
    }
    DISMISSED_PROVIDER_STATUS_BANNERS.add(dismissKey);
    setDismissedKey(dismissKey);
  };

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={provider.status === "error" ? "error" : "warning"}>
        <CircleAlertIcon />
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={detail}>
          {detail}
        </AlertDescription>
        <AlertAction>
          <Button
            size="xs"
            variant="outline"
            disabled={isRetrying}
            onClick={() => void refreshProviderStatus()}
          >
            {isRetrying ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            {isRetrying ? "检查中" : "重试"}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="关闭提示"
            title="关闭提示"
            onClick={dismissBanner}
          >
            <XIcon className="size-3.5" />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
});
