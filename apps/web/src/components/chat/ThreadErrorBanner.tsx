import { memo } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { resolveFriendlyErrorMessage } from "../../friendlyErrors";
import { Button } from "../ui/button";

const openBilling = () => {
  void window.desktopBridge?.openExternal?.("https://chatgpt.com/#pricing");
};

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  const friendly = resolveFriendlyErrorMessage(error);

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={friendly.variant ?? "error"} className="rounded-2xl px-4 py-3.5">
        <CircleAlertIcon />
        <AlertTitle>{friendly.title}</AlertTitle>
        <AlertDescription title={error}>
          <p className="line-clamp-3">{friendly.description}</p>
        </AlertDescription>
        {(friendly.primaryActionLabel || friendly.secondaryActionLabel || onDismiss) && (
          <AlertAction className="items-center">
            {friendly.primaryActionLabel ? (
              <Button type="button" size="xs" onClick={openBilling}>
                {friendly.primaryActionLabel}
              </Button>
            ) : null}
            {friendly.secondaryActionLabel ? (
              <Button type="button" size="xs" variant="outline" onClick={openBilling}>
                {friendly.secondaryActionLabel}
              </Button>
            ) : null}
            {onDismiss ? (
              <button
                type="button"
                aria-label="Dismiss error"
                className="inline-flex size-6 items-center justify-center rounded-md text-destructive/60 transition-colors hover:text-destructive"
                onClick={onDismiss}
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
