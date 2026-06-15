import { type ServerProvider } from "@t3tools/contracts";
import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon } from "lucide-react";
import { getProviderStatusAlertCopy } from "../../providerStatusCopy";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  if (!status || status.status === "ready" || status.status === "disabled") {
    return null;
  }

  const copy = getProviderStatusAlertCopy(status);

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={status.status === "error" ? "error" : "warning"}>
        <CircleAlertIcon />
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={copy.detail}>
          {copy.detail}
        </AlertDescription>
      </Alert>
    </div>
  );
});
