import { memo } from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;

  return (
    <div className="mx-auto max-w-3xl pt-3">
      <div
        className="flex min-h-10 items-center gap-3 rounded-2xl border border-border/75 bg-background px-4 py-2.5 text-[13px] leading-5 text-foreground shadow-[0_1px_0_rgba(0,0,0,0.02)]"
        title={error}
      >
        <CircleAlertIcon className="size-4 shrink-0 text-foreground/80" />
        <p className="min-w-0 flex-1 truncate">{error}</p>
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
