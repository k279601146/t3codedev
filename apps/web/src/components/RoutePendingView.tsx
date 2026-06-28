import { Spinner } from "./ui/spinner";
import { Skeleton } from "./ui/skeleton";

export function RoutePendingView({ label = "正在加载..." }: { label?: string }) {
  return (
    <div
      className="flex h-full min-h-[12rem] min-w-0 flex-1 items-center justify-center bg-background px-6 text-muted-foreground"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="relative w-full max-w-[17rem] overflow-hidden rounded-xl border border-border/70 bg-card/90 p-4 shadow-[var(--claude-shadow-panel)] backdrop-blur-sm">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
        <div className="flex items-center gap-3">
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background shadow-sm">
            <span className="absolute size-5 rounded-full bg-primary/10" />
            <Spinner className="relative size-4 text-foreground/70" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{label}</div>
            <div className="mt-1 text-[11px] leading-none text-muted-foreground/75">
              正在准备页面内容
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2" aria-hidden="true">
          <Skeleton className="h-1.5 w-4/5 rounded-full" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-1.5 w-3/5 rounded-full" />
        </div>

        <div
          className="shimmer-scan mt-4 h-1 overflow-hidden rounded-full bg-muted [--shimmer-duration:1400ms]"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
