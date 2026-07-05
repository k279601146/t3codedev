import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  OrchestrationGoal,
  OrchestrationGoalStatus,
  ProjectEntry,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderOptionSelection,
  ProviderPersonality,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ScopedThreadRef,
  ServerProviderSkill,
  ServerProvider,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import {
  computeGoalElapsedMs,
  formatGoalDuration,
  isValidGoalObjective,
  normalizeGoalObjective,
} from "@t3tools/shared/goal";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from "../../composer-logic";
import { deriveComposerSendState, readFileAsDataUrl } from "../ChatView.logic";
import {
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composerDraftStore";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
} from "../../lib/terminalContext";
import {
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "../composerFooterLayout";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "../ComposerPromptEditor";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { type ComposerCommandItem, ComposerCommandMenu } from "./ComposerCommandMenu";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { getRunningPrimaryActionMode } from "./ComposerPrimaryActionState";
import {
  ComposerSendArrowIcon,
  ComposerSpinnerIcon,
  ComposerStopSquareIcon,
  composerPrimaryButtonClassName,
} from "./ComposerPrimaryButton";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { deriveComposerFooterVisibility, type ComposerSurface } from "./composerFooterVisibility";
import { resolveComposerMenuActiveItemId } from "./composerMenuHighlight";
import { searchSlashCommandItems } from "./composerSlashCommandSearch";
import { getComposerProviderState } from "./composerProviderState";
import { deriveComposerProviderAvailability } from "./composerProviderAvailability";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { basenameOfPath } from "../../vscode-icons";
import { cn, randomUUID } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { readLocalApi } from "../../localApi";
import { revealFileInFolder } from "../../lib/openContainingFolder";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  BookOpenIcon,
  CheckIcon,
  FileTextIcon,
  FileIcon,
  GoalIcon,
  GlobeIcon,
  HandIcon,
  LaptopIcon,
  ListTodoIcon,
  PaperclipIcon,
  PauseCircleIcon,
  PencilIcon,
  PlayCircleIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  CornerDownLeftIcon,
  MoreHorizontalIcon,
  type LucideIcon,
  XIcon,
} from "lucide-react";
import { useI18n, type TranslationKey } from "../../i18n";
import { proposedPlanTitle } from "../../proposedPlan";
import {
  getProviderInteractionModeToggle,
  getProviderModelCapabilities,
} from "../../providerModels";
import {
  deriveProviderInstanceEntries,
  resolveProviderDriverKindForInstanceSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type AppModelOption, getAppModelOptionsForInstance } from "../../modelSelection";
import { DEFAULT_PROVIDER_PERSONALITY, type UnifiedSettings } from "@t3tools/contracts/settings";
import { useUpdateSettings } from "../../hooks/useSettings";
import type { ChatAttachment, SessionPhase, Thread } from "../../types";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import { searchProviderSkills } from "../../providerSkillSearch";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { getWsConnectionUiState, useWsConnectionStatus } from "../../rpc/wsConnectionState";
import {
  attachComposerPluginMentionHealth,
  formatComposerPluginMentionHealthStatus,
  getVisibleComposerPluginMentions,
  resolveComposerPluginMentionHealthBlock,
  resolvePromptComposerPluginMentionHealthBlock,
  type ComposerPluginMention,
  searchComposerPluginMentionList,
} from "../../composerPluginMentions";
import { useToolBridgeHealth } from "../../hooks/useToolBridgeHealth";

const ATTACHMENT_SIZE_LIMIT_LABEL = `${Math.round(
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024),
)}MB`;

const PERSONALITY_SLASH_OPTIONS: ReadonlyArray<{
  readonly value: ProviderPersonality;
  readonly labelKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
}> = [
  {
    value: "friendly",
    labelKey: "settings.personalityFriendly",
    descriptionKey: "settings.personalityFriendlyDescription",
  },
  {
    value: "pragmatic",
    labelKey: "settings.personalityPragmatic",
    descriptionKey: "settings.personalityPragmaticDescription",
  },
  {
    value: "none",
    labelKey: "settings.personalityNone",
    descriptionKey: "settings.personalityNoneDescription",
  },
];

function formatComposerAttachmentTypeLabel(name: string, mimeType: string): string {
  const basename = basenameOfPath(name);
  const extension = /\.([A-Za-z0-9][A-Za-z0-9-]{0,9})$/u.exec(basename)?.[1];
  if (extension) {
    return extension.toUpperCase();
  }

  const subtype = mimeType.split("/")[1]?.split(/[+;]/u)[0]?.trim();
  return subtype ? subtype.toUpperCase() : "FILE";
}

const runtimeModeConfig: Record<
  RuntimeMode,
  {
    shortLabelKey: TranslationKey;
    labelKey: TranslationKey;
    descriptionKey: TranslationKey;
    statusKey: TranslationKey;
    icon: LucideIcon;
    tone: "muted" | "blue" | "orange";
  }
> = {
  "approval-required": {
    shortLabelKey: "composer.permission.approvalRequired",
    labelKey: "composer.permission.approvalRequired",
    descriptionKey: "composer.permission.approvalRequiredDescription",
    statusKey: "composer.permission.approvalRequiredStatus",
    icon: HandIcon,
    tone: "muted",
  },
  "auto-accept-edits": {
    shortLabelKey: "composer.permission.autoAcceptEdits",
    labelKey: "composer.permission.autoAcceptEdits",
    descriptionKey: "composer.permission.autoAcceptEditsDescription",
    statusKey: "composer.permission.autoAcceptEditsStatus",
    icon: ShieldCheckIcon,
    tone: "blue",
  },
  "full-access": {
    shortLabelKey: "composer.permission.fullAccessShort",
    labelKey: "composer.permission.fullAccess",
    descriptionKey: "composer.permission.fullAccessDescription",
    statusKey: "composer.permission.fullAccessStatus",
    icon: ShieldAlertIcon,
    tone: "orange",
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const COMPOSER_FLOATING_LAYER_SELECTOR = [
  '[data-slot="popover-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

function isInsideComposerFloatingLayer(element: Element): boolean {
  return element.closest(COMPOSER_FLOATING_LAYER_SELECTOR) !== null;
}

const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  compact: boolean;
  activeContextWindow: ReturnType<typeof deriveLatestContextWindowSnapshot>;
  showContextWindow: boolean;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  canSteerRunningTurn: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isInterruptPending?: boolean;
  isUsageLimitReached?: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isProviderUnavailable: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  newThreadMode?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}) {
  return (
    <>
      {props.showContextWindow && props.activeContextWindow ? (
        <ContextWindowMeter usage={props.activeContextWindow} />
      ) : null}
      {props.isPreparingWorktree ? (
        <span className="text-muted-foreground/70 text-xs">Preparing worktree...</span>
      ) : null}
      <ComposerPrimaryActions
        compact={props.compact}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        canSteerRunningTurn={props.canSteerRunningTurn}
        showPlanFollowUpPrompt={props.showPlanFollowUpPrompt}
        promptHasText={props.promptHasText}
        isSendBusy={props.isSendBusy}
        isInterruptPending={props.isInterruptPending ?? false}
        isUsageLimitReached={props.isUsageLimitReached ?? false}
        isConnecting={props.isConnecting}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
        isProviderUnavailable={props.isProviderUnavailable}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        newThreadMode={props.newThreadMode ?? false}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        onImplementPlanInNewThread={props.onImplementPlanInNewThread}
      />
    </>
  );
});

