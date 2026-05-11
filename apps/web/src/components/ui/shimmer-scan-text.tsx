import type { CSSProperties, ReactNode } from "react";

import { cn } from "~/lib/utils";

interface ShimmerScanTextProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly durationMs?: number;
  readonly intensity?: number;
  readonly singleLine?: boolean;
  readonly style?: CSSProperties;
  readonly tone?: "light" | "dark";
}

export function ShimmerScanText({
  children,
  className,
  durationMs = 2000,
  intensity,
  singleLine = true,
  style,
  tone,
}: ShimmerScanTextProps) {
  const nextStyle = {
    ...style,
    "--shimmer-duration": `${durationMs}ms`,
    ...(typeof intensity === "number"
      ? { "--shimmer-band-opacity": String(Math.max(0, Math.min(1, intensity))) }
      : {}),
  } as CSSProperties & Record<string, string>;

  return (
    <span
      className={cn(
        "shimmer-scan inline-flex min-w-0 items-center",
        singleLine && "max-w-full whitespace-nowrap",
        tone === "light" && "shimmer-scan-light",
        tone === "dark" && "shimmer-scan-dark",
        className,
      )}
      style={nextStyle}
    >
      <span className={cn("relative z-10 min-w-0", singleLine && "truncate")}>{children}</span>
    </span>
  );
}
