import { Spinner } from "./ui/spinner";

export function RoutePendingView({ label = "正在加载..." }: { label?: string }) {
  return (
    <div
      className="flex h-full min-h-[12rem] min-w-0 flex-1 items-center justify-center bg-background px-6 text-muted-foreground"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/90 px-3 py-2 text-xs shadow-sm">
        <Spinner className="size-3.5" />
        <span>{label}</span>
      </div>
    </div>
  );
}
