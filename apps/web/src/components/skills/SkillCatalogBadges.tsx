import type { SkillCatalogItem } from "@t3tools/contracts";
import { DownloadIcon, KeyRoundIcon, StarIcon } from "lucide-react";

export function formatCatalogCount(value?: number): string {
  if (value === undefined || value === null) return "0";
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

export function formatCatalogUpdatedLabel(value?: string): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const diffMs = Math.max(0, Date.now() - timestamp);
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return "今天更新";
  if (days < 7) return `${days}天前更新`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前更新`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月前更新`;
  return `${Math.floor(days / 365)}年前更新`;
}

export function ApiKeyBadge() {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 text-[11px] font-medium text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
      <KeyRoundIcon className="size-3" />
      需配置 API Key
    </span>
  );
}

export function CatalogMetaRow({ item }: { item: SkillCatalogItem }) {
  const updatedLabel = formatCatalogUpdatedLabel(item.updatedAt);
  const favorites = item.favorites ?? item.stars;
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      {item.categoryName ? <span className="truncate">{item.categoryName}</span> : null}
      <span className="inline-flex items-center gap-1">
        <DownloadIcon className="size-3" />
        {formatCatalogCount(item.downloads)}
      </span>
      <span className="inline-flex items-center gap-1">
        <StarIcon className="size-3" />
        {formatCatalogCount(favorites)}
      </span>
      {updatedLabel ? <span>{updatedLabel}</span> : null}
      {item.requiresApiKey ? <ApiKeyBadge /> : null}
    </div>
  );
}
