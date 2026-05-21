import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

interface ImageGenerationShimmerProps {
  /** Aspect ratio of the placeholder, e.g. "1024 / 1024". Defaults to square. */
  readonly aspectRatio?: string;
  /** Optional fixed width — falls back to filling the parent container. */
  readonly width?: number | string;
  /** Optional fixed height — used together with width for non-aspect placeholders. */
  readonly height?: number | string;
  /** Maximum width of the card; defaults to a chat-friendly 512px. */
  readonly maxWidth?: number | string;
  readonly className?: string;
  /** Caption shown over the bottom-left of the placeholder. */
  readonly label?: string;
  /** Disable the shimmer animation (e.g. during reduced-motion previews). */
  readonly paused?: boolean;
  readonly durationMs?: number;
}

/**
 * Skeleton placeholder shown while an image is being generated.
 *
 * Visual recipe:
 *   - Soft neutral block with the same aspect ratio as the target image
 *   - A diagonal-light highlight sweeps from left → right on a loop
 *   - Optional caption ("正在生成图片…") sits above the shimmer band
 *
 * Designed to match the "AI is rendering" pattern used by ChatGPT, DALL-E,
 * Midjourney and v0.dev — a calm grey card that telegraphs progress without
 * shifting layout when the final image swaps in.
 */
export function ImageGenerationShimmer({
  aspectRatio = "1024 / 1024",
  width,
  height,
  maxWidth = 512,
  className,
  label = "正在生成图片…",
  paused = false,
  durationMs = 2000,
}: ImageGenerationShimmerProps) {
  const style: CSSProperties & Record<string, string> = {
    "--image-shimmer-duration": `${durationMs}ms`,
  };
  if (width !== undefined) style.width = typeof width === "number" ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === "number" ? `${height}px` : height;
  if (maxWidth !== undefined) {
    style.maxWidth = typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;
  }
  if (height === undefined) {
    style.aspectRatio = aspectRatio;
  }

  return (
    <div
      className={cn(
        "image-generation-shimmer",
        "relative w-full overflow-hidden rounded-xl border border-border/55 bg-muted/55",
        paused && "image-generation-shimmer-paused",
        className,
      )}
      style={style}
      role="img"
      aria-label={label}
      aria-busy="true"
      data-image-shimmer="true"
    >
      <span className="image-generation-shimmer-band" aria-hidden="true" />
      {label ? (
        <span className="pointer-events-none absolute bottom-2.5 left-3 select-none text-[11px] font-medium tracking-[0.04em] text-muted-foreground/75">
          {label}
        </span>
      ) : null}
    </div>
  );
}
