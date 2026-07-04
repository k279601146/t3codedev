import { memo } from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";

import { resolveFriendlyErrorMessage } from "../../friendlyErrors";
import { cn } from "../../lib/utils";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;

  const friendly = resolveFriendlyErrorMessage(error);
  const title = friendly.title.trim();
  const description = friendly.description.trim();
  const displayText = title.length > 0 ? `${title}：${description}` : description;

  return (
    <div className="mx-auto max-w-3xl pt-3">
      <div
        className={cn(
          "flex min-h-10 items-center gap-3 rounded-2xl border px-4 py-2.5 text-[13px] leading-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]",
          friendly.variant === "warning"
            ? "border-amber-300/60 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100"
            : "border-border/75 bg-background text-foreground",
        )}
        title={displayText}
      >
        <CircleAlertIcon className="size-4 shrink-0 text-foreground/80" />
        <p className="min-w-0 flex-1 truncate">{displayText}</p>
        {onDismiss ? (
          <button
            type="button"
            aria-label="关闭错误提示"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={onDismiss}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
});
