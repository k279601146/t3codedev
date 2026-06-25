import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  resolveSelectableModel,
  setProviderOptionDescriptorCurrentValue,
} from "@t3tools/shared/model";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { CheckIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { isModelPickerNewModel } from "./modelPickerModelHighlights";
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "../ui/combobox";
import { getDisplayModelName, ModelEsque, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { TooltipProvider } from "../ui/tooltip";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";
import { useI18n } from "../../i18n";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  continuationGroupKey?: string | undefined;
};

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();

// Split a `${instanceId}:${slug}` combobox key back into its pieces. Slugs
// can contain colons (e.g. some vendor model ids), so we only split on the
// first colon — anything after that is the slug.
function splitInstanceModelKey(key: string): { instanceId: ProviderInstanceId; slug: string } {
  const colonIndex = key.indexOf(":");
  if (colonIndex === -1) {
    return { instanceId: key as ProviderInstanceId, slug: "" };
  }
  return {
    instanceId: key.slice(0, colonIndex) as ProviderInstanceId,
    slug: key.slice(colonIndex + 1),
  };
}

const ModelPickerSimpleRow = memo(function ModelPickerSimpleRow(props: {
  index: number;
  model: ModelPickerItem;
  selected: boolean;
  showSubmenuIndicator?: boolean;
}) {
  return (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={`${props.model.instanceId}:${props.model.slug}`}
      contentClassName="flex w-full items-center justify-between gap-3"
      className="min-h-7 rounded-[6px] px-2.5 py-1 text-[13px] text-foreground hover:bg-accent/60 data-highlighted:bg-accent/70 data-selected:bg-transparent"
    >
      <span className="truncate">{getDisplayModelName(props.model, { preferShortName: true })}</span>
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {props.selected ? <CheckIcon className="size-3.5" /> : null}
        {props.showSubmenuIndicator ? <ChevronRightIcon className="size-3.5" /> : null}
      </span>
    </ComboboxItem>
  );
});

function getReasoningOptionLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  const localized: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高",
    "extra high": "超高",
  };
  return localized[normalized] ?? label;
}

