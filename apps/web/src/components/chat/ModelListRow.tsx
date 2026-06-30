import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";
import { ChevronRightIcon, StarIcon } from "lucide-react";
import {
  getDisplayModelName,
  getTriggerDisplayModelLabel,
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
} from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import type { ModelCapabilityTag } from "../../modelCapabilityTags";

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  model: ModelEsque;
  /** Instance the model belongs to — the routing key used in combobox values. */
  instanceId: ProviderInstanceId;
  /** Driver kind of the instance — used for the provider icon glyph. */
  driverKind: ProviderDriverKind;
  /**
   * Display name to show in the secondary line (provider footer). Usually
   * the instance's configured `displayName` so custom instances like
   * "Codex Personal" render with their user-authored label.
   */
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  isFavorite: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  capabilityTags?: ReadonlyArray<ModelCapabilityTag>;
  showSubmenuIndicator?: boolean;
  showFavorite?: boolean;
  jumpLabel?: string | null;
  onToggleFavorite: () => void;
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.driverKind] ?? null;
  const providerLabel = props.model.subProvider
    ? `${props.providerDisplayName} · ${props.model.subProvider}`
    : props.providerDisplayName;
  const capabilityTags = props.capabilityTags ?? [];

  return (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={`${props.instanceId}:${props.model.slug}`}
      contentClassName="flex w-full items-start gap-2"
      className={cn(
        "w-full cursor-pointer rounded px-3 py-2 transition-colors group",
        "data-highlighted:bg-muted data-selected:bg-accent data-selected:text-foreground",
      )}
    >
      {props.showFavorite === false ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="mt-0.5 shrink-0 cursor-pointer opacity-40 transition-opacity group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
                aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <StarIcon
                  className={cn("size-4", props.isFavorite && "fill-current text-yellow-500")}
                />
              </button>
            }
          />
          <TooltipPopup side="top" align="center">
            {props.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </TooltipPopup>
        </Tooltip>
      )}

      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="text-xs font-medium leading-snug flex items-center gap-2 min-w-0">
            <span className="truncate">
              {props.useTriggerLabel
                ? getTriggerDisplayModelLabel(props.model)
                : getDisplayModelName(
                    props.model,
                    props.preferShortName ? { preferShortName: true } : undefined,
                  )}
            </span>
            {props.showNewBadge ? (
              <span
                className="shrink-0 rounded border border-amber-500/35 bg-amber-500/15 px-0.5 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-200"
                aria-label="New model"
              >
                New
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {props.jumpLabel ? (
              <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-[10px]">{props.jumpLabel}</Kbd>
            ) : null}
            {props.showSubmenuIndicator ? (
              <ChevronRightIcon className="size-3.5 text-muted-foreground/70" />
            ) : null}
          </div>
        </div>
        {(props.showProvider || capabilityTags.length > 0) && (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            {capabilityTags.map((tag) => (
              <span
                key={tag.kind}
                className={cn(
                  "shrink-0 rounded-[5px] border px-1 py-px text-[10px] leading-none",
                  tag.kind === "default"
                    ? "border-info/30 bg-info/10 text-info"
                    : tag.kind === "economy"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-muted/60 text-muted-foreground",
                )}
              >
                {tag.label}
              </span>
            ))}
            {props.showProvider ? (
              <>
                {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
                {props.providerAccentColor ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: props.providerAccentColor }}
                    aria-hidden
                  />
                ) : null}
                <span className="truncate text-xs font-normal leading-snug text-muted-foreground/70">
                  {providerLabel}
                </span>
              </>
            ) : null}
          </div>
        )}
      </div>
    </ComboboxItem>
  );
});
