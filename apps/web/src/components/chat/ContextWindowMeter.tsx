import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { useI18n } from "../../i18n";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

function createTokenRows(
  rows: ReadonlyArray<{ label: string; value: number | null }>,
): Array<{ label: string; value: number }> {
  return rows.flatMap((row) => (row.value !== null ? [{ label: row.label, value: row.value }] : []));
}

export function ContextWindowMeter(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const { t } = useI18n();
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const cacheHitPercentage =
    usage.inputTokens !== null && usage.inputTokens > 0 && usage.cachedInputTokens !== null
      ? formatPercentage((usage.cachedInputTokens / usage.inputTokens) * 100)
      : null;
  const totalCacheHitPercentage =
    usage.totalInputTokens !== null &&
    usage.totalInputTokens > 0 &&
    usage.totalCachedInputTokens !== null
      ? formatPercentage((usage.totalCachedInputTokens / usage.totalInputTokens) * 100)
      : null;
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;
  const latestTokenRows = createTokenRows([
    {
      label: t("contextWindow.input"),
      value: usage.inputTokens,
    },
    {
      label: t("contextWindow.cachedInput"),
      value: usage.cachedInputTokens,
    },
    {
      label: t("contextWindow.output"),
      value: usage.outputTokens,
    },
    {
      label: t("contextWindow.reasoningOutput"),
      value: usage.reasoningOutputTokens,
    },
  ]);
  const totalTokenRows = createTokenRows([
    {
      label: t("contextWindow.input"),
      value: usage.totalInputTokens,
    },
    {
      label: t("contextWindow.cachedInput"),
      value: usage.totalCachedInputTokens,
    },
    {
      label: t("contextWindow.output"),
      value: usage.totalOutputTokens,
    },
    {
      label: t("contextWindow.reasoningOutput"),
      value: usage.totalReasoningOutputTokens,
    },
  ]);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-85"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? t("contextWindow.ariaPercent", { percent: usedPercentage })
                : t("contextWindow.ariaTokens", {
                    tokens: formatContextWindowTokens(usage.usedTokens),
                  })
            }
          >
            <span className="relative flex h-6 w-6 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted) 70%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
              <span
                className={cn(
                  "relative flex h-[15px] w-[15px] items-center justify-center rounded-full bg-background text-[8px] font-medium",
                  "text-muted-foreground",
                )}
              >
                {usage.usedPercentage !== null
                  ? Math.round(usage.usedPercentage)
                  : formatContextWindowTokens(usage.usedTokens)}
              </span>
            </span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {t("contextWindow.title")}
          </div>
          {usage.maxTokens !== null && usedPercentage ? (
            <div className="whitespace-nowrap text-xs font-medium text-foreground">
              <span>{usedPercentage}</span>
              <span className="mx-1">⋅</span>
              <span>{formatContextWindowTokens(usage.usedTokens)}</span>
              <span>/</span>
              <span>
                {t("contextWindow.contextUsed", {
                  tokens: formatContextWindowTokens(usage.maxTokens ?? null),
                })}
              </span>
            </div>
          ) : (
            <div className="text-sm text-foreground">
              {t("contextWindow.tokensUsedSoFar", {
                tokens: formatContextWindowTokens(usage.usedTokens),
              })}
            </div>
          )}
          {(usage.totalProcessedTokens ?? null) !== null &&
          (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
            <div className="text-xs text-muted-foreground">
              {t("contextWindow.totalProcessed", {
                tokens: formatContextWindowTokens(usage.totalProcessedTokens ?? null),
              })}
            </div>
          ) : null}
          {latestTokenRows.length > 0 ? (
            <div className="mt-2 space-y-1 border-t border-border/70 pt-2 text-xs">
              <div className="font-medium text-muted-foreground">
                {t("contextWindow.latestRequest")}
              </div>
              <div className="grid grid-cols-[max-content_max-content] gap-x-3 gap-y-1">
                {latestTokenRows.map((row) => (
                  <div key={row.label} className="contents">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="text-right font-medium text-foreground">
                      {formatContextWindowTokens(row.value)}
                    </span>
                  </div>
                ))}
                {cacheHitPercentage ? (
                  <>
                    <span className="text-muted-foreground">
                      {t("contextWindow.cacheHitRate")}
                    </span>
                    <span className="text-right font-medium text-foreground">
                      {cacheHitPercentage}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {totalTokenRows.length > 0 ? (
            <div className="mt-2 space-y-1 border-t border-border/70 pt-2 text-xs">
              <div className="font-medium text-muted-foreground">
                {t("contextWindow.totalBreakdown")}
              </div>
              <div className="grid grid-cols-[max-content_max-content] gap-x-3 gap-y-1">
                {totalTokenRows.map((row) => (
                  <div key={row.label} className="contents">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="text-right font-medium text-foreground">
                      {formatContextWindowTokens(row.value)}
                    </span>
                  </div>
                ))}
                {totalCacheHitPercentage ? (
                  <>
                    <span className="text-muted-foreground">
                      {t("contextWindow.cacheHitRate")}
                    </span>
                    <span className="text-right font-medium text-foreground">
                      {totalCacheHitPercentage}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="text-xs text-muted-foreground">
              {t("contextWindow.compactsAutomatically")}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
