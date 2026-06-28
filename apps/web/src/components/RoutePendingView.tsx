import { Spinner } from "./ui/spinner";
import { Skeleton } from "./ui/skeleton";

export function RoutePendingView({ label = "正在加载..." }: { label?: string }) {
  return (
    <div
      className="relative flex h-full min-h-[18rem] min-w-0 flex-1 items-center justify-center overflow-hidden bg-background px-6 text-muted-foreground"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-full max-w-4xl -translate-y-1/2 px-8 opacity-65">
        <div className="grid gap-5" aria-hidden="true">
          <div className="space-y-3">
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_0.72fr]">
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-11/12 rounded-full" />
            <Skeleton className="h-3 w-4/5 rounded-full" />
          </div>
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
        <Spinner className="size-4.5 text-foreground/70" />
        <span>{label}</span>
      </div>
    </div>
  );
}