const ComposerPlusMenu = memo(function ComposerPlusMenu(props: {
  disabled: boolean;
  goalModeEnabled: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  skills: ReadonlyArray<ServerProviderSkill>;
  showRuntimeModeControl: boolean;
  showInteractionModeToggle: boolean;
  onAttachFiles: () => void;
  onAddSkill: () => void;
  onGoalModeChange: (enabled: boolean) => void;
  onManageSkills: () => void;
  onSelectPlugin: (plugin: ComposerPluginMention) => void;
  pluginMentions: readonly ComposerPluginMention[];
  onSelectSkill: (skill: ServerProviderSkill) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
}) {
  const { t } = useI18n();
  const [skillQuery, setSkillQuery] = useState("");
  const visibleSkills = useMemo(
    () => searchProviderSkills(props.skills, skillQuery, 12),
    [props.skills, skillQuery],
  );

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 rounded-md border-transparent bg-transparent text-muted-foreground/70 shadow-none hover:bg-transparent hover:text-foreground"
            aria-label="打开更多输入选项"
            title="更多"
            disabled={props.disabled}
          />
        }
      >
        <PlusIcon aria-hidden="true" className="size-4.5" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" sideOffset={8} className="min-w-56">
        <MenuItem onClick={props.onAttachFiles}>
          <PaperclipIcon className="size-4 shrink-0 opacity-80" />
          添加照片和文件
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger>
            <GlobeIcon className="size-4 shrink-0 opacity-80" />
            启动插件
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-52">
            {props.pluginMentions.map((plugin) => {
              const Icon = plugin.kind === "computer" ? LaptopIcon : GlobeIcon;
              const health = plugin.health;
              return (
                <MenuItem key={plugin.id} onClick={() => props.onSelectPlugin(plugin)}>
                  <Icon className="size-4 shrink-0 opacity-80" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{plugin.menuLabel}</span>
                      {health ? (
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                            health.status === "ready"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : health.status === "warning"
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "bg-destructive/10 text-destructive",
                          )}
                        >
                          {formatComposerPluginMentionHealthStatus(health.status)}
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {health ? `${health.reasonLabel} · ${health.summary}` : plugin.description}
                    </span>
                  </span>
                </MenuItem>
              );
            })}
          </MenuSubPopup>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>
            <BookOpenIcon className="size-4 shrink-0 opacity-80" />
            技能
          </MenuSubTrigger>
          <MenuSubPopup className="w-[332px] rounded-[14px] p-0">
            <div className="p-2">
              <label className="mb-2 flex h-9 items-center gap-2 rounded-[9px] border border-border bg-background px-2.5 text-muted-foreground">
                <SearchIcon className="size-4 shrink-0" />
                <input
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="搜索技能，或输入 $ 调用"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              <div className="max-h-[250px] overflow-y-auto pr-1">
                {visibleSkills.map((skill, index) => (
                  <MenuItem
                    key={skill.name}
                    onClick={() => props.onSelectSkill(skill)}
                    className="min-h-12 items-start rounded-[9px] px-2.5 py-2 animate-in fade-in slide-in-from-left-1 duration-200"
                    style={{ animationDelay: `${index * 35}ms`, animationFillMode: "both" }}
                  >
                    <BookOpenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">
                          {formatProviderSkillDisplayName(skill)}
                        </span>
                        <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                          {getComposerSkillBadgeLabel(skill)}
                        </span>
                      </span>
                      <span className="line-clamp-1 text-[12px] leading-4 text-muted-foreground">
                        {skill.shortDescription ?? skill.description ?? "通过技能增强任务执行能力"}
                      </span>
                    </span>
                  </MenuItem>
                ))}
                {visibleSkills.length === 0 ? (
                  <div className="px-2 py-8 text-center text-[12px] text-muted-foreground">
                    {skillQuery.trim() ? "没有匹配的技能" : "暂无可用技能"}
                  </div>
                ) : null}
              </div>
              <MenuSeparator className="mx-0 mt-1" />
              <MenuItem onClick={props.onAddSkill}>
                <PlusIcon className="size-4 shrink-0 opacity-80" />
                添加技能
              </MenuItem>
              <MenuItem onClick={props.onManageSkills}>
                <SettingsIcon className="size-4 shrink-0 opacity-80" />
                管理技能
              </MenuItem>
            </div>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={props.goalModeEnabled}
          variant="switch"
          onCheckedChange={(checked) => props.onGoalModeChange(Boolean(checked))}
        >
          <span className="inline-flex items-center gap-2">
            <GoalIcon className="size-4 shrink-0 opacity-80" />
            追求目标
          </span>
        </MenuCheckboxItem>
        {props.showInteractionModeToggle ? (
          <>
            <MenuCheckboxItem
              checked={props.interactionMode === "plan"}
              variant="switch"
              onCheckedChange={(checked) =>
                props.onInteractionModeChange(checked ? "plan" : "default")
              }
            >
              <span className="inline-flex items-center gap-2">
                <ListTodoIcon className="size-4 shrink-0 opacity-80" />
                计划模式
              </span>
            </MenuCheckboxItem>
          </>
        ) : null}
        {props.showRuntimeModeControl ? (
          <MenuSub>
            <MenuSubTrigger>
              <ShieldCheckIcon className="size-4 shrink-0 opacity-80" />
              {t("composer.permission.control")}
            </MenuSubTrigger>
            <MenuSubPopup className="min-w-64">
              {runtimeModeOptions.map((mode) => {
                const option = runtimeModeConfig[mode];
                const OptionIcon = option.icon;
                const selected = props.runtimeMode === mode;
                const optionLabel = t(option.labelKey);
                const optionDescription = t(option.descriptionKey);
                return (
                  <MenuItem key={mode} onClick={() => props.onRuntimeModeChange(mode)}>
                    <OptionIcon className="size-4 shrink-0 opacity-80" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm font-medium">{optionLabel}</span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {optionDescription}
                      </span>
                    </span>
                    {selected ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
                  </MenuItem>
                );
              })}
            </MenuSubPopup>
          </MenuSub>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});

function getComposerSkillBadgeLabel(skill: Pick<ServerProviderSkill, "scope" | "path">): string {
  const normalizedScope = skill.scope?.trim().toLowerCase();
  const normalizedPath = skill.path.replaceAll("\\", "/");
  if (
    normalizedScope === "project" ||
    normalizedScope === "workspace" ||
    normalizedScope === "local"
  ) {
    return "项目";
  }
  if (normalizedScope === "user" || normalizedScope === "personal") {
    return "个人";
  }
  if (normalizedScope === "system" || normalizedPath.includes("/.codex/plugins/")) {
    return "官方";
  }
  return "官方";
}

const NewThreadModeStatusChip = memo(function NewThreadModeStatusChip(props: {
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClear}
      aria-label={`关闭${props.label}`}
      className="inline-flex h-8 shrink-0 animate-in items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-[13px] font-medium text-foreground/78 fade-in slide-in-from-left-1 zoom-in-95 duration-200 hover:bg-accent hover:text-foreground active:bg-muted/80"
    >
      <XIcon className="size-3.5 stroke-[2.4px]" />
      <span className="max-w-32 truncate">{props.label}</span>
    </button>
  );
});

const runtimeModeToneClassName: Record<
  (typeof runtimeModeConfig)[RuntimeMode]["tone"],
  { trigger: string; icon: string; menuIcon: string }
> = {
  muted: {
    trigger: "text-muted-foreground hover:bg-accent hover:text-foreground",
    icon: "text-muted-foreground",
    menuIcon: "text-muted-foreground",
  },
  blue: {
    trigger:
      "text-blue-500 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-300",
    icon: "text-blue-500 dark:text-blue-400",
    menuIcon: "text-blue-500 dark:text-blue-400",
  },
  orange: {
    trigger:
      "text-orange-600 hover:bg-orange-50 hover:text-orange-600 dark:text-orange-400 dark:hover:bg-orange-500/10",
    icon: "text-orange-600 dark:text-orange-400",
    menuIcon: "text-orange-600 dark:text-orange-400",
  },
};

const ComposerRuntimeModeControl = memo(function ComposerRuntimeModeControl(props: {
  disabled: boolean;
  runtimeMode: RuntimeMode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const { t } = useI18n();
  const activeOption = runtimeModeConfig[props.runtimeMode];
  const ActiveIcon = activeOption.icon;
  const activeTone = runtimeModeToneClassName[activeOption.tone];
  const activeStatus = t(activeOption.statusKey);

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={t("composer.permission.control")}
            title={t(activeOption.descriptionKey)}
            disabled={props.disabled}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-55",
              activeTone.trigger,
            )}
          />
        }
      >
        <ActiveIcon className={cn("size-3.5", activeTone.icon)} />
        <span>{t(activeOption.shortLabelKey)}</span>
        <span className="hidden max-w-72 truncate text-[11px] font-normal text-muted-foreground/70 md:inline">
          {activeStatus}
        </span>
        <ChevronDownIcon className="size-3 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" sideOffset={8} className="min-w-[320px]">
        {runtimeModeOptions.map((mode) => {
          const option = runtimeModeConfig[mode];
          const OptionIcon = option.icon;
          const tone = runtimeModeToneClassName[option.tone];
          const selected = props.runtimeMode === mode;
          return (
            <MenuItem
              key={mode}
              onClick={() => props.onRuntimeModeChange(mode)}
              className="min-h-[58px] items-start rounded-[8px] px-3 py-2"
            >
              <OptionIcon className={cn("mt-0.5 size-4 shrink-0", tone.menuIcon)} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium text-foreground">{t(option.labelKey)}</span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {t(option.descriptionKey)}
                </span>
              </span>
              {selected ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-foreground" /> : null}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
});

const ComposerPlanModeStatusChip = memo(function ComposerPlanModeStatusChip(props: {
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClear}
      aria-label="关闭计划模式"
      title="关闭计划模式"
      className="group inline-flex h-7 shrink-0 animate-in items-center gap-1.5 rounded-full bg-muted px-2 text-[12px] font-normal text-muted-foreground fade-in slide-in-from-left-1 zoom-in-95 duration-200 hover:bg-muted/90 hover:text-foreground active:bg-muted/80"
    >
      <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
        <ListTodoIcon className="absolute size-3.5 opacity-100 transition-opacity duration-150 group-hover:opacity-0" />
        <span className="absolute inline-flex size-3.5 items-center justify-center rounded-full bg-muted-foreground/65 text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <XIcon className="size-2.5 stroke-[2.5px]" />
        </span>
      </span>
      <span>计划</span>
    </button>
  );
});

const ComposerPlanSidebarToggle = memo(function ComposerPlanSidebarToggle(props: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      title={
        props.open
          ? `Hide ${props.label.toLowerCase()} sidebar`
          : `Show ${props.label.toLowerCase()} sidebar`
      }
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium transition-colors",
        props.open
          ? "text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <ListTodoIcon className="size-3.5" />
      <span>{props.label}</span>
    </button>
  );
});

const ComposerFooterToolbar = memo(function ComposerFooterToolbar(props: {
  composerSurface: ComposerSurface;
  activeContextWindow: ReturnType<typeof deriveLatestContextWindowSnapshot>;
  compactFooter: boolean;
  compactPrimaryActions: boolean;
  disabled: boolean;
  goalModeEnabled: boolean;
  interactionMode: ProviderInteractionMode;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isProviderUnavailable: boolean;
  isPreparingWorktree: boolean;
  isSendBusy: boolean;
  isInterruptPending?: boolean;
  isUsageLimitReached: boolean;
  hasSendableContent: boolean;
  modelPicker: ReactNode;
  newThreadModeLabel: string | null;
  onAttachFiles: () => void;
  onAddSkill: () => void;
  onClearGoal: () => void;
  onClearNewThreadMode?: () => void;
  onGoalModeChange: (enabled: boolean) => void;
  onImplementPlanInNewThread: () => void;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onInterrupt: () => void;
  onPreviousPendingQuestion: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onSelectPlugin: (plugin: ComposerPluginMention) => void;
  onSelectSkill: (skill: ServerProviderSkill) => void;
  onManageSkills: () => void;
  onTogglePlanSidebar: () => void;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  phase: SessionPhase;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  pluginMentions: readonly ComposerPluginMention[];
  preserveComposerFocusOnPointerDown: boolean;
  promptHasText: boolean;
  runtimeMode: RuntimeMode;
  showContextWindow: boolean;
  showInteractionModeToggle: boolean;
  showMobilePendingAnswerActions: boolean;
  showPlanFollowUpPrompt: boolean;
  showPlanSidebarToggle: boolean;
  skills: ReadonlyArray<ServerProviderSkill>;
  canSteerRunningTurn: boolean;
}) {
  const isNewThreadComposer = props.composerSurface === "new-thread";
  const isReplyComposer = props.composerSurface === "reply";

  return (
    <div
      data-chat-composer-footer="true"
      data-chat-composer-footer-compact={props.compactFooter ? "true" : "false"}
      data-chat-composer-surface={props.composerSurface}
      className={cn(
        "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-3.5 pb-3.5",
        isNewThreadComposer && "absolute bottom-0 left-0 right-0 px-3 pb-2.5",
        props.compactFooter ? "gap-1.5" : "gap-2 sm:gap-0",
        props.showMobilePendingAnswerActions && "hidden sm:flex",
      )}
    >
      <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ComposerPlusMenu
          disabled={props.disabled}
          goalModeEnabled={props.goalModeEnabled}
          interactionMode={props.interactionMode}
          runtimeMode={props.runtimeMode}
          skills={props.skills}
          showRuntimeModeControl
          showInteractionModeToggle={props.showInteractionModeToggle}
          onAttachFiles={props.onAttachFiles}
          onAddSkill={props.onAddSkill}
          onGoalModeChange={props.onGoalModeChange}
          onManageSkills={props.onManageSkills}
          onSelectPlugin={props.onSelectPlugin}
          pluginMentions={props.pluginMentions}
          onSelectSkill={props.onSelectSkill}
          onRuntimeModeChange={props.onRuntimeModeChange}
          onInteractionModeChange={props.onInteractionModeChange}
        />

        <ComposerRuntimeModeControl
          disabled={props.disabled}
          runtimeMode={props.runtimeMode}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />

        {isNewThreadComposer && props.newThreadModeLabel && props.onClearNewThreadMode ? (
          <NewThreadModeStatusChip
            label={props.newThreadModeLabel}
            onClear={props.onClearNewThreadMode}
          />
        ) : null}

        {props.interactionMode === "plan" ? (
          <ComposerPlanModeStatusChip onClear={() => props.onInteractionModeChange("default")} />
        ) : null}

        {props.goalModeEnabled ? <ComposerGoalStatusChip onClear={props.onClearGoal} /> : null}

        {isReplyComposer ? props.modelPicker : null}

        {props.showPlanSidebarToggle ? (
          <ComposerPlanSidebarToggle
            label={props.planSidebarLabel}
            open={props.planSidebarOpen}
            onToggle={props.onTogglePlanSidebar}
          />
        ) : null}
      </div>

      <div
        data-chat-composer-actions="right"
        data-chat-composer-primary-actions-compact={props.compactPrimaryActions ? "true" : "false"}
        className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
      >
        {isNewThreadComposer ? props.modelPicker : null}
        <ComposerFooterPrimaryActions
          compact={props.compactPrimaryActions}
          activeContextWindow={props.activeContextWindow}
          showContextWindow={props.showContextWindow}
          pendingAction={props.pendingAction}
          isRunning={props.phase === "running"}
          canSteerRunningTurn={props.canSteerRunningTurn}
          showPlanFollowUpPrompt={props.showPlanFollowUpPrompt}
          promptHasText={props.promptHasText}
          isSendBusy={props.isSendBusy}
          isInterruptPending={props.isInterruptPending ?? false}
          isUsageLimitReached={props.isUsageLimitReached}
          isConnecting={props.isConnecting}
          isEnvironmentUnavailable={props.isEnvironmentUnavailable}
          isProviderUnavailable={props.isProviderUnavailable}
          isPreparingWorktree={props.isPreparingWorktree}
          hasSendableContent={props.hasSendableContent}
          preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown}
          newThreadMode={isNewThreadComposer}
          onPreviousPendingQuestion={props.onPreviousPendingQuestion}
          onInterrupt={props.onInterrupt}
          onImplementPlanInNewThread={props.onImplementPlanInNewThread}
        />
      </div>
    </div>
  );
});

const ComposerGoalStatusChip = memo(function ComposerGoalStatusChip(props: {
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClear}
      aria-label="关闭目标模式"
      title="关闭目标模式"
      className="group inline-flex h-7 shrink-0 animate-in items-center gap-1.5 rounded-full bg-muted px-2 text-[12px] font-normal text-muted-foreground fade-in slide-in-from-left-1 zoom-in-95 duration-200 hover:bg-muted/90 hover:text-foreground active:bg-muted/80"
    >
      <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
        <GoalIcon className="absolute size-3.5 opacity-100 transition-opacity duration-150 group-hover:opacity-0" />
        <span className="absolute inline-flex size-3.5 items-center justify-center rounded-full bg-muted-foreground/65 text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <XIcon className="size-2.5 stroke-[2.5px]" />
        </span>
      </span>
      <span>目标</span>
    </button>
  );
});

