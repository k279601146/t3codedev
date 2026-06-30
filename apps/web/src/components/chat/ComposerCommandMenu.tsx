import {
  type ProjectEntry,
  type ProviderDriverKind,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef } from "react";

import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import {
  formatComposerPluginMentionHealthStatus,
  type ComposerPluginMention,
} from "../../composerPluginMentions";
import { formatProviderSkillInstallSource } from "~/providerSkillPresentation";
import { cn } from "~/lib/utils";
import { VscodeEntryIcon } from "./VscodeEntryIcon";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "plugin";
      plugin: ComposerPluginMention;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "provider-slash-command";
      provider: ProviderDriverKind;
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      provider: ProviderDriverKind;
      skill: ServerProviderSkill;
      label: string;
      description: string;
    };

type ComposerCommandGroup = {
  id: string;
  label: string | null;
  items: ComposerCommandItem[];
};

function SkillGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function groupCommandItems(
  items: ComposerCommandItem[],
  triggerKind: ComposerTriggerKind | null,
  groupSlashCommandSections: boolean,
): ComposerCommandGroup[] {
  if (triggerKind === "skill") {
    return items.length > 0 ? [{ id: "skills", label: "Skills", items }] : [];
  }
  if (triggerKind === "path") {
    const pluginItems = items.filter((item) => item.type === "plugin");
    const pathItems = items.filter((item) => item.type === "path");
    const groups: ComposerCommandGroup[] = [];
    if (pluginItems.length > 0) {
      groups.push({ id: "plugins", label: "插件", items: pluginItems });
    }
    if (pathItems.length > 0) {
      groups.push({ id: "files", label: pluginItems.length > 0 ? "文件" : null, items: pathItems });
    }
    return groups;
  }
  if (triggerKind !== "slash-command" || !groupSlashCommandSections) {
    return [{ id: "default", label: null, items }];
  }

  const builtInItems = items.filter((item) => item.type === "slash-command");
  const providerItems = items.filter((item) => item.type === "provider-slash-command");

  const groups: ComposerCommandGroup[] = [];
  if (builtInItems.length > 0) {
    groups.push({ id: "built-in", label: "Built-in", items: builtInItems });
  }
  if (providerItems.length > 0) {
    groups.push({ id: "provider", label: "Provider", items: providerItems });
  }
  return groups;
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  groupSlashCommandSections?: boolean;
  emptyStateText?: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () =>
      groupCommandItems(props.items, props.triggerKind, props.groupSlashCommandSections ?? true),
    [props.groupSlashCommandSections, props.items, props.triggerKind],
  );
  const hasPathItems = props.items.some((item) => item.type === "path");
  const hasPluginItems = props.items.some((item) => item.type === "plugin");
  const shouldShowPathHint =
    props.triggerKind === "path" && hasPluginItems && !hasPathItems && !props.isLoading;

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  return (
    <div
      ref={listRef}
      className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs"
    >
      <div className="max-h-72 overflow-y-auto p-2" role="listbox">
        {groups.map((group, groupIndex) => (
          <div key={group.id} role="group">
            {groupIndex > 0 ? <div className="my-0.5 h-px bg-border" /> : null}
            {group.label ? (
              <div className="px-1 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/55">
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => (
              <ComposerCommandMenuItem
                key={item.id}
                item={item}
                resolvedTheme={props.resolvedTheme}
                isActive={props.activeItemId === item.id}
                onHighlight={props.onHighlightedItemChange}
                onSelect={props.onSelect}
              />
            ))}
          </div>
        ))}
        {shouldShowPathHint ? (
          <div role="group">
            <div className="my-0.5 h-px bg-border" />
            <div className="px-1 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/55">
              文件
            </div>
            <p className="px-1 py-1 text-muted-foreground/70 text-xs">输入内容搜索文件</p>
          </div>
        ) : null}
        {props.items.length === 0 ? (
          <div className="px-1 py-1.5">
            {props.triggerKind === "skill" ? (
              <>
                <div className="px-0 pb-1 pt-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/55">
                  Skills
                </div>
                <p className="text-muted-foreground/70 text-xs">
                  {props.isLoading
                    ? "Searching workspace skills..."
                    : (props.emptyStateText ??
                      "No skills found. Try / to browse provider commands.")}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground/70 text-xs">
                {props.isLoading
                  ? "Searching workspace files..."
                  : (props.emptyStateText ??
                    (props.triggerKind === "path"
                      ? "No matching files or folders."
                      : "No matching command."))}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const skillSourceLabel =
    props.item.type === "skill" ? formatProviderSkillInstallSource(props.item.skill) : null;
  const pluginHealth = props.item.type === "plugin" ? props.item.plugin.health : null;

  return (
    <button
      type="button"
      data-composer-item-id={props.item.id}
      className={cn(
        "flex min-h-8 w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base outline-none hover:bg-accent sm:min-h-7 sm:text-sm",
        props.isActive && "bg-accent text-accent-foreground",
      )}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
      role="option"
      aria-selected={props.isActive}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "plugin" ? (
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/80"
          dangerouslySetInnerHTML={{ __html: props.item.plugin.iconSvg }}
        />
      ) : null}
      {props.item.type === "slash-command" ? (
        <BotIcon className="size-4 shrink-0 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "provider-slash-command" ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/80">
          <SkillGlyph className="size-3.5" />
        </span>
      ) : null}
      {props.item.type === "skill" ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/80">
          <SkillGlyph className="size-3.5" />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0">{props.item.label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70 text-xs">
          {props.item.description}
        </span>
      </span>
      {pluginHealth ? (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            pluginHealth.status === "ready"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : pluginHealth.status === "warning"
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "bg-destructive/10 text-destructive",
          )}
        >
          {formatComposerPluginMentionHealthStatus(pluginHealth.status)}
        </span>
      ) : null}
      {skillSourceLabel ? (
        <span className="shrink-0 pl-2 text-muted-foreground/70 text-xs">{skillSourceLabel}</span>
      ) : null}
    </button>
  );
});
