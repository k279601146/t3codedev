import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  ProjectEntry,
  ProviderApprovalDecision,
  ProviderInteractionMode,
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
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { resolveComposerMenuActiveItemId } from "./composerMenuHighlight";
import { searchSlashCommandItems } from "./composerSlashCommandSearch";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { basenameOfPath } from "../../vscode-icons";
import { cn, randomUUID } from "~/lib/utils";
import { Separator } from "../ui/separator";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
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
import {
  ChevronDownIcon,
  CircleAlertIcon,
  BookOpenIcon,
  CheckIcon,
  FileIcon,
  HandIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  type LucideIcon,
  XIcon,
} from "lucide-react";
import { useI18n, type TranslationKey } from "../../i18n";
import { proposedPlanTitle } from "../../proposedPlan";
import { getProviderInteractionModeToggle } from "../../providerModels";
import {
  deriveProviderInstanceEntries,
  resolveProviderDriverKindForInstanceSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type AppModelOption, getAppModelOptionsForInstance } from "../../modelSelection";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type { SessionPhase, Thread } from "../../types";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import { searchProviderSkills } from "../../providerSkillSearch";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";

const ATTACHMENT_SIZE_LIMIT_LABEL = `${Math.round(
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024),
)}MB`;

const runtimeModeConfig: Record<
  RuntimeMode,
  {
    shortLabelKey: TranslationKey;
    labelKey: TranslationKey;
    descriptionKey: TranslationKey;
    icon: LucideIcon;
    tone: "muted" | "blue" | "orange";
  }