const ComposerGoalProgressPanel = memo(function ComposerGoalProgressPanel(props: {
  goal: OrchestrationGoal;
  expanded: boolean;
  onEdit: () => void;
  onTogglePaused: () => void;
  onClear: () => void;
  onToggleExpanded: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  const goal = props.goal;
  const paused = goal?.status === "paused";
  const canPauseResume = goal?.status === "active" || goal?.status === "paused";
  const title = resolveGoalPanelTitle(goal?.status);
  const elapsed = goal ? formatGoalDuration(computeGoalElapsedMs(goal, nowMs)) : null;

  return (
    <div
      data-chat-composer-goal-panel="true"
      className="mb-1.5 rounded-xl border border-border/70 bg-card/98 px-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.045)]"
    >
      <div className="flex h-9 min-w-0 items-center gap-2">
        <GoalIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        <span className="shrink-0 text-[13px] font-medium text-foreground">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          {goal.objective}
        </span>
        {elapsed ? <span className="shrink-0 text-xs text-muted-foreground">{elapsed}</span> : null}
        <div className="flex shrink-0 items-center gap-0.5">
          <IconToolbarButton label="编辑目标" onClick={props.onEdit}>
            <PencilIcon className="size-3.5" />
          </IconToolbarButton>
          <IconToolbarButton
            label={paused ? "恢复目标" : "暂停目标"}
            disabled={!canPauseResume}
            onClick={props.onTogglePaused}
          >
            {paused ? (
              <PlayCircleIcon className="size-3.5" />
            ) : (
              <PauseCircleIcon className="size-3.5" />
            )}
          </IconToolbarButton>
          <IconToolbarButton label="清除目标" onClick={props.onClear}>
            <Trash2Icon className="size-3.5" />
          </IconToolbarButton>
          <IconToolbarButton
            label={props.expanded ? "收起目标" : "展开目标"}
            onClick={props.onToggleExpanded}
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", !props.expanded && "-rotate-90")}
            />
          </IconToolbarButton>
        </div>
      </div>
      {props.expanded ? (
        <p className="break-words border-t border-border/55 pb-2 pt-1.5 text-[13px] leading-5 text-muted-foreground">
          {goal.objective}
        </p>
      ) : null}
    </div>
  );
});

function IconToolbarButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={props.disabled}
            aria-label={props.label}
            title={props.label}
            className="size-6 rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{props.label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

function resolveGoalPanelTitle(status: OrchestrationGoalStatus | undefined): string {
  switch (status) {
    case "paused":
      return "已暂停的目标";
    case "blocked":
      return "受阻的目标";
    case "usageLimited":
      return "用量受限的目标";
    case "budgetLimited":
      return "预算受限的目标";
    case "complete":
      return "已完成的目标";
    case "active":
    case undefined:
      return "进行中的目标";
  }
}

export interface PendingSteerDraftView {
  text: string;
  attachments: ChatAttachment[];
  terminalContextCount: number;
}

const ComposerPendingSteerDraftPanel = memo(function ComposerPendingSteerDraftPanel(props: {
  draft: PendingSteerDraftView;
  confirmDisabled: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  const summary = props.draft.text.trim() || "附件消息";
  const attachmentCount = props.draft.attachments.length;
  const terminalContextCount = props.draft.terminalContextCount;

  return (
    <div
      data-chat-composer-pending-steer="true"
      className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-muted/15 px-3 py-2 sm:px-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <CornerDownLeftIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
        <div className="min-w-0">
          <div className="truncate text-[13px] leading-5 text-foreground/85">{summary}</div>
          {attachmentCount > 0 || terminalContextCount > 0 ? (
            <div className="truncate text-[11px] leading-4 text-muted-foreground/70">
              {[
                attachmentCount > 0 ? `${attachmentCount} 个附件` : null,
                terminalContextCount > 0 ? `${terminalContextCount} 个终端上下文` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 text-[12px] font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        disabled={props.confirmDisabled}
        onClick={props.onConfirm}
      >
        <CornerDownLeftIcon className="size-3.5" />
        引导
      </button>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/75 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        aria-label="丢弃引导消息"
        title="丢弃引导消息"
        onClick={props.onDiscard}
      >
        <Trash2Icon className="size-3.5" />
      </button>
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/75 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label="引导消息操作"
              title="引导消息操作"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end" side="top">
          <MenuItem onClick={props.onEdit}>
            <PencilIcon className="size-4 shrink-0 opacity-80" />
            编辑消息
          </MenuItem>
          <MenuItem onClick={props.onDiscard}>
            <Trash2Icon className="size-4 shrink-0 opacity-80" />
            关闭排队
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
});

// --------------------------------------------------------------------------
// Handle exposed to ChatView
// --------------------------------------------------------------------------

export interface ChatComposerHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  openModelPicker: () => void;
  toggleModelPicker: () => void;
  isModelPickerOpen: () => boolean;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  };
  /** Reset composer cursor/trigger/highlight after external prompt mutations (e.g. onSend). */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Insert a terminal context from the terminal drawer. */
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Get the current prompt/effort/model state for use in send. */
  getSendContext: () => {
    prompt: string;
    images: ComposerImageAttachment[];
    terminalContexts: TerminalContextDraft[];
    selectedPromptEffort: string | null;
    selectedModelOptionsForDispatch: unknown;
    selectedModelSelection: ModelSelection;
    selectedProvider: ProviderDriverKind;
    selectedModel: string;
    selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  };
}

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

export interface ChatComposerProps {
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;

  // Thread context
  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThread: Thread | undefined;
  isServerThread: boolean;
  isLocalDraftThread: boolean;

  // Session phase
  phase: SessionPhase;
  canSteerRunningTurn: boolean;
  isConnecting: boolean;
  isSendBusy: boolean;
  isInterruptPending?: boolean;
  isUsageLimitReached?: boolean;
  isPreparingWorktree: boolean;
  environmentUnavailable: {
    readonly label: string;
    readonly connectionState: "connecting" | "disconnected" | "error";
  } | null;
  pendingSteerDraft: PendingSteerDraftView | null;

  // Pending approvals / inputs
  activePendingApproval: PendingApproval | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activePendingProgress: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: { id: string; multiSelect?: boolean | undefined } | null;
  } | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  respondingRequestIds: ApprovalRequestId[];

  // Plan
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;
  activePlan: { turnId?: TurnId } | null;
  sidebarProposedPlan: { turnId?: TurnId } | null;
  planSidebarLabel: string;
  planSidebarOpen: boolean;

  // Mode
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  goalModeEnabled: boolean;
  goal: OrchestrationGoal | null;

  // Provider / model
  lockedProvider: ProviderDriverKind | null;
  providerStatuses: ServerProvider[];
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;

  // Context window
  activeThreadActivities: Thread["activities"] | undefined;

  // Misc
  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;
  newThreadMode?: boolean;
  newThreadPlaceholder?: string;
  newThreadModeLabel?: string | null;
  onClearNewThreadMode?: () => void;
  onComposerEmptyChange?: (isEmpty: boolean) => void;

  // Refs the parent needs kept in sync
  promptRef: React.MutableRefObject<string>;
  composerImagesRef: React.MutableRefObject<ComposerImageAttachment[]>;
  composerTerminalContextsRef: React.MutableRefObject<TerminalContextDraft[]>;

  // Scroll
  shouldAutoScrollRef: React.MutableRefObject<boolean>;
  scheduleStickToBottom: () => void;

  // Callbacks
  onSend: (e?: { preventDefault: () => void }) => void;
  onInterrupt: () => void;
  onConfirmPendingSteerDraft: () => void;
  onEditPendingSteerDraft: () => void;
  onDiscardPendingSteerDraft: () => void;
  onImplementPlanInNewThread: () => void;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
    responseText?: string,
  ) => Promise<void>;
  onSelectActivePendingUserInputOption: (questionId: string, optionLabel: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  onSelectActivePendingUserInputQuestion: (questionIndex: number) => void;
  onIgnoreActivePendingUserInput: () => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;

  onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onGoalModeChange: (enabled: boolean) => void;
  onSetGoalObjective: (objective: string) => void;
  onSetGoalStatus: (status: OrchestrationGoalStatus) => void;
  togglePlanSidebar: () => void;

  focusComposer: () => void;
  scheduleComposerFocus: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ChatComposer = memo(
  forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(props, ref) {
    const {
      composerDraftTarget,
      environmentId,
      draftId,
      activeThreadId,
      activeThreadEnvironmentId: _activeThreadEnvironmentId,
      activeThread,
      isServerThread: _isServerThread,
      isLocalDraftThread: _isLocalDraftThread,
      phase,
      canSteerRunningTurn,
      isConnecting,
      isSendBusy,
      isInterruptPending = false,
      isUsageLimitReached = false,
      isPreparingWorktree,
      environmentUnavailable,
      pendingSteerDraft,
      activePendingApproval,
      pendingApprovals,
      pendingUserInputs,
      activePendingProgress,
      activePendingResolvedAnswers,
      activePendingIsResponding,
      activePendingDraftAnswers,
      activePendingQuestionIndex,
      respondingRequestIds,
      showPlanFollowUpPrompt,
      activeProposedPlan,
      activePlan,
      sidebarProposedPlan,
      planSidebarLabel,
      planSidebarOpen,
      runtimeMode,
      interactionMode,
      goalModeEnabled,
      goal,
      lockedProvider,
      providerStatuses,
      activeProjectDefaultModelSelection,
      activeThreadModelSelection,
      activeThreadActivities,
      resolvedTheme,
      settings,
      keybindings,
      terminalOpen,
      gitCwd,
      newThreadMode = false,
      newThreadPlaceholder,
      newThreadModeLabel = null,
      onClearNewThreadMode,
      onComposerEmptyChange,
      promptRef,
      composerImagesRef,
      composerTerminalContextsRef,
      shouldAutoScrollRef,
      scheduleStickToBottom,
      onSend,
      onInterrupt,
      onConfirmPendingSteerDraft,
      onEditPendingSteerDraft,
      onDiscardPendingSteerDraft,
      onImplementPlanInNewThread,
      onRespondToApproval,
      onSelectActivePendingUserInputOption,
      onAdvanceActivePendingUserInput,
      onPreviousActivePendingUserInputQuestion,
      onSelectActivePendingUserInputQuestion,
      onIgnoreActivePendingUserInput,
      onChangeActivePendingUserInputCustomAnswer,
      onProviderModelSelect,
      toggleInteractionMode,
      handleRuntimeModeChange,
      handleInteractionModeChange,
      onGoalModeChange,
      onSetGoalObjective,
      onSetGoalStatus,
      togglePlanSidebar,
      focusComposer,
      scheduleComposerFocus,
      setThreadError,
      onExpandImage,
    } = props;
    const { updateSettings } = useUpdateSettings();
    const navigate = useNavigate();
    const { t } = useI18n();
    const { browserExternalPlugin, items: toolBridgeHealthItems } = useToolBridgeHealth();
    const composerSurface: ComposerSurface = newThreadMode ? "new-thread" : "reply";
    const visiblePluginMentions = useMemo(
      () =>
        attachComposerPluginMentionHealth(
          getVisibleComposerPluginMentions({
            includeChrome: true,
          }),
          toolBridgeHealthItems,
        ),
      [toolBridgeHealthItems],
    );

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images / terminal contexts)
    // ------------------------------------------------------------------
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const prompt = composerDraft.prompt;
    const composerImages = composerDraft.images;
    const composerTerminalContexts = composerDraft.terminalContexts;
    const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
    const promptIsEmpty = prompt.trim().length === 0;

    const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
    const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
    const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
    const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
    const insertComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.insertTerminalContext,
    );
    const removeComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.removeTerminalContext,
    );
    const setComposerDraftTerminalContexts = useComposerDraftStore(
      (store) => store.setTerminalContexts,
    );
    const clearComposerDraftPersistedAttachments = useComposerDraftStore(
      (store) => store.clearPersistedAttachments,
    );
    const syncComposerDraftPersistedAttachments = useComposerDraftStore(
      (store) => store.syncPersistedAttachments,
    );
    const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
    const setComposerDraftModelSelection = useComposerDraftStore(
      (store) => store.setModelSelection,
    );
    const setStickyComposerModelSelection = useComposerDraftStore(
      (store) => store.setStickyModelSelection,
    );

    // ------------------------------------------------------------------
    // Model state
    // ------------------------------------------------------------------
    // Instance-aware projection of the wire provider list. One entry per
    // configured instance (default built-in + any custom `providerInstances.*`),
    // sorted default-first per driver kind for a stable picker order.
    const providerInstanceEntries = useMemo<ReadonlyArray<ProviderInstanceEntry>>(
      () => sortProviderInstanceEntries(deriveProviderInstanceEntries(providerStatuses)),
      [providerStatuses],
    );
    const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
    const threadProvider =
      activeThread?.session?.providerInstanceId ??
      activeThreadModelSelection?.instanceId ??
      activeProjectDefaultModelSelection?.instanceId ??
      null;
    const explicitSelectedInstanceId = selectedProviderByThreadId ?? threadProvider;

    const unlockedSelectedProvider =
      resolveProviderDriverKindForInstanceSelection(
        providerInstanceEntries,
        providerStatuses,
        explicitSelectedInstanceId,
      ) ?? ProviderDriverKind.make("codex");
    const selectedProvider: ProviderDriverKind = lockedProvider ?? unlockedSelectedProvider;
    const lockedContinuationGroupKey = useMemo((): string | null => {
      if (!lockedProvider || !activeThread) return null;
      const lockedInstanceId =
        activeThread.session?.providerInstanceId ?? activeThreadModelSelection?.instanceId;
      if (!lockedInstanceId) return null;
      return (
        providerInstanceEntries.find((entry) => entry.instanceId === lockedInstanceId)
          ?.continuationGroupKey ?? null
      );
    }, [
      activeThread,
      activeThreadModelSelection?.instanceId,
      lockedProvider,
      providerInstanceEntries,
    ]);

    // Resolve which configured instance the composer is currently targeting.
    // Priority:
    //   1. The composer draft's `activeProvider` — the user's unsaved pick
    //      from the model picker (must win, otherwise the UI appears to
    //      ignore picker selections).
    //   2. Thread's persisted instance id (server-side saved selection).
    //   3. Project default's instance id.
    //   4. First enabled entry matching the current driver kind.
    //   5. First enabled entry overall / default instance for the kind.
    //
    const selectedInstanceId = useMemo<ProviderInstanceId>(() => {
      const candidates: Array<string | null | undefined> = [
        composerDraft.activeProvider,
        activeThread?.session?.providerInstanceId,
        activeThreadModelSelection?.instanceId,
        activeProjectDefaultModelSelection?.instanceId,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const match = providerInstanceEntries.find(
          (entry) => entry.instanceId === candidate && entry.enabled,
        );
        if (match) {
          // When locked to a specific driver kind, ignore persisted instance
          // ids from a different kind or continuation group.
          if (lockedProvider && match.driverKind !== lockedProvider) continue;
          if (
            lockedContinuationGroupKey &&
            match.continuationGroupKey !== lockedContinuationGroupKey
          ) {
            continue;
          }
          return match.instanceId;
        }
      }
      if (explicitSelectedInstanceId) {
        return ProviderInstanceId.make(explicitSelectedInstanceId);
      }
      const byKind = providerInstanceEntries.find(
        (entry) =>
          entry.enabled &&
          entry.driverKind === selectedProvider &&
          (!lockedContinuationGroupKey ||
            entry.continuationGroupKey === lockedContinuationGroupKey),
      );
      if (byKind) return byKind.instanceId;
      const anyEnabled = providerInstanceEntries.find((entry) => entry.enabled);
      return (
        anyEnabled?.instanceId ??
        providerInstanceEntries[0]?.instanceId ??
        activeThreadModelSelection?.instanceId ??
        activeProjectDefaultModelSelection?.instanceId ??
        ProviderInstanceId.make("codex")
      );
    }, [
      activeProjectDefaultModelSelection?.instanceId,
      activeThread?.session?.providerInstanceId,
      activeThreadModelSelection?.instanceId,
      composerDraft.activeProvider,
      explicitSelectedInstanceId,
      lockedContinuationGroupKey,
      lockedProvider,
      providerInstanceEntries,
      selectedProvider,
    ]);

    const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
      threadRef: composerDraftTarget,
      providers: providerStatuses,
      selectedProvider,
      selectedInstanceId,
      threadModelSelection: activeThreadModelSelection,
      projectModelSelection: activeProjectDefaultModelSelection,
      settings,
    });

    // Resolve the active instance's snapshot by `instanceId` so a custom
    // instance gets its own slash commands, skills, and model list — not
    // the first snapshot for the same driver kind.
    const selectedProviderEntry = useMemo(
      () => providerInstanceEntries.find((entry) => entry.instanceId === selectedInstanceId),
      [providerInstanceEntries, selectedInstanceId],
    );
    const selectedProviderStatus = useMemo(
      () => selectedProviderEntry?.snapshot ?? null,
      [selectedProviderEntry],
    );
    const selectedProviderModels = useMemo<ReadonlyArray<ServerProvider["models"][number]>>(
      () => selectedProviderEntry?.models ?? [],
      [selectedProviderEntry],
    );
    const selectedModelOptionSelections =
      composerModelOptions?.[selectedInstanceId] ??
      composerModelOptions?.[ProviderInstanceId.make(selectedProvider)];
    const selectedModelCapabilities = useMemo(
      () => getProviderModelCapabilities(selectedProviderModels, selectedModel, selectedProvider),
      [selectedModel, selectedProvider, selectedProviderModels],
    );

    const composerProviderState = useMemo(
      () =>
        getComposerProviderState({
          provider: selectedProvider,
          model: selectedModel,
          models: selectedProviderModels,
          prompt,
          modelOptions: selectedModelOptionSelections,
        }),
      [
        prompt,
        selectedModel,
        selectedModelOptionSelections,
        selectedProvider,
        selectedProviderModels,
      ],
    );

    const selectedPromptEffort = composerProviderState.promptEffort;
    const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
    const composerProviderControls = useMemo(
      () => ({
        showInteractionModeToggle: getProviderInteractionModeToggle(
          providerStatuses,
          selectedProvider,
        ),
      }),
      [providerStatuses, selectedProvider],
    );
    const selectedModelSelection = useMemo<ModelSelection>(
      () =>
        createModelSelection(selectedInstanceId, selectedModel, selectedModelOptionsForDispatch),
      [selectedInstanceId, selectedModel, selectedModelOptionsForDispatch],
    );
    const handleModelOptionsChange = useCallback(
      (nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined) => {
        const nextSelection = createModelSelection(selectedInstanceId, selectedModel, nextOptions);
        setComposerDraftModelSelection(composerDraftTarget, nextSelection);
        setStickyComposerModelSelection(nextSelection);
        scheduleComposerFocus();
      },
      [
        composerDraftTarget,
        scheduleComposerFocus,
        selectedInstanceId,
        selectedModel,
        setComposerDraftModelSelection,
        setStickyComposerModelSelection,
      ],
    );
    const selectedModelForPicker = selectedModel;
    // Instance-keyed option list so the picker can show each configured
    // instance (built-in + custom) as a first-class sidebar entry. The
    // options are server-reported models plus that exact instance's
    // configured custom models; selected slugs are not injected into lists.
    const modelOptionsByInstance = useMemo<
      ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
    >(() => {
      const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
      for (const entry of providerInstanceEntries) {
        out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
      }
      return out;
    }, [providerInstanceEntries, settings]);
    const selectedInstanceModelOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
    const selectedModelForPickerWithCustomFallback = useMemo(() => {
      return selectedInstanceModelOptions.some((option) => option.slug === selectedModelForPicker)
        ? selectedModelForPicker
        : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
    }, [selectedInstanceModelOptions, selectedModelForPicker, selectedProvider]);
    const wsStatus = useWsConnectionStatus();
    const backendConnectionState = getWsConnectionUiState(wsStatus);
    const [isRefreshingComposerModels, setIsRefreshingComposerModels] = useState(false);
    const modelServiceRefreshSequenceRef = useRef(0);
    const lastAutoModelServiceRefreshKeyRef = useRef<string | null>(null);
    const lastComposerBackendReconnectAtRef = useRef(0);
    const refreshSelectedModelService = useCallback(async () => {
      const refreshSequence = modelServiceRefreshSequenceRef.current + 1;
      modelServiceRefreshSequenceRef.current = refreshSequence;
      setIsRefreshingComposerModels(true);
      try {
        await getPrimaryEnvironmentConnection().client.server.refreshProviders({
          instanceId: selectedInstanceId,
        });
      } finally {
        if (modelServiceRefreshSequenceRef.current === refreshSequence) {
          setIsRefreshingComposerModels(false);
        }
      }
    }, [selectedInstanceId]);
    const composerProviderAvailability = useMemo(
      () =>
        deriveComposerProviderAvailability({
          provider: selectedProviderStatus,
          modelOptions: selectedInstanceModelOptions,
          selectedModel: selectedModelForPickerWithCustomFallback,
          backendConnectionState,
          isRefreshingModels: isRefreshingComposerModels,
        }),
      [
        backendConnectionState,
        isRefreshingComposerModels,
        selectedInstanceModelOptions,
        selectedModelForPickerWithCustomFallback,
        selectedProviderStatus,
      ],
    );
    const isProviderUnavailable = !composerProviderAvailability.canSend;

    useEffect(() => {
      if (
        backendConnectionState === "connected" ||
        backendConnectionState === "connecting" ||
        !wsStatus.online
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastComposerBackendReconnectAtRef.current < 10_000) {
        return;
      }

      lastComposerBackendReconnectAtRef.current = now;
      void getPrimaryEnvironmentConnection()
        .reconnect()
        .catch(() => undefined);
    }, [backendConnectionState, wsStatus.online, wsStatus.reconnectPhase]);

    useEffect(() => {
      if (selectedInstanceModelOptions.length > 0) {
        lastAutoModelServiceRefreshKeyRef.current = null;
        return;
      }
      if (
        backendConnectionState !== "connected" ||
        !selectedProviderStatus ||
        !selectedProviderStatus.enabled ||
        selectedProviderStatus.status !== "ready"
      ) {
        return;
      }

      const refreshKey = String(selectedInstanceId);
      if (lastAutoModelServiceRefreshKeyRef.current === refreshKey) {
        return;
      }

      lastAutoModelServiceRefreshKeyRef.current = refreshKey;
      void refreshSelectedModelService().catch(() => undefined);
    }, [
      backendConnectionState,
      refreshSelectedModelService,
      selectedInstanceId,
      selectedInstanceModelOptions.length,
      selectedProviderStatus,
    ]);

    // ------------------------------------------------------------------
    // Context window
    // ------------------------------------------------------------------
    const activeContextWindow = useMemo(
      () => deriveLatestContextWindowSnapshot(activeThreadActivities ?? []),
      [activeThreadActivities],
    );

    // ------------------------------------------------------------------
    // Composer-local state
    // ------------------------------------------------------------------
    const [composerCursor, setComposerCursor] = useState(() =>
      collapseExpandedComposerCursor(prompt, prompt.length),
    );
    const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
      detectComposerTrigger(prompt, prompt.length),
    );
    const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
    const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
      null,
    );
    const [isDragOverComposer, setIsDragOverComposer] = useState(false);
    const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
    const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
    const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
    const [isComposerFocused, setIsComposerFocused] = useState(false);
    const [goalPanelExpanded, setGoalPanelExpanded] = useState(false);
    const [goalEditOpen, setGoalEditOpen] = useState(false);
    const [goalEditDraft, setGoalEditDraft] = useState("");
    const [goalClearConfirmOpen, setGoalClearConfirmOpen] = useState(false);
    const isMobileViewport = useMediaQuery("max-sm");
    const isComposerCollapsedMobile = isMobileViewport && !isComposerFocused;

    useEffect(() => {
      if (goalEditOpen) return;
      setGoalEditDraft(goal?.objective ?? "");
    }, [goal?.objective, goalEditOpen]);

    // ------------------------------------------------------------------
    // Refs
    // ------------------------------------------------------------------
    const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
    const composerFormRef = useRef<HTMLFormElement>(null);
    const composerSurfaceRef = useRef<HTMLDivElement>(null);
    const personalityMenuRef = useRef<HTMLDivElement>(null);
    const composerAttachmentInputRef = useRef<HTMLInputElement>(null);
    const composerFormHeightRef = useRef(0);
    const composerSelectLockRef = useRef(false);
    const composerMenuOpenRef = useRef(false);
    const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
    const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
    const [personalityMenuOpen, setPersonalityMenuOpen] = useState(false);
    const composerBlurFrameRef = useRef<number | null>(null);
    const mobileComposerExpandFrameRef = useRef<number | null>(null);
    const mobileComposerExpandReleaseFrameRef = useRef<number | null>(null);
    const mobileComposerExpandInFlightRef = useRef(false);
    const dragDepthRef = useRef(0);

    // ------------------------------------------------------------------
    // Derived: composer send state
    // ------------------------------------------------------------------
    const composerSendState = useMemo(
      () =>
        deriveComposerSendState({
          prompt,
          imageCount: composerImages.length,
          terminalContexts: composerTerminalContexts,
        }),
      [composerImages.length, composerTerminalContexts, prompt],
    );

    // ------------------------------------------------------------------
    // Derived: composer trigger / menu
    // ------------------------------------------------------------------
    const composerTriggerKind = composerTrigger?.kind ?? null;
    const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
    const isPathTrigger = composerTriggerKind === "path";
    const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
      pathTriggerQuery,
      { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
      (debouncerState) => ({ isPending: debouncerState.isPending }),
    );
    const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : "";
    const workspaceEntriesQuery = useQuery(
      projectSearchEntriesQueryOptions({
        environmentId,
        cwd: gitCwd,
        query: effectivePathQuery,
        enabled: isPathTrigger,
        limit: 80,
      }),
    );
    const workspaceEntries = workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;

    const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
      if (!composerTrigger) return [];
      if (composerTrigger.kind === "path") {
        const pluginItems = searchComposerPluginMentionList(
          visiblePluginMentions,
          composerTrigger.query,
        ).map((plugin) => ({
          id: `plugin:${plugin.id}`,
          type: "plugin" as const,
          plugin,
          label: plugin.menuLabel,
          description: plugin.health
            ? `${plugin.health.reasonLabel} · ${plugin.health.summary}`
            : plugin.description,
        }));
        const pathItems = workspaceEntries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path" as const,
          path: entry.path,
          pathKind: entry.kind,
          label: basenameOfPath(entry.path),
          description: entry.parentPath ?? "",
        }));
        return [...pluginItems, ...pathItems];
      }
      if (composerTrigger.kind === "slash-command") {
        const builtInSlashCommandItems = [
          {
            id: "slash:model",
            type: "slash-command",
            command: "model",
            label: "/model",
            description: t("composer.slash.modelDescription"),
          },
          {
            id: "slash:personality",
            type: "slash-command",
            command: "personality",
            label: "/personality",
            description: t("composer.slash.personalityDescription"),
          },
          {
            id: "slash:plan",
            type: "slash-command",
            command: "plan",
            label: "/plan",
            description: t("composer.slash.planDescription"),
          },
          {
            id: "slash:default",
            type: "slash-command",
            command: "default",
            label: "/default",
            description: t("composer.slash.defaultDescription"),
          },
        ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
        const providerSlashCommandItems = (selectedProviderStatus?.slashCommands ?? []).map(
          (command) => ({
            id: `provider-slash-command:${selectedProvider}:${command.name}`,
            type: "provider-slash-command" as const,
            provider: selectedProvider,
            command,
            label: `/${command.name}`,
            description:
              command.description ?? command.input?.hint ?? t("composer.slash.providerDescription"),
          }),
        );
        const query = composerTrigger.query.trim().toLowerCase();
        const slashCommandItems = [...builtInSlashCommandItems, ...providerSlashCommandItems];
        if (!query) {
          return slashCommandItems;
        }
        return searchSlashCommandItems(slashCommandItems, query);
      }
      if (composerTrigger.kind === "skill") {
        return searchProviderSkills(
          selectedProviderStatus?.skills ?? [],
          composerTrigger.query,
        ).map((skill) => ({
          id: `skill:${selectedProvider}:${skill.name}`,
          type: "skill" as const,
          provider: selectedProvider,
          skill,
          label: formatProviderSkillDisplayName(skill),
          description:
            skill.shortDescription ??
            skill.description ??
            (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
        }));
      }
      return [];
    }, [
      composerTrigger,
      selectedProvider,
      selectedProviderStatus,
      t,
      visiblePluginMentions,
      workspaceEntries,
    ]);

    const composerMenuOpen = Boolean(composerTrigger) && !personalityMenuOpen;
    const showPersonalityMenu = personalityMenuOpen;
    const composerMenuSearchKey = composerTrigger
      ? `${composerTrigger.kind}:${composerTrigger.query.trim().toLowerCase()}`
      : null;
    const activeComposerMenuItem = useMemo(() => {
      const activeItemId = resolveComposerMenuActiveItemId({
        items: composerMenuItems,
        highlightedItemId: composerHighlightedItemId,
        currentSearchKey: composerMenuSearchKey,
        highlightedSearchKey: composerHighlightedSearchKey,
      });
      return composerMenuItems.find((item) => item.id === activeItemId) ?? null;
    }, [
      browserExternalPlugin.installed,
      composerHighlightedItemId,
      composerHighlightedSearchKey,
      composerMenuItems,
      composerMenuSearchKey,
    ]);

    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;

    const nonPersistedComposerImageIdSet = useMemo(
      () => new Set(nonPersistedComposerImageIds),
      [nonPersistedComposerImageIds],
    );

    const isComposerApprovalState = activePendingApproval !== null;
    const activePendingUserInput = pendingUserInputs[0] ?? null;
    const hasComposerHeader =
      isComposerApprovalState ||
      pendingUserInputs.length > 0 ||
      (showPlanFollowUpPrompt && activeProposedPlan !== null);
    const showCollapsedMobilePromptRow =
      isComposerCollapsedMobile && !isComposerApprovalState && pendingUserInputs.length === 0;

    const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
    const hasPlanSidebarContent = Boolean(activePlan || sidebarProposedPlan);
    const composerFooterVisibility = deriveComposerFooterVisibility({
      composerSurface,
      hasPlanSidebarContent,
      planSidebarOpen,
      hasContextWindow: activeContextWindow !== null,
    });
    const showPlanSidebarToggle = composerFooterVisibility.showPlanSidebarToggle;
    const showContextWindow = composerFooterVisibility.showContextWindow;
    const runningPrimaryActionMode =
      phase === "running"
        ? getRunningPrimaryActionMode({
            canSteerRunningTurn,
            hasSendableContent: composerSendState.hasSendableContent,
            isInterruptPending,
          })
        : null;
    const composerFooterActionLayoutKey = useMemo(() => {
      if (activePendingProgress) {
        return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
      }
      if (phase === "running") {
        return `running:${runningPrimaryActionMode}`;
      }
      if (showPlanFollowUpPrompt) {
        return promptIsEmpty ? "plan:implement" : "plan:refine";
      }
      return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
    }, [
      activePendingIsResponding,
      activePendingProgress,
      composerSendState.hasSendableContent,
      isConnecting,
      isPreparingWorktree,
      isSendBusy,
      isInterruptPending,
      phase,
      promptIsEmpty,
      runningPrimaryActionMode,
      showPlanFollowUpPrompt,
    ]);

    const isComposerMenuLoading =
      composerTriggerKind === "path" &&
      ((pathTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
        workspaceEntriesQuery.isLoading ||
        workspaceEntriesQuery.isFetching);
    const composerMenuEmptyState = useMemo(() => {
      if (composerTriggerKind === "skill") {
        return t("composer.menu.noSkills");
      }
      return composerTriggerKind === "path"
        ? t("composer.menu.noFiles")
        : t("composer.menu.noCommand");
    }, [composerTriggerKind, t]);

    const pendingPrimaryAction = useMemo(
      () =>
        activePendingProgress
          ? {
              questionIndex: activePendingProgress.questionIndex,
              isLastQuestion: activePendingProgress.isLastQuestion,
              canAdvance: activePendingProgress.canAdvance,
              isResponding: activePendingIsResponding,
              isComplete: Boolean(activePendingResolvedAnswers),
            }
          : null,
      [activePendingIsResponding, activePendingProgress, activePendingResolvedAnswers],
    );
    const collapsedComposerPrimaryActionDisabled =
      runningPrimaryActionMode === "interrupt"
        ? false
        : isSendBusy ||
          isConnecting ||
          environmentUnavailable !== null ||
          isProviderUnavailable ||
          !composerSendState.hasSendableContent;
    const collapsedComposerPrimaryActionLabel =
      runningPrimaryActionMode === "interrupt"
        ? isInterruptPending
          ? "Stopping generation"
          : "Stop generation"
        : runningPrimaryActionMode === "steer"
          ? "Steer current turn"
          : isProviderUnavailable
            ? (composerProviderAvailability.triggerLabel ?? "Model service unavailable")
            : "Send message";
    const showMobilePendingAnswerActions =
      isMobileViewport && !isComposerCollapsedMobile && pendingPrimaryAction !== null;

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------
    const setPrompt = useCallback(
      (nextPrompt: string) => {
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      },
      [composerDraftTarget, setComposerDraftPrompt],
    );

    const editGoalFromPanel = useCallback(() => {
      setGoalEditDraft(goal?.objective ?? "");
      setGoalEditOpen(true);
    }, [goal?.objective]);

    const saveGoalEdit = useCallback(() => {
      const objective = normalizeGoalObjective(goalEditDraft);
      if (!isValidGoalObjective(objective)) {
        return;
      }
      onSetGoalObjective(objective);
      setGoalEditOpen(false);
    }, [goalEditDraft, onSetGoalObjective]);

    const toggleGoalPaused = useCallback(() => {
      if (!goal) return;
      onSetGoalStatus(goal.status === "paused" ? "active" : "paused");
    }, [goal, onSetGoalStatus]);

    const clearGoalFromPanel = useCallback(() => {
      setGoalClearConfirmOpen(true);
    }, []);

    const confirmClearGoal = useCallback(() => {
      setGoalClearConfirmOpen(false);
      onGoalModeChange(false);
    }, [onGoalModeChange]);

    const addComposerImage = useCallback(
      (image: ComposerImageAttachment) => {
        addComposerDraftImage(composerDraftTarget, image);
      },
      [composerDraftTarget, addComposerDraftImage],
    );

    const addComposerImagesToDraft = useCallback(
      (images: ComposerImageAttachment[]) => {
        addComposerDraftImages(composerDraftTarget, images);
      },
      [composerDraftTarget, addComposerDraftImages],
    );

    const removeComposerImageFromDraft = useCallback(
      (imageId: string) => {
        removeComposerDraftImage(composerDraftTarget, imageId);
      },
      [composerDraftTarget, removeComposerDraftImage],
    );

    const removeComposerTerminalContextFromDraft = useCallback(
      (contextId: string) => {
        const contextIndex = composerTerminalContexts.findIndex(
          (context) => context.id === contextId,
        );
        if (contextIndex < 0) return;
        const removal = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
        promptRef.current = removal.prompt;
        setPrompt(removal.prompt);
        removeComposerDraftTerminalContext(composerDraftTarget, contextId);
        const nextCursor = collapseExpandedComposerCursor(removal.prompt, removal.cursor);
        setComposerCursor(nextCursor);
        setComposerTrigger(detectComposerTrigger(removal.prompt, removal.cursor));
      },
      [
        composerDraftTarget,
        composerTerminalContexts,
        promptRef,
        removeComposerDraftTerminalContext,
        setPrompt,
      ],
    );

    // ------------------------------------------------------------------
    // Sync refs back to parent
    // ------------------------------------------------------------------
    useEffect(() => {
      promptRef.current = prompt;
      setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
    }, [prompt, promptRef]);

    useEffect(() => {
      onComposerEmptyChange?.(promptIsEmpty);
    }, [onComposerEmptyChange, promptIsEmpty]);

    useEffect(() => {
      setGoalPanelExpanded(false);
    }, [goal?.objective]);

    useEffect(() => {
      composerImagesRef.current = composerImages;
    }, [composerImages, composerImagesRef]);

    useEffect(() => {
      composerTerminalContextsRef.current = composerTerminalContexts;
    }, [composerTerminalContexts, composerTerminalContextsRef]);

    // ------------------------------------------------------------------
    // Composer menu highlight sync
    // ------------------------------------------------------------------
    useEffect(() => {
      if (!composerMenuOpen) {
        setComposerHighlightedItemId(null);
        setComposerHighlightedSearchKey(null);
        return;
      }
      const nextActiveItemId = resolveComposerMenuActiveItemId({
        items: composerMenuItems,
        highlightedItemId: composerHighlightedItemId,
        currentSearchKey: composerMenuSearchKey,
        highlightedSearchKey: composerHighlightedSearchKey,
      });
      setComposerHighlightedItemId((existing) =>
        existing === nextActiveItemId ? existing : nextActiveItemId,
      );
      setComposerHighlightedSearchKey((existing) =>
        existing === composerMenuSearchKey ? existing : composerMenuSearchKey,
      );
    }, [
      composerHighlightedItemId,
      composerHighlightedSearchKey,
      composerMenuItems,
      composerMenuOpen,
      composerMenuSearchKey,
    ]);

    const lastSyncedPendingInputRef = useRef<{
      requestId: string | null;
      questionId: string | null;
    } | null>(null);

    useEffect(() => {
      const nextCustomAnswer = activePendingProgress?.customAnswer;
      if (typeof nextCustomAnswer !== "string") {
        lastSyncedPendingInputRef.current = null;
        return;
      }

      const nextRequestId = activePendingUserInput?.requestId ?? null;
      const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
      const questionChanged =
        lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
        lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
      const textChangedExternally = promptRef.current !== nextCustomAnswer;

      lastSyncedPendingInputRef.current = {
        requestId: nextRequestId,
        questionId: nextQuestionId,
      };

      if (!questionChanged && !textChangedExternally) {
        return;
      }

      promptRef.current = nextCustomAnswer;
      const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectComposerTrigger(
          nextCustomAnswer,
          expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
        ),
      );
      setComposerHighlightedItemId(null);
    }, [
      activePendingProgress?.customAnswer,
      activePendingProgress?.activeQuestion?.id,
      activePendingUserInput?.requestId,
      promptRef,
    ]);

    // ------------------------------------------------------------------
    // Reset compositor state on thread/draft change
    // ------------------------------------------------------------------
    useEffect(() => {
      setComposerHighlightedItemId(null);
      setPersonalityMenuOpen(false);
      setComposerCursor(
        collapseExpandedComposerCursor(promptRef.current, promptRef.current.length),
      );
      setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
      dragDepthRef.current = 0;
      setIsDragOverComposer(false);
    }, [draftId, activeThreadId, promptRef]);

    useEffect(() => {
      if (!personalityMenuOpen) return;
      const closePersonalityMenuOnOutsidePointerDown = (event: PointerEvent) => {
        const menuElement = personalityMenuRef.current;
        const target = event.target;
        if (menuElement && target instanceof Node && menuElement.contains(target)) {
          return;
        }
        setPersonalityMenuOpen(false);
      };
      window.addEventListener("pointerdown", closePersonalityMenuOnOutsidePointerDown, true);
      return () => {
        window.removeEventListener("pointerdown", closePersonalityMenuOnOutsidePointerDown, true);
      };
    }, [personalityMenuOpen]);

    // ------------------------------------------------------------------
    // Footer compact layout observation
    // ------------------------------------------------------------------
    useLayoutEffect(() => {
      const composerForm = composerFormRef.current;
      if (!composerForm) return;
      const measureComposerFormWidth = () => composerForm.clientWidth;
      const measureFooterCompactness = () => {
        const composerFormWidth = measureComposerFormWidth();
        const footerCompact = shouldUseCompactComposerFooter(composerFormWidth, {
          hasWideActions: composerFooterHasWideActions,
        });
        const primaryActionsCompact =
          footerCompact &&
          shouldUseCompactComposerPrimaryActions(composerFormWidth, {
            hasWideActions: composerFooterHasWideActions,
          });
        return {
          primaryActionsCompact,
          footerCompact,
        };
      };

      composerFormHeightRef.current = composerForm.getBoundingClientRect().height;
      const initialCompactness = measureFooterCompactness();
      setIsComposerPrimaryActionsCompact(initialCompactness.primaryActionsCompact);
      setIsComposerFooterCompact(initialCompactness.footerCompact);
      if (typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver((entries) => {
        const [entry] = entries;
        if (!entry) return;
        const nextCompactness = measureFooterCompactness();
        setIsComposerPrimaryActionsCompact((previous) =>
          previous === nextCompactness.primaryActionsCompact
            ? previous
            : nextCompactness.primaryActionsCompact,
        );
        setIsComposerFooterCompact((previous) =>
          previous === nextCompactness.footerCompact ? previous : nextCompactness.footerCompact,
        );
        const nextHeight = entry.contentRect.height;
        const previousHeight = composerFormHeightRef.current;
        composerFormHeightRef.current = nextHeight;
        if (previousHeight > 0 && Math.abs(nextHeight - previousHeight) < 0.5) return;
        if (!shouldAutoScrollRef.current) return;
        scheduleStickToBottom();
      });

      observer.observe(composerForm);
      return () => {
        observer.disconnect();
      };
    }, [
      activeThreadId,
      composerFooterActionLayoutKey,
      composerFooterHasWideActions,
      scheduleStickToBottom,
      shouldAutoScrollRef,
    ]);

    // ------------------------------------------------------------------
    // Image persist effect
    // ------------------------------------------------------------------
    useEffect(() => {
      let cancelled = false;
      void (async () => {
        if (composerImages.length === 0) {
          clearComposerDraftPersistedAttachments(composerDraftTarget);
          return;
        }
        const getPersistedAttachmentsForThread = () =>
          getComposerDraft(composerDraftTarget)?.persistedAttachments ?? [];
        try {
          const currentPersistedAttachments = getPersistedAttachmentsForThread();
          const existingPersistedById = new Map(
            currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
          );
          const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
          await Promise.all(
            composerImages.map(async (image) => {
              try {
                const dataUrl = await readFileAsDataUrl(image.file);
                stagedAttachmentById.set(image.id, {
                  id: image.id,
                  name: image.name,
                  mimeType: image.mimeType,
                  sizeBytes: image.sizeBytes,
                  dataUrl,
                });
              } catch {
                const existingPersisted = existingPersistedById.get(image.id);
                if (existingPersisted) {
                  stagedAttachmentById.set(image.id, existingPersisted);
                }
              }
            }),
          );
          const serialized = Array.from(stagedAttachmentById.values());
          if (cancelled) return;
          syncComposerDraftPersistedAttachments(composerDraftTarget, serialized);
        } catch {
          const currentImageIds = new Set(composerImages.map((image) => image.id));
          const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
          const fallbackPersistedIds = fallbackPersistedAttachments
            .map((attachment) => attachment.id)
            .filter((id) => currentImageIds.has(id));
          const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
          const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
            fallbackPersistedIdSet.has(attachment.id),
          );
          if (cancelled) return;
          syncComposerDraftPersistedAttachments(composerDraftTarget, fallbackAttachments);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      composerDraftTarget,
      clearComposerDraftPersistedAttachments,
      composerImages,
      getComposerDraft,
      syncComposerDraftPersistedAttachments,
    ]);

    // ------------------------------------------------------------------
    // Callbacks: prompt change
    // ------------------------------------------------------------------
    const onPromptChange = useCallback(
      (
        nextPrompt: string,
        nextCursor: number,
        expandedCursor: number,
        cursorAdjacentToMention: boolean,
        terminalContextIds: string[],
      ) => {
        const nextTrigger = cursorAdjacentToMention
          ? null
          : detectComposerTrigger(nextPrompt, expandedCursor);
        if (nextTrigger !== null) {
          setPersonalityMenuOpen(false);
        }
        if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
          setComposerCursor(nextCursor);
          setComposerTrigger(nextTrigger);
          onChangeActivePendingUserInputCustomAnswer(
            activePendingProgress.activeQuestion.id,
            nextPrompt,
            nextCursor,
            expandedCursor,
            cursorAdjacentToMention,
          );
          return;
        }
        promptRef.current = nextPrompt;
        setPrompt(nextPrompt);
        if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
          setComposerDraftTerminalContexts(
            composerDraftTarget,
            syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
          );
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(nextTrigger);
      },
      [
        activePendingProgress?.activeQuestion,
        pendingUserInputs.length,
        onChangeActivePendingUserInputCustomAnswer,
        promptRef,
        setPrompt,
        composerDraftTarget,
        composerTerminalContexts,
        setComposerDraftTerminalContexts,
      ],
    );

    // ------------------------------------------------------------------
    // Callbacks: prompt replacement / menu
    // ------------------------------------------------------------------
    const applyPromptReplacement = useCallback(
      (
        rangeStart: number,
        rangeEnd: number,
        replacement: string,
        options?: {
          expectedText?: string;
          focusEditorAfterReplace?: boolean;
          nextTrigger?: ComposerTrigger | null;
        },
      ): boolean => {
        const currentText = promptRef.current;
        const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
        const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
        if (
          options?.expectedText !== undefined &&
          currentText.slice(safeStart, safeEnd) !== options.expectedText
        ) {
          return false;
        }
        const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
        const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
        const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
        promptRef.current = next.text;
        const activePendingQuestion = activePendingProgress?.activeQuestion;
        if (activePendingQuestion && activePendingUserInput) {
          onChangeActivePendingUserInputCustomAnswer(
            activePendingQuestion.id,
            next.text,
            nextCursor,
            nextExpandedCursor,
            false,
          );
        } else {
          setPrompt(next.text);
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(
          options && "nextTrigger" in options
            ? (options.nextTrigger ?? null)
            : detectComposerTrigger(next.text, nextExpandedCursor),
        );
        if (options?.focusEditorAfterReplace !== false) {
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCursor);
          });
        }
        return true;
      },
      [
        activePendingProgress?.activeQuestion,
        activePendingUserInput,
        onChangeActivePendingUserInputCustomAnswer,
        promptRef,
        setPrompt,
      ],
    );

    const readComposerSnapshot = useCallback((): {
      value: string;
      cursor: number;
      expandedCursor: number;
      terminalContextIds: string[];
    } => {
      const editorSnapshot = composerEditorRef.current?.readSnapshot();
      if (editorSnapshot) {
        return editorSnapshot;
      }
      return {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
    }, [composerCursor, composerTerminalContexts, promptRef]);

    const resolveActiveComposerTrigger = useCallback((): {
      snapshot: { value: string; cursor: number; expandedCursor: number };
      trigger: ComposerTrigger | null;
    } => {
      const snapshot = readComposerSnapshot();
      return {
        snapshot,
        trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
      };
    }, [readComposerSnapshot]);

    const onSelectComposerItem = useCallback(
      (item: ComposerCommandItem) => {
        if (composerSelectLockRef.current) return;
        composerSelectLockRef.current = true;
        setPersonalityMenuOpen(false);
        window.requestAnimationFrame(() => {
          composerSelectLockRef.current = false;
        });
        if (item.type === "slash-command" && item.command === "personality") {
          const resolvedTrigger = resolveActiveComposerTrigger();
          const trigger = resolvedTrigger.trigger ?? composerTrigger;
          setComposerHighlightedItemId(null);
          if (trigger) {
            const snapshot = resolvedTrigger.snapshot;
            applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
              expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
              focusEditorAfterReplace: false,
              nextTrigger: null,
            });
          } else {
            setComposerTrigger(null);
          }
          setPersonalityMenuOpen(true);
          return;
        }
        const resolvedTrigger = resolveActiveComposerTrigger();
        const snapshot = resolvedTrigger.snapshot;
        const trigger = resolvedTrigger.trigger ?? composerTrigger;
        if (!trigger) return;
        if (item.type === "path") {
          const replacement = `@${item.path} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "plugin") {
          const replacement = `${item.plugin.token} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "slash-command") {
          if (item.command === "model") {
            const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
              expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
              focusEditorAfterReplace: false,
            });
            if (applied) {
              setComposerHighlightedItemId(null);
              setIsComposerModelPickerOpen(true);
            }
            return;
          }
          void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "provider-slash-command") {
          const replacement = `/${item.command.name} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "skill") {
          const replacement = `$${item.skill.name} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
      },
      [
        applyPromptReplacement,
        composerTrigger,
        handleInteractionModeChange,
        resolveActiveComposerTrigger,
      ],
    );

    const onComposerMenuItemHighlighted = useCallback(
      (itemId: string | null) => {
        setComposerHighlightedItemId(itemId);
        setComposerHighlightedSearchKey(composerMenuSearchKey);
      },
      [composerMenuSearchKey],
    );

    const nudgeComposerMenuHighlight = useCallback(
      (key: "ArrowDown" | "ArrowUp") => {
        if (composerMenuItems.length === 0) return;
        const highlightedIndex = composerMenuItems.findIndex(
          (item) => item.id === composerHighlightedItemId,
        );
        const normalizedIndex =
          highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
        const offset = key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
        const nextItem = composerMenuItems[nextIndex];
        setComposerHighlightedItemId(nextItem?.id ?? null);
      },
      [composerHighlightedItemId, composerMenuItems],
    );

    const blurMobileComposerAfterSend = useCallback(() => {
      if (!isMobileViewport) return;
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
        composerBlurFrameRef.current = null;
      }
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      setIsComposerFocused(false);
    }, [isMobileViewport]);

    const shouldBlurMobileComposerOnSubmit = useCallback(() => {
      if (!isMobileViewport) return false;
      if (isSendBusy || isUsageLimitReached || isConnecting || phase === "running") return false;
      if (activePendingProgress) {
        return activePendingProgress.isLastQuestion && Boolean(activePendingResolvedAnswers);
      }
      return showPlanFollowUpPrompt || composerSendState.hasSendableContent;
    }, [
      activePendingProgress,
      activePendingResolvedAnswers,
      composerSendState.hasSendableContent,
      isConnecting,
      isUsageLimitReached,
      isMobileViewport,
      isSendBusy,
      phase,
      showPlanFollowUpPrompt,
    ]);

    const submitComposer = useCallback(
      (event?: { preventDefault: () => void }) => {
        const isStandardSend =
          pendingPrimaryAction === null &&
          !isComposerApprovalState &&
          activePendingProgress === null;
        const hasSubmissionContent =
          composerSendState.hasSendableContent ||
          showPlanFollowUpPrompt ||
          prompt.trim().length > 0;
        if (isStandardSend && hasSubmissionContent && !composerProviderAvailability.canSend) {
          event?.preventDefault();
          setThreadError(
            activeThreadId,
            composerProviderAvailability.sendBlockMessage ?? "当前模型服务不可用，请稍后重试。",
          );
          if (backendConnectionState === "connected") {
            void refreshSelectedModelService().catch(() => undefined);
          } else {
            void getPrimaryEnvironmentConnection()
              .reconnect()
              .catch(() => undefined);
          }
          return;
        }
        if (isStandardSend && hasSubmissionContent) {
          const healthBlock = resolvePromptComposerPluginMentionHealthBlock(
            prompt,
            visiblePluginMentions,
          );
          if (healthBlock) {
            event?.preventDefault();
            toastManager.add({
              type: "warning",
              title: healthBlock.title,
              description: healthBlock.description,
            });
            void navigate({ to: "/extensions", hash: "plugins" });
            return;
          }
        }
        onSend(event);
        if (shouldBlurMobileComposerOnSubmit()) {
          blurMobileComposerAfterSend();
        }
      },
      [
        activePendingProgress,
        activeThreadId,
        blurMobileComposerAfterSend,
        backendConnectionState,
        composerProviderAvailability,
        composerSendState.hasSendableContent,
        isComposerApprovalState,
        navigate,
        onSend,
        pendingPrimaryAction,
        prompt,
        refreshSelectedModelService,
        setThreadError,
        shouldBlurMobileComposerOnSubmit,
        showPlanFollowUpPrompt,
        visiblePluginMentions,
      ],
    );
    const expandMobileComposer = useCallback(() => {
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
        composerBlurFrameRef.current = null;
      }
      if (mobileComposerExpandFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
      }
      if (mobileComposerExpandReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
      }
      mobileComposerExpandInFlightRef.current = true;
      setIsComposerFocused(true);
      mobileComposerExpandFrameRef.current = window.requestAnimationFrame(() => {
        mobileComposerExpandFrameRef.current = null;
        composerEditorRef.current?.focusAtEnd();
        mobileComposerExpandReleaseFrameRef.current = window.requestAnimationFrame(() => {
          mobileComposerExpandReleaseFrameRef.current = null;
          mobileComposerExpandInFlightRef.current = false;
        });
      });
    }, []);

    // ------------------------------------------------------------------
    // Callbacks: command key
    // ------------------------------------------------------------------
    const onComposerCommandKey = (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
      event: KeyboardEvent,
    ) => {
      if (key === "Tab" && event.shiftKey) {
        toggleInteractionMode();
        return true;
      }
      const { trigger } = resolveActiveComposerTrigger();
      const menuIsActive = composerMenuOpenRef.current || trigger !== null;
      if (menuIsActive) {
        const currentItems = composerMenuItemsRef.current;
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (key === "ArrowDown" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowDown");
          return true;
        }
        if (key === "ArrowUp" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowUp");
          return true;
        }
        if ((key === "Enter" || key === "Tab") && selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
      if (key === "Enter" && !event.shiftKey) {
        submitComposer();
        return true;
      }
      return false;
    };

    const openAttachmentPicker = useCallback(() => {
      composerAttachmentInputRef.current?.click();
    }, []);

    const openAllSkills = useCallback(() => {
      void navigate({ to: "/extensions", hash: "all" });
    }, [navigate]);

    const openInstalledSkills = useCallback(() => {
      void navigate({ to: "/extensions", hash: "installed" });
    }, [navigate]);

    const insertSkillAtComposerCursor = useCallback(
      (skill: ServerProviderSkill) => {
        if (isComposerApprovalState || activePendingProgress) {
          return;
        }
        const snapshot = readComposerSnapshot();
        const needsLeadingSpacer = snapshot.value.length > 0 && !/\s$/.test(snapshot.value);
        const replacement = `${needsLeadingSpacer ? " " : ""}$${skill.name} `;
        const applied = applyPromptReplacement(snapshot.cursor, snapshot.cursor, replacement);
        if (!applied) {
          return;
        }
        const nextCursor = snapshot.cursor + replacement.length;
        window.requestAnimationFrame(() => {
          const nextPrompt = promptRef.current;
          setComposerTrigger(
            detectComposerTrigger(
              nextPrompt,
              expandCollapsedComposerCursor(nextPrompt, nextCursor),
            ),
          );
          composerEditorRef.current?.focusAt(nextCursor);
        });
      },
      [
        activePendingProgress,
        applyPromptReplacement,
        isComposerApprovalState,
        promptRef,
        readComposerSnapshot,
      ],
    );

    const insertPluginAtComposerCursor = useCallback(
      (plugin: ComposerPluginMention) => {
        if (isComposerApprovalState || activePendingProgress) {
          return;
        }
        const healthBlock = resolveComposerPluginMentionHealthBlock(plugin);
        if (healthBlock) {
          toastManager.add({
            type: "warning",
            title: healthBlock.title,
            description: healthBlock.description,
          });
          void navigate({ to: "/extensions", hash: "plugins" });
          return;
        }
        if (plugin.id === "Chrome" && !browserExternalPlugin.connected) {
          toastManager.add({
            type: "warning",
            title: browserExternalPlugin.installed
              ? "请先完成 Chrome 扩展配对"
              : "请先安装 Browser Use External",
            description: browserExternalPlugin.installed
              ? "在插件页安装 Chrome 扩展，并将 Endpoint 与 Token 填入扩展弹窗。"
              : "安装插件后，插件页会引导你安装 Chrome 扩展并完成 Endpoint/Token 配对。",
          });
          void navigate({ to: "/extensions", hash: "plugins" });
          return;
        }
        const snapshot = readComposerSnapshot();
        const needsLeadingSpacer = snapshot.value.length > 0 && !/\s$/.test(snapshot.value);
        const replacement = `${needsLeadingSpacer ? " " : ""}${plugin.token} `;
        const applied = applyPromptReplacement(snapshot.cursor, snapshot.cursor, replacement);
        if (!applied) {
          return;
        }
        const nextCursor = snapshot.cursor + replacement.length;
        window.requestAnimationFrame(() => {
          const nextPrompt = promptRef.current;
          setComposerTrigger(
            detectComposerTrigger(
              nextPrompt,
              expandCollapsedComposerCursor(nextPrompt, nextCursor),
            ),
          );
          composerEditorRef.current?.focusAt(nextCursor);
        });
      },
      [
        activePendingProgress,
        applyPromptReplacement,
        browserExternalPlugin.connected,
        browserExternalPlugin.installed,
        isComposerApprovalState,
        navigate,
        promptRef,
        readComposerSnapshot,
      ],
    );

    // ------------------------------------------------------------------
    // Callbacks: attachments
    // ------------------------------------------------------------------
    const addComposerAttachments = (files: File[]) => {
      if (!activeThreadId || files.length === 0) return;
      if (pendingUserInputs.length > 0) {
        toastManager.add({
          type: "error",
          title: "Attach files after answering plan questions.",
        });
        return;
      }
      const guessMimeType = (fileName: string): string => {
        const ext = fileName.split(".").pop()?.toLowerCase();
        if (!ext) return "application/octet-stream";

        const imageExtensions: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          bmp: "image/bmp",
          svg: "image/svg+xml",
        };

        const textExtensions: Record<string, string> = {
          txt: "text/plain",
          php: "text/x-php",
          py: "text/x-python",
          js: "text/javascript",
          jsx: "text/javascript",
          ts: "text/typescript",
          tsx: "text/typescript",
          java: "text/x-java-source",
          cpp: "text/x-c",
          c: "text/x-c",
          h: "text/x-c",
          go: "text/x-go",
          html: "text/html",
          htm: "text/html",
          css: "text/css",
          json: "application/json",
          xml: "application/xml",
          md: "text/markdown",
          markdown: "text/markdown",
          yaml: "text/yaml",
          yml: "text/yaml",
          sh: "text/plain",
          bash: "text/plain",
          rs: "text/plain",
          sql: "text/plain",
        };

        if (ext in imageExtensions) return imageExtensions[ext]!;
        if (ext in textExtensions) return textExtensions[ext]!;
        return "application/octet-stream";
      };

      const nextAttachments: ComposerImageAttachment[] = [];
      let nextAttachmentCount = composerImagesRef.current.length;
      let error: string | null = null;
      for (const file of files) {
        if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          error = `'${file.name}' exceeds the ${ATTACHMENT_SIZE_LIMIT_LABEL} attachment limit.`;
          continue;
        }
        if (nextAttachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
          error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
          break;
        }
        const guessedMime = file.type || guessMimeType(file.name);
        const isImage = guessedMime.startsWith("image/");
        nextAttachments.push({
          type: isImage ? "image" : "file",
          id: randomUUID(),
          name: file.name || (isImage ? "image" : "file"),
          mimeType: guessedMime,
          sizeBytes: file.size,
          ...(isImage ? { previewUrl: URL.createObjectURL(file) } : {}),
          file,
        });
        nextAttachmentCount += 1;
      }
      if (nextAttachments.length === 1 && nextAttachments[0]) {
        addComposerImage(nextAttachments[0]);
      } else if (nextAttachments.length > 1) {
        addComposerImagesToDraft(nextAttachments);
      }
      setThreadError(activeThreadId, error);
    };

    const handleAttachmentInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length === 0) return;
      addComposerAttachments(files);
    };

    const removeComposerImage = (imageId: string) => {
      removeComposerImageFromDraft(imageId);
    };

    const openComposerAttachmentFolder = useCallback(
      async (attachment: ComposerImageAttachment) => {
        const filePath =
          typeof window !== "undefined"
            ? window.desktopBridge?.getPathForFile?.(attachment.file)
            : null;
        if (!filePath) {
          toastManager.add({
            type: "error",
            title: "无法打开文件夹",
            description: "未能定位该附件的原始本地文件路径。",
          });
          return;
        }

        const api = readLocalApi();
        if (!api) {
          toastManager.add({
            type: "error",
            title: "无法打开文件夹",
            description: "本地桌面能力不可用。",
          });
          return;
        }

        try {
          await revealFileInFolder(api, filePath);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "无法打开文件夹",
            description: error instanceof Error ? error.message : "打开文件夹失败。",
          });
        }
      },
      [],
    );

    // ------------------------------------------------------------------
    // Callbacks: paste / drag
    // ------------------------------------------------------------------
    const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length === 0) return;
      event.preventDefault();
      addComposerAttachments(files);
    };

    const onComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragOverComposer(true);
    };

    const onComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDragOverComposer(true);
    };

    const onComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragOverComposer(false);
      }
    };

    const onComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOverComposer(false);
      const files = Array.from(event.dataTransfer.files);
      addComposerAttachments(files);
      focusComposer();
    };
    const handleInterruptPrimaryAction = useCallback(() => {
      void onInterrupt();
    }, [onInterrupt]);
    const handleImplementPlanInNewThreadPrimaryAction = useCallback(() => {
      void onImplementPlanInNewThread();
    }, [onImplementPlanInNewThread]);
    const scheduleComposerCollapseCheck = useCallback(() => {
      if (!isMobileViewport) {
        return;
      }
      if (mobileComposerExpandInFlightRef.current) {
        return;
      }
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
      }
      composerBlurFrameRef.current = window.requestAnimationFrame(() => {
        composerBlurFrameRef.current = null;
        if (mobileComposerExpandInFlightRef.current) {
          return;
        }
        const composerSurface = composerSurfaceRef.current;
        const activeElement = document.activeElement;
        if (activeElement instanceof Element && isInsideComposerFloatingLayer(activeElement)) {
          return;
        }
        if (
          composerSurface &&
          activeElement instanceof Node &&
          composerSurface.contains(activeElement)
        ) {
          return;
        }
        setIsComposerFocused(false);
      });
    }, [isMobileViewport]);

    useEffect(() => {
      return () => {
        if (composerBlurFrameRef.current !== null) {
          window.cancelAnimationFrame(composerBlurFrameRef.current);
        }
        if (mobileComposerExpandFrameRef.current !== null) {
          window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
        }
        if (mobileComposerExpandReleaseFrameRef.current !== null) {
          window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
        }
      };
    }, []);

    // ------------------------------------------------------------------
    // Imperative handle
    // ------------------------------------------------------------------
    useImperativeHandle(
      ref,
      () => ({
        focusAtEnd: () => {
          composerEditorRef.current?.focusAtEnd();
        },
        focusAt: (cursor: number) => {
          composerEditorRef.current?.focusAt(cursor);
        },
        openModelPicker: () => {
          setIsComposerModelPickerOpen(true);
        },
        toggleModelPicker: () => {
          setIsComposerModelPickerOpen((open) => !open);
        },
        isModelPickerOpen: () => isComposerModelPickerOpen,
        readSnapshot: () => {
          return readComposerSnapshot();
        },
        resetCursorState: (options?: {
          cursor?: number;
          prompt?: string;
          detectTrigger?: boolean;
        }) => {
          const promptForState = options?.prompt ?? promptRef.current;
          const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
          setComposerHighlightedItemId(null);
          setComposerCursor(cursor);
          setComposerTrigger(
            options?.detectTrigger
              ? detectComposerTrigger(
                  promptForState,
                  expandCollapsedComposerCursor(promptForState, cursor),
                )
              : null,
          );
        },
        addTerminalContext: (selection: TerminalContextSelection) => {
          if (!activeThread) return;
          const snapshot = composerEditorRef.current?.readSnapshot() ?? {
            value: promptRef.current,
            cursor: composerCursor,
            expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
            terminalContextIds: composerTerminalContexts.map((context) => context.id),
          };
          const insertion = insertInlineTerminalContextPlaceholder(
            snapshot.value,
            snapshot.expandedCursor,
          );
          const nextCollapsedCursor = collapseExpandedComposerCursor(
            insertion.prompt,
            insertion.cursor,
          );
          const inserted = insertComposerDraftTerminalContext(
            composerDraftTarget,
            insertion.prompt,
            {
              id: randomUUID(),
              threadId: activeThread.id,
              createdAt: new Date().toISOString(),
              ...selection,
            },
            insertion.contextIndex,
          );
          if (!inserted) return;
          promptRef.current = insertion.prompt;
          setComposerCursor(nextCollapsedCursor);
          setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCollapsedCursor);
          });
        },
        getSendContext: () => ({
          prompt: promptRef.current,
          images: composerImagesRef.current,
          terminalContexts: composerTerminalContextsRef.current,
          selectedPromptEffort,
          selectedModelOptionsForDispatch,
          selectedModelSelection,
          selectedProvider,
          selectedModel,
          selectedProviderModels,
        }),
      }),
      [
        activeThread,
        composerDraftTarget,
        composerCursor,
        composerTerminalContexts,
        insertComposerDraftTerminalContext,
        promptRef,
        composerImagesRef,
        composerTerminalContextsRef,
        isComposerModelPickerOpen,
        readComposerSnapshot,
        selectedModel,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        selectedPromptEffort,
        selectedProvider,
        selectedProviderModels,
      ],
    );

    // Render
    // ------------------------------------------------------------------
    const composerModelPicker = (
      <ProviderModelPicker
        compact={isComposerFooterCompact}
        simplified
        activeInstanceId={selectedInstanceId}
        model={selectedModelForPickerWithCustomFallback}
        lockedProvider={lockedProvider}
        lockedContinuationGroupKey={lockedContinuationGroupKey}
        instanceEntries={providerInstanceEntries}
        keybindings={keybindings}
        modelOptionsByInstance={modelOptionsByInstance}
        modelCapabilities={selectedModelCapabilities}
        modelOptionSelections={selectedModelOptionSelections ?? null}
        availabilityTriggerLabel={composerProviderAvailability.triggerLabel}
        emptyMessage={composerProviderAvailability.menuEmptyMessage}
        terminalOpen={terminalOpen}
        open={isComposerModelPickerOpen}
        {...(composerProviderState.modelPickerIconClassName
          ? {
              activeProviderIconClassName: composerProviderState.modelPickerIconClassName,
            }
          : {})}
        triggerClassName={cn(
          "h-7 rounded-md px-1.5 text-[12px] font-normal text-foreground/80 hover:text-foreground",
        )}
        onOpenChange={(open) => {
          setIsComposerModelPickerOpen(open);
          if (open) {
            if (backendConnectionState === "connected") {
              void refreshSelectedModelService().catch(() => undefined);
            } else {
              void getPrimaryEnvironmentConnection()
                .reconnect()
                .catch(() => undefined);
            }
          }
        }}
        onInstanceModelChange={onProviderModelSelect}
        onModelOptionsChange={handleModelOptionsChange}
      />
    );
    const normalizedGoalEditDraft = normalizeGoalObjective(goalEditDraft);
    const canSaveGoalEdit =
      goal !== null &&
      isValidGoalObjective(normalizedGoalEditDraft) &&
      normalizedGoalEditDraft !== goal.objective;

    return (
      <>
        <Dialog open={goalEditOpen} onOpenChange={setGoalEditOpen}>
          <DialogPopup className="max-w-lg rounded-xl" showCloseButton>
            <DialogHeader>
              <DialogTitle>编辑目标</DialogTitle>
              <DialogDescription>保存后通过 Codex goal 协议更新当前目标。</DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3" scrollFade={false}>
              <Textarea
                value={goalEditDraft}
                onChange={(event) => setGoalEditDraft(event.target.value)}
                rows={5}
                autoFocus
                placeholder="输入新的目标"
                className="min-h-32 resize-y"
              />
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGoalEditOpen(false)}>
                取消
              </Button>
              <Button type="button" disabled={!canSaveGoalEdit} onClick={saveGoalEdit}>
                保存
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
        <AlertDialog open={goalClearConfirmOpen} onOpenChange={setGoalClearConfirmOpen}>
          <AlertDialogPopup>
            <AlertDialogTitle>清除当前目标？</AlertDialogTitle>
            <AlertDialogDescription>
              清除后会停止当前目标模式，并中断正在进行的目标任务。
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button type="button" variant="outline" />}>
                取消
              </AlertDialogClose>
              <Button type="button" variant="destructive" onClick={confirmClearGoal}>
                清除目标
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
        <form
          ref={composerFormRef}
          onSubmit={submitComposer}
          className={cn("mx-auto w-full min-w-0", newThreadMode ? "max-w-none" : "max-w-[43.5rem]")}
          data-chat-composer-form="true"
          data-chat-composer-new-thread={newThreadMode ? "true" : "false"}
        >
          <input
            ref={composerAttachmentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleAttachmentInputChange}
          />
          {goal ? (
            <ComposerGoalProgressPanel
              goal={goal}
              expanded={goalPanelExpanded}
              onEdit={editGoalFromPanel}
              onTogglePaused={toggleGoalPaused}
              onClear={clearGoalFromPanel}
              onToggleExpanded={() => setGoalPanelExpanded((value) => !value)}
            />
          ) : null}
          <div
            className={cn(
              "group transition-colors duration-200",
              newThreadMode ? "rounded-[18px]" : "rounded-[15px] p-px",
              !newThreadMode && composerProviderState.composerFrameClassName,
            )}
            onDragEnter={onComposerDragEnter}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            onDrop={onComposerDrop}
          >
            <div
              ref={composerSurfaceRef}
              data-chat-composer-mobile-collapsed={isComposerCollapsedMobile ? "true" : "false"}
              data-chat-composer-surface-root="true"
              data-chat-composer-surface={newThreadMode ? "new-thread" : "reply"}
              data-chat-composer-drag-over={isDragOverComposer ? "true" : "false"}
              className={cn(
                "relative border bg-card/98 transition-[border-color,box-shadow,background-color] duration-200 has-focus-visible:border-ring/65",
                (composerMenuOpen || showPersonalityMenu) && !isComposerApprovalState
                  ? "overflow-visible"
                  : "overflow-hidden",
                newThreadMode
                  ? "rounded-[18px] border-[#dcdfe4] bg-background shadow-[0_1px_2px_rgba(15,23,42,0.045),0_14px_36px_-32px_rgba(15,23,42,0.55)] has-focus-visible:border-[#c8ccd2] dark:border-border/70 dark:bg-card/98 dark:shadow-[0_10px_28px_-24px_rgba(0,0,0,0.7)]"
                  : "rounded-[14px] shadow-[var(--t3-shadow-composer)] has-focus-visible:shadow-[var(--claude-shadow-panel)]",
                isDragOverComposer
                  ? newThreadMode
                    ? "border-dashed border-foreground/30 bg-card ring-[12px] ring-muted"
                    : "border-foreground/25 bg-accent/20"
                  : newThreadMode
                    ? "border-[#dcdfe4] dark:border-border/70"
                    : "border-border/80",
                environmentUnavailable ? "opacity-75" : null,
                !newThreadMode && composerProviderState.composerSurfaceClassName,
              )}
              onFocusCapture={(event) => {
                const activeElement = event.target;
                if (
                  isComposerCollapsedMobile &&
                  activeElement instanceof HTMLElement &&
                  activeElement.closest('[data-chat-composer-collapsed-controls="true"]')
                ) {
                  return;
                }
                if (composerBlurFrameRef.current !== null) {
                  window.cancelAnimationFrame(composerBlurFrameRef.current);
                  composerBlurFrameRef.current = null;
                }
                setIsComposerFocused(true);
              }}
              onBlurCapture={() => {
                scheduleComposerCollapseCheck();
              }}
            >
              {newThreadMode && isDragOverComposer ? (
                <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[20px] bg-card/85 backdrop-blur-[2px]">
                  <div className="flex flex-col items-center gap-1.5 text-foreground/72">
                    <FileIcon className="h-5 w-5 stroke-[2.4px]" />
                    <span className="text-[13px] font-medium">将文件拖到这里</span>
                  </div>
                </div>
              ) : null}
              {!isComposerCollapsedMobile &&
                (activePendingApproval ? (
                  <div className="rounded-t-[14px] bg-muted/15">
                    <ComposerPendingApprovalPanel
                      approval={activePendingApproval}
                      pendingCount={pendingApprovals.length}
                      isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                      onRespondToApproval={onRespondToApproval}
                    />
                  </div>
                ) : pendingUserInputs.length > 0 ? (
                  <div className="rounded-t-[14px] bg-muted/15">
                    <ComposerPendingUserInputPanel
                      pendingUserInputs={pendingUserInputs}
                      respondingRequestIds={respondingRequestIds}
                      answers={activePendingDraftAnswers}
                      questionIndex={activePendingQuestionIndex}
                      onToggleOption={onSelectActivePendingUserInputOption}
                      onAdvance={onAdvanceActivePendingUserInput}
                      onPreviousQuestion={onPreviousActivePendingUserInputQuestion}
                      onSelectQuestion={onSelectActivePendingUserInputQuestion}
                      onIgnore={onIgnoreActivePendingUserInput}
                    />
                  </div>
                ) : pendingSteerDraft ? (
                  <div className="overflow-hidden rounded-t-[14px] bg-muted/15">
                    <ComposerPendingSteerDraftPanel
                      draft={pendingSteerDraft}
                      confirmDisabled={
                        phase !== "running" ||
                        isSendBusy ||
                        isConnecting ||
                        environmentUnavailable !== null
                      }
                      onConfirm={onConfirmPendingSteerDraft}
                      onEdit={onEditPendingSteerDraft}
                      onDiscard={onDiscardPendingSteerDraft}
                    />
                  </div>
                ) : showPlanFollowUpPrompt && activeProposedPlan ? (
                  <div className="rounded-t-[14px] bg-muted/15">
                    <ComposerPlanFollowUpBanner
                      key={activeProposedPlan.id}
                      planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                    />
                  </div>
                ) : null)}

              {isComposerCollapsedMobile && activePendingApproval ? (
                <div
                  className="rounded-t-[18px] bg-muted/15"
                  data-chat-composer-collapsed-controls="true"
                >
                  <ComposerPendingApprovalPanel
                    approval={activePendingApproval}
                    pendingCount={pendingApprovals.length}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    onRespondToApproval={onRespondToApproval}
                  />
                </div>
              ) : isComposerCollapsedMobile && pendingUserInputs.length > 0 ? (
                <div
                  className="rounded-t-[18px] bg-muted/15"
                  data-chat-composer-collapsed-controls="true"
                >
                  <ComposerPendingUserInputPanel
                    pendingUserInputs={pendingUserInputs}
                    respondingRequestIds={respondingRequestIds}
                    answers={activePendingDraftAnswers}
                    questionIndex={activePendingQuestionIndex}
                    onToggleOption={onSelectActivePendingUserInputOption}
                    onAdvance={onAdvanceActivePendingUserInput}
                    onPreviousQuestion={onPreviousActivePendingUserInputQuestion}
                    onSelectQuestion={onSelectActivePendingUserInputQuestion}
                    onIgnore={onIgnoreActivePendingUserInput}
                  />
                  <div className="px-3 pb-3 sm:px-4">
                    <div
                      data-chat-composer-mobile-pending-compact="true"
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-lg bg-background/55 p-1.5 pl-3 transition-colors hover:bg-background/80",
                        !activePendingProgress?.activeQuestion?.multiSelect && "p-0",
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 truncate bg-transparent py-1.5 text-left text-sm",
                          activePendingProgress?.customAnswer
                            ? "text-foreground"
                            : "text-muted-foreground/60",
                          !activePendingProgress?.activeQuestion?.multiSelect && "px-3 py-2",
                        )}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={expandMobileComposer}
                        aria-label="Write custom answer"
                      >
                        {activePendingProgress?.customAnswer || "Write custom answer"}
                      </button>
                      {activePendingProgress?.activeQuestion?.multiSelect ? (
                        <ComposerPrimaryActions
                          compact
                          pendingAction={pendingPrimaryAction}
                          isRunning={false}
                          canSteerRunningTurn={false}
                          showPlanFollowUpPrompt={false}
                          promptHasText={false}
                          isSendBusy={isSendBusy}
                          isInterruptPending={isInterruptPending}
                          isConnecting={isConnecting}
                          isEnvironmentUnavailable={environmentUnavailable !== null}
                          isPreparingWorktree={false}
                          isProviderUnavailable={isProviderUnavailable}
                          hasSendableContent={false}
                          preserveComposerFocusOnPointerDown
                          onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                          onInterrupt={handleInterruptPrimaryAction}
                          onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : isComposerCollapsedMobile && pendingSteerDraft ? (
                <div
                  className="overflow-hidden rounded-t-[18px] bg-muted/15"
                  data-chat-composer-collapsed-controls="true"
                >
                  <ComposerPendingSteerDraftPanel
                    draft={pendingSteerDraft}
                    confirmDisabled={
                      phase !== "running" ||
                      isSendBusy ||
                      isConnecting ||
                      environmentUnavailable !== null
                    }
                    onConfirm={onConfirmPendingSteerDraft}
                    onEdit={onEditPendingSteerDraft}
                    onDiscard={onDiscardPendingSteerDraft}
                  />
                </div>
              ) : null}

              {showCollapsedMobilePromptRow ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    className={cn(
                      "min-w-0 flex-1 truncate bg-transparent p-0 text-left text-[14px] focus:outline-none",
                      (activePendingProgress ? activePendingProgress.customAnswer : prompt.trim())
                        ? "text-foreground"
                        : "text-muted-foreground/35",
                    )}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={expandMobileComposer}
                    aria-label="Expand composer"
                  >
                    {activePendingProgress
                      ? activePendingProgress.customAnswer ||
                        "Type your own answer, or leave this blank to use the selected option"
                      : prompt.trim() ||
                        (newThreadMode
                          ? (newThreadPlaceholder ?? "随心输入")
                          : t("composer.placeholder.reply"))}
                  </button>
                  <button
                    type="button"
                    className={composerPrimaryButtonClassName({ newThreadMode })}
                    disabled={collapsedComposerPrimaryActionDisabled}
                    aria-label={collapsedComposerPrimaryActionLabel}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (runningPrimaryActionMode === "interrupt") {
                        handleInterruptPrimaryAction();
                        return;
                      }
                      submitComposer();
                    }}
                  >
                    {runningPrimaryActionMode === "interrupt" ? (
                      <ComposerStopSquareIcon />
                    ) : isConnecting || isSendBusy ? (
                      <ComposerSpinnerIcon />
                    ) : (
                      <ComposerSendArrowIcon />
                    )}
                  </button>
                </div>
              ) : null}

              {composerMenuOpen && !isComposerApprovalState && (
                <div
                  className={cn(
                    "absolute inset-x-0 z-20 px-1",
                    newThreadMode ? "top-0 -translate-y-[calc(100%+0.5rem)]" : "bottom-full mb-2",
                  )}
                >
                  <ComposerCommandMenu
                    items={composerMenuItems}
                    resolvedTheme={resolvedTheme}
                    isLoading={isComposerMenuLoading}
                    triggerKind={composerTriggerKind}
                    groupSlashCommandSections={
                      composerTrigger?.kind === "slash-command" &&
                      composerTrigger.query.trim().length === 0
                    }
                    emptyStateText={composerMenuEmptyState}
                    activeItemId={activeComposerMenuItem?.id ?? null}
                    onHighlightedItemChange={onComposerMenuItemHighlighted}
                    onSelect={onSelectComposerItem}
                  />
                </div>
              )}

              {showPersonalityMenu && !isComposerApprovalState ? (
                <div
                  className={cn(
                    "absolute inset-x-0 z-20 px-1",
                    newThreadMode ? "top-0 -translate-y-[calc(100%+0.5rem)]" : "bottom-full mb-2",
                  )}
                >
                  <div
                    ref={personalityMenuRef}
                    className="mx-auto grid w-full max-w-[22rem] gap-1 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
                  >
                    {PERSONALITY_SLASH_OPTIONS.map((option) => {
                      const isActive =
                        (settings.defaultProviderPersonality ?? DEFAULT_PROVIDER_PERSONALITY) ===
                        option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={cn(
                            "flex min-h-11 items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                            isActive
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/70 hover:text-accent-foreground",
                          )}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateSettings({ defaultProviderPersonality: option.value });
                            setPersonalityMenuOpen(false);
                            scheduleComposerFocus();
                          }}
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <span className="font-medium">{t(option.labelKey)}</span>
                            <span className="text-xs text-muted-foreground">
                              {t(option.descriptionKey)}
                            </span>
                          </span>
                          {isActive ? <CheckIcon className="size-4 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div
                className={cn(
                  "relative",
                  newThreadMode
                    ? "min-h-[96px] max-h-[360px] overflow-y-auto px-4 pb-11 pt-3.5"
                    : "px-4 pb-1.5 sm:px-4",
                  !newThreadMode && (hasComposerHeader ? "pt-3" : "pt-3.5"),
                  isComposerCollapsedMobile && "hidden",
                  isComposerApprovalState && "hidden",
                  newThreadMode && isDragOverComposer && "opacity-20 blur-[1px]",
                )}
              >
                {!isComposerCollapsedMobile &&
                  !isComposerApprovalState &&
                  pendingUserInputs.length === 0 &&
                  composerImages.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {composerImages.map((image) => (
                        <div
                          key={image.id}
                          className={cn(
                            "relative border border-border/80 bg-background",
                            image.type === "file"
                              ? "h-14 w-[14rem] max-w-full overflow-visible rounded-lg"
                              : "h-16 w-16 overflow-hidden rounded-lg",
                          )}
                        >
                          {image.type === "image" && image.previewUrl ? (
                            <button
                              type="button"
                              className="h-full w-full cursor-zoom-in"
                              aria-label={`Preview ${image.name}`}
                              onClick={() => {
                                const preview = buildExpandedImagePreview(composerImages, image.id);
                                if (!preview) return;
                                onExpandImage(preview);
                              }}
                            >
                              <img
                                src={image.previewUrl}
                                alt={image.name}
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ) : image.type === "file" ? (
                            <button
                              type="button"
                              className="flex h-full w-full items-center gap-2 px-2 pr-3 text-left"
                              title="打开文件所在文件夹"
                              aria-label={`打开 ${image.name} 所在文件夹`}
                              onClick={() => void openComposerAttachmentFolder(image)}
                            >
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/85">
                                <FileTextIcon className="size-4.5" />
                              </span>
                              <span className="grid min-w-0 flex-1 gap-1 text-left">
                                <span className="truncate text-[13px] font-semibold leading-4 text-foreground">
                                  {image.name}
                                </span>
                                <span className="text-[11px] font-medium uppercase leading-3 text-muted-foreground/70">
                                  {formatComposerAttachmentTypeLabel(image.name, image.mimeType)}
                                </span>
                              </span>
                            </button>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground/70">
                              {image.name}
                            </div>
                          )}
                          {nonPersistedComposerImageIdSet.has(image.id) && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span
                                    role="img"
                                    aria-label="Draft attachment may not persist"
                                    className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                                  >
                                    <CircleAlertIcon className="size-3" />
                                  </span>
                                }
                              />
                              <TooltipPopup
                                side="top"
                                className="max-w-64 whitespace-normal leading-tight"
                              >
                                Draft attachment could not be saved locally and may be lost on
                                navigation.
                              </TooltipPopup>
                            </Tooltip>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className={cn(
                              "absolute",
                              image.type === "file"
                                ? "-right-1.5 -top-1.5 size-4 rounded-full bg-foreground p-0 text-background shadow-sm hover:bg-foreground/85 hover:text-background"
                                : "right-1 top-1 bg-background/80 hover:bg-background/90",
                            )}
                            onClick={() => removeComposerImage(image.id)}
                            aria-label={`Remove ${image.name}`}
                          >
                            <XIcon className={image.type === "file" ? "size-3" : undefined} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                <div className="relative">
                  <ComposerPromptEditor
                    editorRef={composerEditorRef}
                    value={
                      isComposerApprovalState
                        ? ""
                        : activePendingProgress
                          ? activePendingProgress.customAnswer
                          : prompt
                    }
                    cursor={composerCursor}
                    terminalContexts={
                      !isComposerApprovalState && pendingUserInputs.length === 0
                        ? composerTerminalContexts
                        : []
                    }
                    skills={selectedProviderStatus?.skills ?? []}
                    className={cn(
                      newThreadMode && "min-h-[42px] max-h-[280px]",
                      showMobilePendingAnswerActions && "max-sm:pb-11",
                    )}
                    {...(newThreadMode
                      ? {
                          placeholderClassName: "text-muted-foreground/42",
                        }
                      : {})}
                    onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                    onChange={onPromptChange}
                    onCommandKeyDown={onComposerCommandKey}
                    onPaste={onComposerPaste}
                    placeholder={
                      isComposerApprovalState
                        ? (activePendingApproval?.detail ??
                          "Resolve this approval request to continue")
                        : activePendingProgress
                          ? "Type your own answer, or leave this blank to use the selected option"
                          : showPlanFollowUpPrompt && activeProposedPlan
                            ? t("composer.plan.feedbackPlaceholder")
                            : environmentUnavailable
                              ? `${environmentUnavailable.label} is ${
                                  environmentUnavailable.connectionState === "connecting"
                                    ? "connecting"
                                    : "disconnected"
                                }`
                              : newThreadMode
                                ? (newThreadPlaceholder ?? "随心输入")
                                : phase === "disconnected"
                                  ? t("composer.placeholder.disconnectedReply")
                                  : t("composer.placeholder.reply")
                    }
                    disabled={
                      isConnecting ||
                      isComposerApprovalState ||
                      (environmentUnavailable !== null && activePendingProgress === null)
                    }
                  />
                  {showMobilePendingAnswerActions ? (
                    <div
                      data-chat-composer-mobile-pending-actions="true"
                      className="absolute bottom-0 right-0 flex justify-end"
                    >
                      <ComposerPrimaryActions
                        compact
                        pendingAction={pendingPrimaryAction}
                        isRunning={false}
                        canSteerRunningTurn={false}
                        showPlanFollowUpPrompt={false}
                        promptHasText={false}
                        isSendBusy={isSendBusy}
                        isInterruptPending={isInterruptPending}
                        isUsageLimitReached={isUsageLimitReached}
                        isConnecting={isConnecting}
                        isEnvironmentUnavailable={environmentUnavailable !== null}
                        isPreparingWorktree={false}
                        hasSendableContent={false}
                        preserveComposerFocusOnPointerDown
                        onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                        onInterrupt={handleInterruptPrimaryAction}
                        onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Bottom toolbar */}
              {isComposerCollapsedMobile || activePendingApproval ? null : (
                <ComposerFooterToolbar
                  composerSurface={composerSurface}
                  activeContextWindow={activeContextWindow}
                  compactFooter={isComposerFooterCompact}
                  compactPrimaryActions={isComposerPrimaryActionsCompact}
                  disabled={
                    isConnecting ||
                    isComposerApprovalState ||
                    (environmentUnavailable !== null && activePendingProgress === null)
                  }
                  goalModeEnabled={goalModeEnabled}
                  interactionMode={interactionMode}
                  isConnecting={isConnecting}
                  isEnvironmentUnavailable={environmentUnavailable !== null}
                  isProviderUnavailable={isProviderUnavailable}
                  isPreparingWorktree={isPreparingWorktree}
                  isSendBusy={isSendBusy}
                  isInterruptPending={isInterruptPending}
                  isUsageLimitReached={isUsageLimitReached}
                  hasSendableContent={composerSendState.hasSendableContent}
                  modelPicker={composerModelPicker}
                  newThreadModeLabel={newThreadModeLabel}
                  onAttachFiles={openAttachmentPicker}
                  onAddSkill={openAllSkills}
                  onClearGoal={clearGoalFromPanel}
                  {...(onClearNewThreadMode ? { onClearNewThreadMode } : {})}
                  onGoalModeChange={onGoalModeChange}
                  onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                  onInteractionModeChange={handleInteractionModeChange}
                  onInterrupt={handleInterruptPrimaryAction}
                  onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                  onRuntimeModeChange={handleRuntimeModeChange}
                  onSelectPlugin={insertPluginAtComposerCursor}
                  onSelectSkill={insertSkillAtComposerCursor}
                  onManageSkills={openInstalledSkills}
                  onTogglePlanSidebar={togglePlanSidebar}
                  pendingAction={pendingPrimaryAction}
                  phase={phase}
                  planSidebarLabel={planSidebarLabel}
                  planSidebarOpen={planSidebarOpen}
                  pluginMentions={visiblePluginMentions}
                  preserveComposerFocusOnPointerDown={isMobileViewport}
                  promptHasText={!promptIsEmpty}
                  runtimeMode={runtimeMode}
                  showContextWindow={showContextWindow}
                  showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}
                  showMobilePendingAnswerActions={showMobilePendingAnswerActions}
                  showPlanFollowUpPrompt={pendingUserInputs.length === 0 && showPlanFollowUpPrompt}
                  showPlanSidebarToggle={showPlanSidebarToggle}
                  skills={selectedProviderStatus?.skills ?? []}
                  canSteerRunningTurn={canSteerRunningTurn}
                />
              )}
            </div>
          </div>
        </form>
      </>
    );
  }),
);