function getReasoningGroupLabel(descriptor: ProviderOptionDescriptor): string {
  if (descriptor.id === "reasoningEffort") {
    return "推理";
  }
  return descriptor.label || "推理";
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  /** The instance currently selected in the composer (combobox "value"). */
  activeInstanceId: ProviderInstanceId;
  model: string;
  /**
   * When set, the picker is locked to the given driver kind — typically
   * because the user is editing a previously-sent message and can't change
   * which driver served the turn. Multiple instances of the same kind
   * remain selectable (e.g. locked to `codex` still lets the user switch
   * between the default Codex and a custom Codex Personal).
   */
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /**
   * All configured provider instances in display order. Used to render
   * the sidebar (one button per instance) and to resolve display names
   * for the locked-mode header.
   */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  /**
   * Model options per instance. Keyed by `ProviderInstanceId` so the
   * default Codex instance and any custom Codex instances each have their
   * own list (custom instances typically start with the same built-in
   * model set but are free to diverge via customModels).
   */
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  modelOptionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  emptyMessage?: string;
  simplified?: boolean;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  onModelOptionsChange?: (nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined) => void;
}) {
  const {
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    onInstanceModelChange,
  } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const [modelSubmenuOpen, setModelSubmenuOpen] = useState(false);
  const modelSubmenuCloseTimeoutRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const { t } = useI18n();
  const favorites = useSettings((s) => s.favorites ?? []);
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | "favorites">(
    () => {
      if (props.lockedProvider !== null) {
        // When locked, prime the sidebar to the currently-active instance
        // so jumping into the picker keeps the focused instance visible.
        return props.activeInstanceId;
      }
      return favorites.length > 0 ? "favorites" : props.activeInstanceId;
    },
  );
  const keybindings = useMemo<ResolvedKeybindingsConfig>(
    () => providedKeybindings ?? [],
    [providedKeybindings],
  );
  const { updateSettings } = useUpdateSettings();
  const reasoningDescriptor = useMemo(
    () =>
      props.modelOptionDescriptors.find(
        (
          descriptor,
        ): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
          descriptor.type === "select" && descriptor.id === "reasoningEffort",
      ) ?? null,
    [props.modelOptionDescriptors],
  );
  const reasoningValue = getProviderOptionCurrentValue(reasoningDescriptor);
  const showReasoningSubmenu =
    reasoningDescriptor !== null &&
    reasoningDescriptor.options.length > 0 &&
    typeof props.onModelOptionsChange === "function";
  const showReasoningFirstMenu = props.simplified && showReasoningSubmenu;
  const cancelModelSubmenuClose = useCallback(() => {
    if (modelSubmenuCloseTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(modelSubmenuCloseTimeoutRef.current);
    modelSubmenuCloseTimeoutRef.current = null;
  }, []);
  const openModelSubmenu = useCallback(() => {
    cancelModelSubmenuClose();
    setModelSubmenuOpen(true);
  }, [cancelModelSubmenuClose]);
  const scheduleModelSubmenuClose = useCallback(() => {
    cancelModelSubmenuClose();
    modelSubmenuCloseTimeoutRef.current = window.setTimeout(() => {
      modelSubmenuCloseTimeoutRef.current = null;
      setModelSubmenuOpen(false);
    }, 180);
  }, [cancelModelSubmenuClose]);

  useEffect(() => {
    return () => {
      cancelModelSubmenuClose();
    };
  }, [cancelModelSubmenuClose]);

  const handleReasoningChange = useCallback(
    (value: string) => {
      if (!reasoningDescriptor) return;
      const nextDescriptors = props.modelOptionDescriptors.map((descriptor) =>
        descriptor.id === reasoningDescriptor.id
          ? setProviderOptionDescriptorCurrentValue(descriptor, value)
          : descriptor,
      );
      props.onModelOptionsChange?.(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
    },
    [props, reasoningDescriptor],
  );

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectInstance = useCallback(
    (instanceId: ProviderInstanceId | "favorites") => {
      setSelectedInstanceId(instanceId);
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    },
    [focusSearchInput],
  );

  useLayoutEffect(() => {
    focusSearchInput();
    const frame = window.requestAnimationFrame(() => {
      focusSearchInput();
    });
    const timeout = window.setTimeout(() => {
      focusSearchInput();
    }, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusSearchInput]);

  // Create a Set for efficient lookup. Favorites are keyed by
  // `${instanceId}:${slug}`; the storage schema widened from ProviderDriverKind
  // to ProviderInstanceId so pre-migration favorites keyed by driver slugs
  // (e.g. `"codex:gpt-5"`) still resolve — the default instance id equals
  // the driver slug.
  const favoritesSet = useMemo(() => {
    return new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  }, [favorites]);

  /**
   * Lookup table keyed by `instanceId`. Used for display name + driver
   * kind enrichment and for `ready`/enabled filtering before flattening
   * models into the search list.
   */
  const entryByInstanceId = useMemo(
    () => new Map(instanceEntries.map((entry) => [entry.instanceId, entry])),
    [instanceEntries],
  );
  const matchesLockedProvider = useCallback(
    (entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">): boolean => {
      if (props.lockedProvider === null) return true;
      if (entry.driverKind !== props.lockedProvider) return false;
      if (!props.lockedContinuationGroupKey) return true;
      return entry.continuationGroupKey === props.lockedContinuationGroupKey;
    },
    [props.lockedContinuationGroupKey, props.lockedProvider],
  );

  const readyInstanceSet = useMemo(() => {
    const ready = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (entry.status === "ready") {
        ready.add(entry.instanceId);
      }
    }
    return ready;
  }, [instanceEntries]);

  // Flatten models into a searchable array. One pass over the
  // instance-keyed map; each model carries its instance id + driver kind
  // so the list row can render the right icon and display name without
  // another lookup.
  const flatModels = useMemo(() => {
    const out: ModelPickerItem[] = [];
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        // Instance disappeared between renders (configuration change). Skip
        // its models — stale options shouldn't appear in the picker.
        continue;
      }
      if (!readyInstanceSet.has(instanceId)) {
        continue;
      }
      for (const model of models) {
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
          ...(entry.continuationGroupKey
            ? { continuationGroupKey: entry.continuationGroupKey }
            : {}),
        });
      }
    }
    return out;
  }, [modelOptionsByInstance, entryByInstanceId, readyInstanceSet]);

  const isLocked = props.lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  const lockedInstanceEntries = useMemo(
    () =>
      props.lockedProvider ? instanceEntries.filter((entry) => matchesLockedProvider(entry)) : [],
    [instanceEntries, matchesLockedProvider, props.lockedProvider],
  );
  const showLockedInstanceSidebar =
    !props.simplified && isLocked && lockedInstanceEntries.length > 1;
  const showSidebar = !props.simplified && !isSearching && (!isLocked || showLockedInstanceSidebar);
  const sidebarInstanceEntries = showLockedInstanceSidebar
    ? lockedInstanceEntries
    : instanceEntries;
  const instanceOrder = useMemo(
    () => instanceEntries.map((entry) => entry.instanceId),
    [instanceEntries],
  );

  // Filter models based on search query and selected instance
  const filteredModels = useMemo(() => {
    let result = flatModels;

    // Apply tokenized fuzzy search across the combined provider/model search fields.
    if (searchQuery.trim()) {
      const rankedMatches = result
        .map((model) => ({
          model,
          score: scoreModelPickerSearch(
            {
              name: model.name,
              ...(model.shortName ? { shortName: model.shortName } : {}),
              ...(model.subProvider ? { subProvider: model.subProvider } : {}),
              driverKind: model.driverKind,
              providerDisplayName: model.instanceDisplayName,
              isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
            },
            searchQuery,
          ),
          isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
          tieBreaker: buildModelPickerSearchText({
            name: model.name,
            ...(model.shortName ? { shortName: model.shortName } : {}),
            ...(model.subProvider ? { subProvider: model.subProvider } : {}),
            driverKind: model.driverKind,
            providerDisplayName: model.instanceDisplayName,
          }),
        }))
        .filter(
          (
            rankedModel,
          ): rankedModel is {
            model: ModelPickerItem;
            score: number;
            isFavorite: boolean;
            tieBreaker: string;
          } => rankedModel.score !== null,
        );

      // When searching, we only respect locked provider (by driver kind),
      // ignoring sidebar selection so account-scoped searches can find a
      // model before the user chooses a specific instance rail item.
      if (props.lockedProvider !== null) {
        return rankedMatches
          .filter((rankedModel) => matchesLockedProvider(rankedModel.model))
          .toSorted((a, b) => {
            const scoreDelta = a.score - b.score;
            if (scoreDelta !== 0) {
              return scoreDelta;
            }
            if (a.isFavorite !== b.isFavorite) {
              return a.isFavorite ? -1 : 1;
            }
            return a.tieBreaker.localeCompare(b.tieBreaker);
          })
          .map((rankedModel) => rankedModel.model);
      }

      return rankedMatches
        .toSorted((a, b) => {
          const scoreDelta = a.score - b.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          if (a.isFavorite !== b.isFavorite) {
            return a.isFavorite ? -1 : 1;
          }
          return a.tieBreaker.localeCompare(b.tieBreaker);
        })
        .map((rankedModel) => rankedModel.model);
    }

    if (props.lockedProvider !== null) {
      result = result.filter((m) => matchesLockedProvider(m));
      if (showLockedInstanceSidebar) {
        result = result.filter((m) => m.instanceId === selectedInstanceId);
      }
    } else if (selectedInstanceId === "favorites") {
      result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
    } else {
      result = result.filter((m) => m.instanceId === selectedInstanceId);
    }

    return sortProviderModelItems(result, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: selectedInstanceId !== "favorites",
      instanceOrder: selectedInstanceId === "favorites" ? instanceOrder : [],
    });
  }, [
    favoritesSet,
    flatModels,
    instanceOrder,
    matchesLockedProvider,
    props.lockedProvider,
    searchQuery,
    showLockedInstanceSidebar,
    selectedInstanceId,
  ]);

  const handleModelSelect = useCallback(
    (modelSlug: string, instanceId: ProviderInstanceId) => {
      const options = modelOptionsByInstance.get(instanceId);
      if (!options) {
        return;
      }
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        return;
      }
      // `resolveSelectableModel` uses the driver kind for normalization
      // (slug casing etc.). Custom instances share their driver's
      // normalization rules, so pass the driver kind here.
      const resolvedModel = resolveSelectableModel(entry.driverKind, modelSlug, options);
      if (resolvedModel) {
        onInstanceModelChange(instanceId, resolvedModel);
      }
    },
    [entryByInstanceId, modelOptionsByInstance, onInstanceModelChange],
  );

  const toggleFavorite = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      const newFavorites = [...favorites];
      const index = newFavorites.findIndex((f) => f.provider === instanceId && f.model === model);
      if (index >= 0) {
        newFavorites.splice(index, 1);
      } else {
        newFavorites.push({ provider: instanceId, model });
      }
      updateSettings({ favorites: newFavorites });
    },
    [favorites, updateSettings],
  );

  const LockedProviderIcon =
    isLocked && props.lockedProvider ? PROVIDER_ICON_BY_PROVIDER[props.lockedProvider] : null;
  // Header label for locked mode. Use the active instance's displayName
  // when the lock narrows to exactly one instance (so "Codex Personal"
  // shows instead of the generic driver label); fall back to the first
  // matching entry otherwise.
  const lockedHeaderLabel = useMemo(() => {
    if (!isLocked || !props.lockedProvider) return null;
    const matches = instanceEntries.filter((entry) => matchesLockedProvider(entry));
    if (matches.length === 0) return null;
    const active = matches.find((entry) => entry.instanceId === props.activeInstanceId);
    return (active ?? matches[0])?.displayName ?? null;
  }, [
    isLocked,
    matchesLockedProvider,
    props.lockedProvider,
    props.activeInstanceId,
    instanceEntries,
  ]);
  const modelJumpCommandByKey = useMemo(() => {
    const mapping = new Map<
      string,
      NonNullable<ReturnType<typeof modelPickerJumpCommandForIndex>>
    >();
    for (const [visibleModelIndex, model] of filteredModels.entries()) {
      const jumpCommand = modelPickerJumpCommandForIndex(visibleModelIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(`${model.instanceId}:${model.slug}`, jumpCommand);
    }
    return mapping;
  }, [filteredModels]);
  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );
  const allModelKeys = useMemo(
    (): string[] => flatModels.map((model) => `${model.instanceId}:${model.slug}`),
    [flatModels],
  );
  const filteredModelKeys = useMemo(
    (): string[] => filteredModels.map((model) => `${model.instanceId}:${model.slug}`),
    [filteredModels],
  );
  const activeModelKey = `${props.activeInstanceId}:${props.model}`;
  const filteredModelByKey = useMemo(
    (): ReadonlyMap<string, ModelPickerItem> =>
      new Map(filteredModels.map((model) => [`${model.instanceId}:${model.slug}`, model] as const)),
    [filteredModels],
  );
  const reasoningFirstModels = useMemo(() => {
    const scopedModels =
      props.lockedProvider !== null
        ? flatModels.filter((model) => matchesLockedProvider(model))
        : flatModels.filter((model) => model.instanceId === props.activeInstanceId);

    return sortProviderModelItems(scopedModels, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: false,
      instanceOrder,
    });
  }, [
    favoritesSet,
    flatModels,
    instanceOrder,
    matchesLockedProvider,
    props.activeInstanceId,
    props.lockedProvider,
  ]);
  const modelJumpShortcutContext = useMemo(
    () =>
      ({
        terminalFocus: false,
        terminalOpen: props.terminalOpen,
        modelPickerOpen: true,
      }) as const,
    [props.terminalOpen],
  );
  const modelJumpLabelByKey = useMemo((): ReadonlyMap<string, string> => {
    if (modelJumpCommandByKey.size === 0) {
      return EMPTY_MODEL_JUMP_LABELS;
    }
    const shortcutLabelOptions = {
      platform: navigator.platform,
      context: modelJumpShortcutContext,
    };
    const mapping = new Map<string, string>();
    for (const [modelKey, command] of modelJumpCommandByKey) {
      const label = shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
      if (label) {
        mapping.set(modelKey, label);
      }
    }
    return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
  }, [keybindings, modelJumpCommandByKey, modelJumpShortcutContext]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: modelJumpShortcutContext,
      });
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetModelKey = modelJumpModelKeys[jumpIndex];
      if (!targetModelKey) {
        return;
      }
      const { instanceId, slug } = splitInstanceModelKey(targetModelKey);
      event.preventDefault();
      event.stopPropagation();
      handleModelSelect(slug, instanceId);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [handleModelSelect, keybindings, modelJumpModelKeys, modelJumpShortcutContext]);

  useLayoutEffect(() => {
    const listRegion = listRegionRef.current;
    if (!listRegion) {
      return;
    }

    let cancelled = false;
    let frame = 0;
    let nestedFrame = 0;
    let timeout = 0;

    const measureScrollArea = () => {
      if (cancelled) {
        return;
      }
      const viewport = listRegion.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
        return;
      }
      const originalScrollTop = viewport.scrollTop;
      const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
      if (maxScrollTop <= 0) {
        return;
      }
      viewport.scrollTop = Math.min(originalScrollTop + 1, maxScrollTop);
      viewport.scrollTop = originalScrollTop;
    };

    queueMicrotask(measureScrollArea);
    frame = window.requestAnimationFrame(() => {
      measureScrollArea();
      nestedFrame = window.requestAnimationFrame(measureScrollArea);
    });
    timeout = window.setTimeout(measureScrollArea, 0);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nestedFrame);
      window.clearTimeout(timeout);
    };
  }, [filteredModelKeys]);

  if (showReasoningFirstMenu && reasoningDescriptor) {
    const activeModel = reasoningFirstModels.find(
      (item) => item.instanceId === props.activeInstanceId && item.slug === props.model,
    );
    const activeModelLabel = activeModel
      ? getDisplayModelName(activeModel, { preferShortName: true })
      : props.model;

    return (
      <TooltipProvider delay={0}>
        <div
          className="relative w-[200px] max-w-[calc(100vw-1rem)] select-none"
          onMouseEnter={cancelModelSubmenuClose}
          onMouseLeave={scheduleModelSubmenuClose}
        >
          {modelSubmenuOpen ? (
            <div
              className="absolute right-[calc(100%+0.25rem)] bottom-0 z-20 w-[200px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[12px] border bg-popover p-1 text-popover-foreground shadow-lg/10 before:pointer-events-none before:absolute before:inset-0 before:rounded-[11px] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
              onMouseEnter={cancelModelSubmenuClose}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="px-2 pb-1 pt-1.5 text-[12px] leading-5 text-muted-foreground">
                模型
              </div>
              <div className="max-h-[260px] overflow-y-auto">
                {reasoningFirstModels.map((model) => {
                  const selected =
                    model.instanceId === props.activeInstanceId && model.slug === props.model;
                  return (
                    <button
                      key={`${model.instanceId}:${model.slug}`}
                      type="button"
                      className={cn(
                        "flex h-8 w-full items-center justify-between gap-3 rounded-[7px] px-2 text-left text-[13px] leading-5 text-foreground outline-none transition-colors hover:bg-accent/70",
                        selected && "bg-accent/60",
                      )}
                      onClick={() => handleModelSelect(model.slug, model.instanceId)}
                    >
                      <span className="min-w-0 truncate">
                        {getDisplayModelName(model, { preferShortName: true })}
                      </span>
                      {selected ? (
                        <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div
            className="overflow-hidden rounded-[12px] border bg-popover p-1 text-popover-foreground shadow-lg/10 before:pointer-events-none before:absolute before:inset-0 before:rounded-[11px] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-2 pb-1 pt-1.5 text-[12px] leading-5 text-muted-foreground">
              {getReasoningGroupLabel(reasoningDescriptor)}
            </div>
            <div className="space-y-0.5">
              {reasoningDescriptor.options.map((option) => {
                const selected = reasoningValue === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center justify-between rounded-[7px] px-2 text-left text-[13px] leading-5 text-foreground outline-none transition-colors hover:bg-accent/70",
                      selected && "bg-accent/60",
                    )}
                    onClick={() => handleReasoningChange(option.id)}
                  >
                    <span>{getReasoningOptionLabel(option.label)}</span>
                    {selected ? (
                      <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mx-1 my-1 h-px bg-border" />
            <button
              type="button"
              aria-expanded={modelSubmenuOpen}
              aria-haspopup="menu"
              data-model-picker-model-submenu-trigger="true"
              className={cn(
                "flex h-8 w-full items-center justify-between gap-3 rounded-[7px] px-2 text-left text-[13px] leading-5 text-foreground outline-none transition-colors hover:bg-accent/70",
                modelSubmenuOpen && "bg-accent/60",
              )}
              onClick={() => {
                cancelModelSubmenuClose();
                setModelSubmenuOpen((open) => !open);
              }}
              onFocus={openModelSubmenu}
              onMouseEnter={openModelSubmenu}
            >
              <span className="min-w-0 truncate">{activeModelLabel}</span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
            </button>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delay={0}>
      <div
        className={cn(
          "relative flex h-screen max-h-96 w-screen max-w-100 rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
          showReasoningSubmenu ? "overflow-visible" : "overflow-hidden",
          isLocked && !showLockedInstanceSidebar ? "flex-col" : "flex-row",
          props.simplified &&
            "h-auto max-h-[320px] w-[200px] max-w-[calc(100vw-1rem)] rounded-[10px] shadow-lg/10",
        )}
      >
        {/* Locked provider header (only shown in locked mode) */}
        {isLocked && !showLockedInstanceSidebar && LockedProviderIcon && lockedHeaderLabel && (
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <LockedProviderIcon className="size-5 shrink-0" />
            <span className="font-medium text-sm">{lockedHeaderLabel}</span>
          </div>
        )}

        {/* Sidebar (only in unlocked mode) */}
        {showSidebar && (
          <ModelPickerSidebar
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={handleSelectInstance}
            instanceEntries={sidebarInstanceEntries}
            showFavorites={!isLocked}
            showComingSoon={false}
          />
        )}

        {/* Main content area */}
        <Combobox
          inline
          items={allModelKeys}
          filteredItems={filteredModelKeys}
          filter={null}
          autoHighlight
          open
          value={`${props.activeInstanceId}:${props.model}`}
          onItemHighlighted={(modelKey) => {
            highlightedModelKeyRef.current = typeof modelKey === "string" ? modelKey : null;
          }}
          onValueChange={(modelKey) => {
            if (typeof modelKey !== "string") {
              return;
            }
            const { instanceId, slug } = splitInstanceModelKey(modelKey);
            handleModelSelect(slug, instanceId);
          }}
        >
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              isLocked && !showLockedInstanceSidebar ? "min-w-0" : showSidebar && "border-l",
            )}
          >
            {props.simplified ? null : (
              <div className="border-b px-3 py-2">
                <ComboboxInput
                  ref={searchInputRef}
                  className="[&_input]:font-sans rounded-md"
                  inputClassName="border-0 shadow-none ring-0 focus-visible:ring-0"
                  placeholder="Search models..."
                  showTrigger={false}
                  startAddon={<SearchIcon className="size-4 shrink-0 text-muted-foreground/50" />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onRequestClose?.();
                      return;
                    }
                    if (e.key === "Enter" && highlightedModelKeyRef.current) {
                      (
                        e as typeof e & { preventBaseUIHandler?: () => void }
                      ).preventBaseUIHandler?.();
                      e.preventDefault();
                      e.stopPropagation();
                      const { instanceId, slug } = splitInstanceModelKey(
                        highlightedModelKeyRef.current,
                      );
                      handleModelSelect(slug, instanceId);
                      return;
                    }
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  size="sm"
                />
              </div>
            )}

            {/* Model list */}
            <div
              ref={listRegionRef}
              className={cn(
                "relative min-h-0 flex-1",
                props.simplified
                  ? "bg-popover"
                  : "before:pointer-events-none before:absolute before:inset-0 before:bg-muted/40",
              )}
            >
              {props.simplified ? (
                <div className="px-3 pb-1.5 pt-2 text-[12px] leading-5 text-muted-foreground">
                  {t("composer.model.label")}
                </div>
              ) : null}
              <ComboboxList
                className={cn(
                  "model-picker-list size-full",
                  props.simplified ? "px-1.5 pb-2" : "divide-y px-2 py-1",
                )}
              >
                {filteredModelKeys.map((modelKey, index) => {
                  const model = filteredModelByKey.get(modelKey);
                  if (!model) {
                    return null;
                  }
                  if (props.simplified) {
                    return (
                      <ModelPickerSimpleRow
                        key={modelKey}
                        index={index}
                        model={model}
                        selected={modelKey === activeModelKey}
                        showSubmenuIndicator={modelKey === activeModelKey && showReasoningSubmenu}
                      />
                    );
                  }
                  return (
                    <ModelListRow
                      key={modelKey}
                      index={index}
                      model={model}
                      instanceId={model.instanceId}
                      driverKind={model.driverKind}
                      providerDisplayName={model.instanceDisplayName}
                      providerAccentColor={model.instanceAccentColor}
                      isFavorite={favoritesSet.has(modelKey)}
                      showProvider={!isLocked || showLockedInstanceSidebar}
                      preferShortName={!isLocked}
                      useTriggerLabel={isLocked && !showLockedInstanceSidebar}
                      showNewBadge={isModelPickerNewModel(model.driverKind, model.slug)}
                      showSubmenuIndicator={modelKey === activeModelKey && showReasoningSubmenu}
                      jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                      onToggleFavorite={() => toggleFavorite(model.instanceId, model.slug)}
                    />
                  );
                })}
              </ComboboxList>
            </div>
            <ComboboxEmpty className="not-empty:py-6 empty:h-0 text-xs font-normal leading-snug">
              {props.emptyMessage ?? t("composer.model.empty")}
            </ComboboxEmpty>
          </div>
        </Combobox>
        {showReasoningSubmenu && reasoningDescriptor ? (
          <div
            className="absolute left-[calc(100%+0.25rem)] bottom-12 z-10 w-52 rounded-[14px] border bg-popover p-1 text-popover-foreground shadow-lg/10 before:pointer-events-none before:absolute before:inset-0 before:rounded-[13px] before:shadow-[0_1px_--theme(--color-black/4%)]"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-2 pb-1 pt-1.5 text-[13px] leading-5 text-muted-foreground">
              {reasoningDescriptor.label || "推理"}
            </div>
            <div className="space-y-0.5">
              {reasoningDescriptor.options.map((option) => {
                const selected = reasoningValue === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center justify-between rounded-[6px] px-2 text-left text-[13px] text-foreground outline-none transition-colors hover:bg-accent/70",
                      selected && "bg-accent/60",
                    )}
                    onClick={() => handleReasoningChange(option.id)}
                  >
                    <span>{getReasoningOptionLabel(option.label)}</span>
                    {selected ? <CheckIcon className="size-3.5 text-muted-foreground" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
});