> = {
  "approval-required": {
    shortLabelKey: "composer.permission.approvalRequired",
    labelKey: "composer.permission.approvalRequired",
    descriptionKey: "composer.permission.approvalRequiredDescription",
    icon: HandIcon,
    tone: "muted",
  },
  "auto-accept-edits": {
    shortLabelKey: "composer.permission.autoAcceptEdits",
    labelKey: "composer.permission.autoAcceptEdits",
    descriptionKey: "composer.permission.autoAcceptEditsDescription",
    icon: ShieldCheckIcon,
    tone: "blue",
  },
  "full-access": {
    shortLabelKey: "composer.permission.fullAccessShort",
    labelKey: "composer.permission.fullAccess",
    descriptionKey: "composer.permission.fullAccessDescription",
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

const ComposerFooterModeControls = memo(function ComposerFooterModeControls(props: {
  showInteractionModeToggle: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  showPlanToggle: boolean;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onTogglePlanSidebar: () => void;
}) {
  const { t } = useI18n();
  const runtimeModeOption = runtimeModeConfig[props.runtimeMode];
  const RuntimeModeIcon = runtimeModeOption.icon;
  const runtimeModeLabel = t(runtimeModeOption.labelKey);
  const runtimeModeDescription = t(runtimeModeOption.descriptionKey);

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

      {props.showInteractionModeToggle ? (
        <>
          <Button
            variant="ghost"
            className="h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-muted-foreground/72 hover:text-foreground/85"
            size="sm"
            type="button"
            onClick={props.onToggleInteractionMode}
            title={
              props.interactionMode === "plan"
                ? "Plan mode — click to return to normal build mode"
                : "Default mode — click to enter plan mode"
            }
          >
            <ListTodoIcon />
            <span className="sr-only sm:not-sr-only">
              {props.interactionMode === "plan" ? "Plan" : "Build"}
            </span>
          </Button>

          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
        </>
      ) : null}

      <Select
        value={props.runtimeMode}
        onValueChange={(value) => props.onRuntimeModeChange(value!)}
      >
        <SelectTrigger
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground/72 hover:text-foreground/85"
          aria-label={t("composer.permission.control")}
          title={runtimeModeDescription}
        >
          <RuntimeModeIcon className="size-4" />
          <SelectValue>{runtimeModeLabel}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const OptionIcon = option.icon;
            const optionLabel = t(option.labelKey);
            const optionDescription = t(option.descriptionKey);
            return (
              <SelectItem key={mode} value={mode} className="min-w-64 py-2">
                <div className="grid min-w-0 gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {optionLabel}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {optionDescription}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>

      {props.showPlanToggle ? (
        <>
          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
          <Button
            variant="ghost"
            className={cn(
              "h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[13px]",
              props.planSidebarOpen
                ? "text-blue-400 hover:text-blue-300"
                : "text-muted-foreground/70 hover:text-foreground/80",
            )}
            size="sm"
            type="button"
            onClick={props.onTogglePlanSidebar}
            title={
              props.planSidebarOpen
                ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`
            }
          >
            <ListTodoIcon />
            <span className="sr-only sm:not-sr-only">{props.planSidebarLabel}</span>
          </Button>
        </>
      ) : null}
    </>
  );
});

const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  compact: boolean;
  activeContextWindow: ReturnType<typeof deriveLatestContextWindowSnapshot>;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isUsageLimitReached?: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  newThreadMode?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}) {
  return (
    <>
      {props.activeContextWindow ? <ContextWindowMeter usage={props.activeContextWindow} /> : null}
      {props.isPreparingWorktree ? (
        <span className="text-muted-foreground/70 text-xs">Preparing worktree...</span>
      ) : null}
      <ComposerPrimaryActions
        compact={props.compact}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        showPlanFollowUpPrompt={props.showPlanFollowUpPrompt}
        promptHasText={props.promptHasText}
        isSendBusy={props.isSendBusy}
        isUsageLimitReached={props.isUsageLimitReached ?? false}
        isConnecting={props.isConnecting}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
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

const NewThreadPlusMenu = memo(function NewThreadPlusMenu(props: {
  disabled: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  skills: ReadonlyArray<ServerProviderSkill>;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: React.ReactNode;
  onAttachFiles: () => void;
  onSelectSkill: (skill: ServerProviderSkill) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
}) {
  const { t } = useI18n();
  const [skillQuery, setSkillQuery] = useState("");
  const visibleSkills = useMemo(
    () => searchProviderSkills(props.skills, skillQuery, 8),
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
          <FileIcon className="size-4 shrink-0 opacity-80" />
          添加文件
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger>
            <BookOpenIcon className="size-4 shrink-0 opacity-80" />
            使用技能
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
                  placeholder="搜索技能"
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
                          {getNewThreadSkillBadgeLabel(skill)}
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
              <MenuItem
                onClick={() =>
                  toastManager.add({ type: "info", title: "请在技能目录中添加技能。" })
                }
              >
                <PlusIcon className="size-4 shrink-0 opacity-80" />
                添加技能
              </MenuItem>
              <MenuItem
                onClick={() => toastManager.add({ type: "info", title: "请在设置中管理技能。" })}
              >
                <SettingsIcon className="size-4 shrink-0 opacity-80" />
                管理技能
              </MenuItem>
            </div>
          </MenuSubPopup>
        </MenuSub>
        {props.traitsMenuContent ? (
          <>
            <MenuSeparator />
            {props.traitsMenuContent}
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <MenuSeparator />
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
      </MenuPopup>
    </Menu>
  );
});

function getNewThreadSkillBadgeLabel(skill: Pick<ServerProviderSkill, "scope" | "path">): string {
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
      className="inline-flex h-8 shrink-0 animate-in items-center gap-1.5 rounded-full border border-[#147DFF] bg-[#EAF5FF] px-2.5 text-[13px] font-medium text-[#147DFF] fade-in slide-in-from-left-1 zoom-in-95 duration-200 hover:bg-[#DDECFF] active:bg-[#D2E5FF] dark:bg-[#147DFF]/10 dark:hover:bg-[#147DFF]/15"
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
      "text-[#147DFF] hover:bg-[#EAF5FF] hover:text-[#147DFF] dark:hover:bg-[#147DFF]/10",
    icon: "text-[#147DFF]",
    menuIcon: "text-[#147DFF]",
  },
  orange: {
    trigger:
      "text-orange-600 hover:bg-orange-50 hover:text-orange-600 dark:text-orange-400 dark:hover:bg-orange-500/10",
    icon: "text-orange-600 dark:text-orange-400",
    menuIcon: "text-orange-600 dark:text-orange-400",
  },
};

const NewThreadRuntimeModeControl = memo(function NewThreadRuntimeModeControl(props: {
  disabled: boolean;
  runtimeMode: RuntimeMode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const { t } = useI18n();
  const activeOption = runtimeModeConfig[props.runtimeMode];
  const ActiveIcon = activeOption.icon;
  const activeTone = runtimeModeToneClassName[activeOption.tone];

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

const NewThreadPlanModeStatusChip = memo(function NewThreadPlanModeStatusChip(props: {
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
  isConnecting: boolean;
  isSendBusy: boolean;
  isUsageLimitReached?: boolean;
  isPreparingWorktree: boolean;
  environmentUnavailable: {
    readonly label: string;
    readonly connectionState: "connecting" | "disconnected" | "error";
  } | null;

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
  onImplementPlanInNewThread: () => void;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
  onSelectActivePendingUserInputOption: (questionId: string, optionLabel: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onPreviousActivePendingUserInputQuestion: () => void;
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
      routeKind,
      routeThreadRef,
      draftId,
      activeThreadId,
      activeThreadEnvironmentId: _activeThreadEnvironmentId,
      activeThread,
      isServerThread: _isServerThread,
      isLocalDraftThread: _isLocalDraftThread,
      phase,
      isConnecting,
      isSendBusy,
      isUsageLimitReached = false,
      isPreparingWorktree,
      environmentUnavailable,
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
      promptRef,
      composerImagesRef,
      composerTerminalContextsRef,
      shouldAutoScrollRef,
      scheduleStickToBottom,
      onSend,
      onInterrupt,
      onImplementPlanInNewThread,
      onRespondToApproval,
      onSelectActivePendingUserInputOption,
      onAdvanceActivePendingUserInput,
      onPreviousActivePendingUserInputQuestion,
      onChangeActivePendingUserInputCustomAnswer,
      onProviderModelSelect,
      toggleInteractionMode,
      handleRuntimeModeChange,
      handleInteractionModeChange,
      togglePlanSidebar,
      focusComposer,
      scheduleComposerFocus,
      setThreadError,
      onExpandImage,
    } = props;

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images / terminal contexts)
    // ------------------------------------------------------------------
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const prompt = composerDraft.prompt;
    const composerImages = composerDraft.images;
    const composerTerminalContexts = composerDraft.terminalContexts;
    const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;

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

    const composerProviderState = useMemo(
      () =>
        getComposerProviderState({
          provider: selectedProvider,
          model: selectedModel,
          models: selectedProviderModels,
          prompt,
          modelOptions: composerModelOptions?.[selectedProvider],
        }),
      [composerModelOptions, prompt, selectedModel, selectedProvider, selectedProviderModels],
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
    const selectedModelForPickerWithCustomFallback = useMemo(() => {
      const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
      return currentOptions.some((option) => option.slug === selectedModelForPicker)
        ? selectedModelForPicker
        : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
    }, [modelOptionsByInstance, selectedInstanceId, selectedModelForPicker, selectedProvider]);

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
    const isMobileViewport = useMediaQuery("max-sm");
    const isComposerCollapsedMobile = isMobileViewport && !isComposerFocused;

    // ------------------------------------------------------------------
    // Refs
    // ------------------------------------------------------------------
    const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
    const composerFormRef = useRef<HTMLFormElement>(null);
    const composerSurfaceRef = useRef<HTMLDivElement>(null);
    const composerAttachmentInputRef = useRef<HTMLInputElement>(null);
    const composerFormHeightRef = useRef(0);
    const composerSelectLockRef = useRef(false);
    const composerMenuOpenRef = useRef(false);
    const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
    const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
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
        return workspaceEntries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path",
          path: entry.path,
          pathKind: entry.kind,
          label: basenameOfPath(entry.path),
          description: entry.parentPath ?? "",
        }));
      }
      if (composerTrigger.kind === "slash-command") {
        const builtInSlashCommandItems = [
          {
            id: "slash:model",
            type: "slash-command",
            command: "model",
            label: "/model",
            description: "Switch response model for this thread",
          },
          {
            id: "slash:plan",
            type: "slash-command",
            command: "plan",
            label: "/plan",
            description: "Switch this thread into plan mode",
          },
          {
            id: "slash:default",
            type: "slash-command",
            command: "default",
            label: "/default",
            description: "Switch this thread back to normal build mode",
          },
        ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
        const providerSlashCommandItems = (selectedProviderStatus?.slashCommands ?? []).map(
          (command) => ({
            id: `provider-slash-command:${selectedProvider}:${command.name}`,
            type: "provider-slash-command" as const,
            provider: selectedProvider,
            command,
            label: `/${command.name}`,
            description: command.description ?? command.input?.hint ?? "Run provider command",
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
    }, [composerTrigger, selectedProvider, selectedProviderStatus, workspaceEntries]);

    const composerMenuOpen = Boolean(composerTrigger);
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
    const showPlanSidebarToggle = Boolean(activePlan || sidebarProposedPlan || planSidebarOpen);
    const composerFooterActionLayoutKey = useMemo(() => {
      if (activePendingProgress) {
        return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
      }
      if (phase === "running") {
        return "running";
      }
      if (showPlanFollowUpPrompt) {
        return prompt.trim().length > 0 ? "plan:refine" : "plan:implement";
      }
      return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
    }, [
      activePendingIsResponding,
      activePendingProgress,
      composerSendState.hasSendableContent,
      isConnecting,
      isPreparingWorktree,
      isSendBusy,
      phase,
      prompt,
      showPlanFollowUpPrompt,
    ]);

    const isComposerMenuLoading =
      composerTriggerKind === "path" &&
      ((pathTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
        workspaceEntriesQuery.isLoading ||
        workspaceEntriesQuery.isFetching);
    const composerMenuEmptyState = useMemo(() => {
      if (composerTriggerKind === "skill") {
        return "No skills found. Try / to browse provider commands.";
      }
      return composerTriggerKind === "path"
        ? "No matching files or folders."
        : "No matching command.";
    }, [composerTriggerKind]);

    // ------------------------------------------------------------------
    // Provider traits UI
    // ------------------------------------------------------------------
    const setPromptFromTraits = useCallback(
      (nextPrompt: string) => {
        if (nextPrompt === promptRef.current) {
          scheduleComposerFocus();
          return;
        }
        promptRef.current = nextPrompt;
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
        const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
        setComposerCursor(nextCursor);
        setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
        scheduleComposerFocus();
      },
      [composerDraftTarget, promptRef, scheduleComposerFocus, setComposerDraftPrompt],
    );

    const providerTraitsMenuContent = renderProviderTraitsMenuContent({
      provider: selectedProvider,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: selectedModel,
      models: selectedProviderModels,
      modelOptions: composerModelOptions?.[selectedProvider],
      prompt,
      onPromptChange: setPromptFromTraits,
    });
    const providerTraitsPicker = renderProviderTraitsPicker({
      provider: selectedProvider,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: selectedModel,
      models: selectedProviderModels,
      modelOptions: composerModelOptions?.[selectedProvider],
      prompt,
      onPromptChange: setPromptFromTraits,
    });
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
      phase === "running" || isSendBusy || isConnecting || !composerSendState.hasSendableContent;
    const collapsedComposerPrimaryActionLabel = "Send message";
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
      setComposerCursor(
        collapseExpandedComposerCursor(promptRef.current, promptRef.current.length),
      );
      setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
      dragDepthRef.current = 0;
      setIsDragOverComposer(false);
    }, [draftId, activeThreadId, promptRef]);

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
        if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
          setComposerCursor(nextCursor);
          setComposerTrigger(
            cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
          );
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
        setComposerTrigger(
          cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
        );
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
        options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
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
        setComposerTrigger(detectComposerTrigger(next.text, nextExpandedCursor));
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
        window.requestAnimationFrame(() => {
          composerSelectLockRef.current = false;
        });
        const { snapshot, trigger } = resolveActiveComposerTrigger();
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
      [applyPromptReplacement, handleInteractionModeChange, resolveActiveComposerTrigger],
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
        onSend(event);
        if (shouldBlurMobileComposerOnSubmit()) {
          blurMobileComposerAfterSend();
        }
      },
      [blurMobileComposerAfterSend, onSend, shouldBlurMobileComposerOnSubmit],
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
        simplified={newThreadMode}
        activeInstanceId={selectedInstanceId}
        model={selectedModelForPickerWithCustomFallback}
        lockedProvider={lockedProvider}
        lockedContinuationGroupKey={lockedContinuationGroupKey}
        instanceEntries={providerInstanceEntries}
        keybindings={keybindings}
        modelOptionsByInstance={modelOptionsByInstance}
        terminalOpen={terminalOpen}
        open={isComposerModelPickerOpen}
        {...(composerProviderState.modelPickerIconClassName
          ? {
              activeProviderIconClassName: composerProviderState.modelPickerIconClassName,
            }
          : {})}
        triggerClassName={cn(
          "h-8 rounded-lg px-2.5 text-[13px]",
          newThreadMode &&
            "h-7 rounded-md px-1.5 text-[12px] font-normal text-foreground/80 hover:text-foreground",
        )}
        onOpenChange={(open) => {
          setIsComposerModelPickerOpen(open);
          if (open) {
            void getPrimaryEnvironmentConnection()
              .client.server.refreshProviders()
              .catch(() => undefined);
          }
        }}
        onInstanceModelChange={onProviderModelSelect}
      />
    );

    return (
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
            className={cn(
              "relative overflow-hidden border bg-card/98 transition-[border-color,box-shadow,background-color] duration-200 has-focus-visible:border-ring/65",
              newThreadMode
                ? "rounded-[18px] border-[#dcdfe4] bg-background shadow-[0_1px_2px_rgba(15,23,42,0.045),0_14px_36px_-32px_rgba(15,23,42,0.55)] has-focus-visible:border-[#c8ccd2] dark:border-border/70 dark:bg-card/98 dark:shadow-[0_10px_28px_-24px_rgba(0,0,0,0.7)]"
                : "rounded-[14px] shadow-[var(--t3-shadow-composer)] has-focus-visible:shadow-[var(--claude-shadow-panel)]",
              isDragOverComposer
                ? newThreadMode
                  ? "border-dashed border-[#147DFF] bg-card ring-[12px] ring-[#EAF5FF] dark:ring-[#147DFF]/10"
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
                <div className="flex flex-col items-center gap-1.5 text-[#147DFF]">
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
                />
                <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3 sm:px-4">
                  <ComposerPendingApprovalActions
                    requestId={activePendingApproval.requestId}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    onRespondToApproval={onRespondToApproval}
                  />
                </div>
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
                        showPlanFollowUpPrompt={false}
                        promptHasText={false}
                        isSendBusy={isSendBusy}
                        isConnecting={isConnecting}
                        isEnvironmentUnavailable={environmentUnavailable !== null}
                        isPreparingWorktree={false}
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
                    : prompt.trim() || "Ask anything..."}
                </button>
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-black/5 bg-neutral-700 text-white shadow-sm disabled:bg-neutral-300 disabled:text-neutral-500 disabled:opacity-100 dark:bg-neutral-200 dark:text-neutral-950"
                  disabled={collapsedComposerPrimaryActionDisabled}
                  aria-label={collapsedComposerPrimaryActionLabel}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    submitComposer();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 3L8 13M8 3L4 7M8 3L12 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
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
                newThreadMode && isDragOverComposer && "opacity-20 blur-[1px]",
              )}
            >
              {composerMenuOpen && !isComposerApprovalState && (
                <div className="absolute inset-x-0 bottom-full z-20 mb-2 px-1">
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

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerImages.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {composerImages.map((image) => (
                      <div
                        key={image.id}
                        className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
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
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] text-muted-foreground/70">
                            <FileIcon className="size-4 text-muted-foreground/70" />
                            <span className="line-clamp-2 break-all">{image.name}</span>
                          </div>
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
                          className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                          onClick={() => removeComposerImage(image.id)}
                          aria-label={`Remove ${image.name}`}
                        >
                          <XIcon />
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
                    newThreadMode && "min-h-[42px] max-h-[280px] text-[14px] leading-6",
                    showMobilePendingAnswerActions && "max-sm:pb-11",
                  )}
                  {...(newThreadMode
                    ? {
                        placeholderClassName: "text-[14px] leading-6 text-muted-foreground/45",
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
                          ? "Add feedback to refine the plan, or leave this blank to implement it"
                          : environmentUnavailable
                            ? `${environmentUnavailable.label} is ${
                                environmentUnavailable.connectionState === "connecting"
                                  ? "connecting"
                                  : "disconnected"
                              }`
                            : newThreadMode
                              ? (newThreadPlaceholder ?? "随心输入")
                              : phase === "disconnected"
                                ? "Ask for follow-up changes or attach files"
                                : "Type / for skills"
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
                      showPlanFollowUpPrompt={false}
                      promptHasText={false}
                      isSendBusy={isSendBusy}
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
            {isComposerCollapsedMobile ? null : activePendingApproval ? (
              <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
                <ComposerPendingApprovalActions
                  requestId={activePendingApproval.requestId}
                  isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                  onRespondToApproval={onRespondToApproval}
                />
              </div>
            ) : (
              <div
                data-chat-composer-footer="true"
                data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
                className={cn(
                  "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-3.5 pb-3.5",
                  newThreadMode && "absolute bottom-0 left-0 right-0 px-3 pb-2.5",
                  isComposerFooterCompact ? "gap-1.5" : "gap-2 sm:gap-0",
                  showMobilePendingAnswerActions && "hidden sm:flex",
                )}
              >
                <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {newThreadMode ? (
                    <NewThreadPlusMenu
                      disabled={
                        isConnecting ||
                        isComposerApprovalState ||
                        (environmentUnavailable !== null && activePendingProgress === null)
                      }
                      interactionMode={interactionMode}
                      runtimeMode={runtimeMode}
                      skills={selectedProviderStatus?.skills ?? []}
                      showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}
                      traitsMenuContent={providerTraitsMenuContent}
                      onAttachFiles={openAttachmentPicker}
                      onSelectSkill={insertSkillAtComposerCursor}
                      onRuntimeModeChange={handleRuntimeModeChange}
                      onInteractionModeChange={handleInteractionModeChange}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground/70 hover:text-foreground"
                      aria-label="Attach files"
                      title="Attach files"
                      onClick={openAttachmentPicker}
                    >
                      <PlusIcon />
                    </Button>
                  )}

                  {newThreadMode ? (
                    <NewThreadRuntimeModeControl
                      disabled={
                        isConnecting ||
                        isComposerApprovalState ||
                        (environmentUnavailable !== null && activePendingProgress === null)
                      }
                      runtimeMode={runtimeMode}
                      onRuntimeModeChange={handleRuntimeModeChange}
                    />
                  ) : null}

                  {newThreadMode && newThreadModeLabel && onClearNewThreadMode ? (
                    <NewThreadModeStatusChip
                      label={newThreadModeLabel}
                      onClear={onClearNewThreadMode}
                    />
                  ) : null}

                  {newThreadMode ? null : composerModelPicker}

                  {newThreadMode && interactionMode === "plan" ? (
                    <NewThreadPlanModeStatusChip
                      onClear={() => handleInteractionModeChange("default")}
                    />
                  ) : null}

                  {newThreadMode ? null : isComposerFooterCompact ? (
                    <CompactComposerControlsMenu
                      activePlan={showPlanSidebarToggle}
                      interactionMode={interactionMode}
                      planSidebarLabel={planSidebarLabel}
                      planSidebarOpen={planSidebarOpen}
                      runtimeMode={runtimeMode}
                      showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}
                      traitsMenuContent={providerTraitsMenuContent}
                      onToggleInteractionMode={toggleInteractionMode}
                      onTogglePlanSidebar={togglePlanSidebar}
                      onRuntimeModeChange={handleRuntimeModeChange}
                    />
                  ) : (
                    <>
                      {providerTraitsPicker ? (
                        <>
                          <Separator
                            orientation="vertical"
                            className="mx-0.5 hidden h-4 sm:block"
                          />
                          {providerTraitsPicker}
                        </>
                      ) : null}
                      <ComposerFooterModeControls
                        showInteractionModeToggle={
                          composerProviderControls.showInteractionModeToggle
                        }
                        interactionMode={interactionMode}
                        runtimeMode={runtimeMode}
                        showPlanToggle={showPlanSidebarToggle}
                        planSidebarLabel={planSidebarLabel}
                        planSidebarOpen={planSidebarOpen}
                        onToggleInteractionMode={toggleInteractionMode}
                        onRuntimeModeChange={handleRuntimeModeChange}
                        onTogglePlanSidebar={togglePlanSidebar}
                      />
                    </>
                  )}
                </div>

                {/* Right side: send / stop button */}
                <div
                  data-chat-composer-actions="right"
                  data-chat-composer-primary-actions-compact={
                    isComposerPrimaryActionsCompact ? "true" : "false"
                  }
                  className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
                >
                  {newThreadMode ? composerModelPicker : null}
                  <ComposerFooterPrimaryActions
                    compact={isComposerPrimaryActionsCompact}
                    activeContextWindow={activeContextWindow}
                    pendingAction={pendingPrimaryAction}
                    isRunning={phase === "running"}
                    showPlanFollowUpPrompt={
                      pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                    }
                    promptHasText={prompt.trim().length > 0}
                    isSendBusy={isSendBusy}
                    isUsageLimitReached={isUsageLimitReached}
                    isConnecting={isConnecting}
                    isEnvironmentUnavailable={environmentUnavailable !== null}
                    isPreparingWorktree={isPreparingWorktree}
                    hasSendableContent={composerSendState.hasSendableContent}
                    preserveComposerFocusOnPointerDown={isMobileViewport}
                    newThreadMode={newThreadMode}
                    onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                    onInterrupt={handleInterruptPrimaryAction}
                    onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </form>
    );
  }),
);
