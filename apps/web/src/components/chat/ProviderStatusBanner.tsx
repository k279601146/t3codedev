import { type ServerProvider } from "@t3tools/contracts";
import { memo, useCallback, useState } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";
import { getProviderStatusAlertCopy } from "../../providerStatusCopy";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const retryProviderStatus = useCallback(async () => {
    if (!status || isRetrying) {
      return;
    }

    setIsRetrying(true);
    setRetryError(null);
    try {
      await ensureLocalApi().server.refreshProviders({ instanceId: status.instanceId });
    } catch {
      setRetryError("重试检查失败，请稍后再试或重启本地服务。");
    } finally {
      setIsRetrying(false);
    }
  }, [isRetrying, status]);

  if (!status || status.status === "ready" || status.status === "disabled") {
    return null;
  }

  const copy = getProviderStatusAlertCopy(status);
  const detail = retryError ?? copy.detail;

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={status.status === "error" ? "error" : "warning"}>
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
            onClick={() => void retryProviderStatus()}
          >
            {isRetrying ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            {isRetrying ? "检查中" : "重试"}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
});
