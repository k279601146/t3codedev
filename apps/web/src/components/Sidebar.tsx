import {
  ArchiveIcon,
  CreditCardIcon,
  BlocksIcon,
  CircleUserRoundIcon,
  Clock3Icon,
  HelpCircleIcon,
  CloudIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitPullRequestIcon,
  LogOutIcon,
  MessageCircleIcon,
  PanelLeftIcon,
  PencilIcon,
  RefreshCwIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SquarePenIcon,
  TerminalIcon,
  XIcon,
  ArrowUpRight,
  ChevronDownIcon,
  ChevronRightIcon,
  TriangleAlertIcon,
  Share2Icon,
} from "lucide-react";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  resolveThreadPr,
  terminalStatusFromRunningIds,
  ThreadStatusLabel,
} from "./ThreadStatusIndicators";
import { autoAnimate } from "@formkit/auto-animate";
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  type CommercialAccountUsageSchema,
  type ContextMenuItem,
  CONVERSATION_PROJECT_ID,
  type DesktopUpdateState,
  EnvironmentId,
  ProjectId,
  type ServerProvider,
  type ScopedThreadRef,
  type SidebarProjectGroupingMode,
  type ThreadEnvMode,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL } from "@t3tools/shared/commercialEngine";
import {
  parseScopedThreadKey,
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime";
import { Link, useLocation, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import type {
  SidebarProjectSortOrder,
  SidebarThreadPreviewCount,
  SidebarThreadSortOrder,
} from "@t3tools/contracts/settings";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { isElectron } from "../env";
import { APP_BASE_NAME, APP_STAGE_LABEL, APP_VERSION } from "../branding";
import { isTerminalFocused } from "../lib/terminalFocus";
import { cn, isMacPlatform, newCommandId } from "../lib/utils";
import { resolveConversationWorkspacePath } from "../lib/conversationWorkspace";
import {
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsForProjectRefs,
  selectSidebarThreadsAcrossEnvironments,
  selectThreadByRef,
  useStore,
} from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useModelPickerOpen } from "../modelPickerOpenState";
import { useShortcutModifierState } from "../shortcutModifierState";
import { useGitStatus } from "../lib/gitStatusState";
import { readLocalApi } from "../localApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { retainThreadDetailSubscription } from "../environments/runtime/service";
import { useServerConfig } from "../rpc/serverState";

import { useThreadActions } from "../hooks/useThreadActions";
import {
  buildThreadRouteParams,
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { formatSidebarThreadTimeLabel } from "../timestampFormat";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { type DefaultSidebarSectionId, useCursorLayoutStore } from "../cursorLayoutStore";
import {
  getSidebarThreadIdsToPrewarm,
  getVisibleThreadsForProject,
  resolveAdjacentThreadId,
  isContextMenuPointerDown,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadSeedContext,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  orderItemsByPreferredIds,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  useThreadJumpHintVisibility,
  ThreadStatusPill,
} from "./Sidebar.logic";
import { sortThreads } from "../lib/threadSort";
import { SidebarAppUpdateButton } from "./sidebar/SidebarUpdatePill";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { CommandDialogTrigger } from "./ui/command";
import { readEnvironmentApi } from "../environmentApi";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { useI18n } from "../i18n";
import { useServerKeybindings, useServerProviders } from "../rpc/serverState";
import {
  publishDesktopCommercialAuthState,
  usePublishedDesktopCommercialAuthState,
} from "../commercialAuthState";
import {
  derivePhysicalProjectKey,
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import type { SidebarThreadSummary } from "../types";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { SidebarProviderUpdatePill } from "./sidebar/SidebarProviderUpdatePill";
import {
  ensureCursorProjectForPath,
  getExternalFolderPathsFromDrop,
  hasExternalFolderDrop,
} from "../lib/cursorExternalProjects";
import { AddProjectMenu } from "./AddProjectMenu";
import { startNewConversationThread } from "../lib/conversationThreadActions";

async function openWorkspaceDirectoryInExplorer(input: {
  readonly environmentId: EnvironmentId;
  readonly path: string;
  readonly openPath: (path: string) => Promise<void>;
}): Promise<void> {
  const environmentApi = readEnvironmentApi(input.environmentId);
  if (!environmentApi) {
    throw new Error(`Environment API not found for environment ${input.environmentId}`);
  }
  await environmentApi.projects.ensureDirectory({ cwd: input.path });
  await input.openPath(input.path);
}

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
const EMPTY_THREAD_JUMP_LABELS = new Map<string, string>();
const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

function formatProjectMemberActionLabel(
  member: SidebarProjectGroupMember,
  groupedProjectCount: number,
): string {
  if (groupedProjectCount <= 1) {
    return member.name;
  }

  return member.environmentLabel ? `${member.environmentLabel} — ${member.cwd}` : member.cwd;
}

function projectGroupingModeDescription(mode: SidebarProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Projects from the same repository share one sidebar row.";
    case "repository_path":
      return "Projects group only when both the repository and repo-relative path match.";
    case "separate":
      return "Every project path gets its own sidebar row.";
  }
}

function buildThreadJumpLabelMap(input: {
  keybindings: ReturnType<typeof useServerKeybindings>;
  platform: string;
  terminalOpen: boolean;
  threadJumpCommandByKey: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof threadJumpCommandForIndex>>
  >;
}): ReadonlyMap<string, string> {
  if (input.threadJumpCommandByKey.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = {
    platform: input.platform,
    context: {
      terminalFocus: false,
      terminalOpen: input.terminalOpen,
    },
  } as const;
  const mapping = new Map<string, string>();
  for (const [threadKey, command] of input.threadJumpCommandByKey) {
    const label = shortcutLabelForCommand(input.keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(threadKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}

interface SidebarThreadRowProps {
  thread: SidebarThreadSummary;
  projectCwd: string | null;
  orderedProjectThreadKeys: readonly string[];
  isActive: boolean;
  isPendingOpen: boolean;
  jumpLabel: string | null;
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveThreadKey: string | null;
  setConfirmingArchiveThreadKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadRef: ScopedThreadRef) => Promise<void>;
  openPrLink: (event: React.MouseEvent<HTMLElement>, prUrl: string) => void;
}

const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const {
    orderedProjectThreadKeys,
    isActive,
    isPendingOpen,
    jumpLabel,
    appSettingsConfirmThreadArchive,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveThreadKey,
    setConfirmingArchiveThreadKey,
    confirmArchiveButtonRefs,
    handleThreadClick,
    navigateToThread,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveThread,
    openPrLink,
    thread,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const runningTerminalIds = useTerminalStateStore(
    (state) =>
      selectThreadTerminalState(state.terminalStateByThreadKey, threadRef).runningTerminalIds,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isRemoteThread =
    primaryEnvironmentId !== null && thread.environmentId !== primaryEnvironmentId;
  const remoteEnvLabel = useSavedEnvironmentRuntimeStore(
    (s) => s.byId[thread.environmentId]?.descriptor?.label ?? null,
  );
  const remoteEnvSavedLabel = useSavedEnvironmentRegistryStore(
    (s) => s.byId[thread.environmentId]?.label ?? null,
  );
  const threadEnvironmentLabel = isRemoteThread
    ? (remoteEnvLabel ?? remoteEnvSavedLabel ?? "Remote")
    : null;
  // For grouped projects, the thread may belong to a different environment
  // than the representative project.  Look up the thread's own project cwd
  // so git status (and thus PR detection) queries the correct path.
  const threadProjectCwd = useStore(
    useMemo(
      () => (state: import("../store").AppState) =>
        selectProjectByRef(state, scopeProjectRef(thread.environmentId, thread.projectId))?.cwd ??
        null,
      [thread.environmentId, thread.projectId],
    ),
  );
  const gitCwd = thread.worktreePath ?? threadProjectCwd ?? props.projectCwd;
  const gitStatus = useGitStatus({
    environmentId: thread.environmentId,
    cwd: thread.branch != null ? gitCwd : null,
  });
  const isHighlighted = isActive || isSelected;
  const isThreadRunning =
    thread.session?.status === "running" && thread.session.activeTurnId != null;
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt,
    },
  });
  const pr = resolveThreadPr(thread.branch, gitStatus.data);
  const prStatus = prStatusIndicator(pr, gitStatus.data?.sourceControlProvider);
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const isConfirmingArchive = confirmingArchiveThreadKey === threadKey && !isThreadRunning;
  const threadMetaClassName = isConfirmingArchive
    ? "pointer-events-none opacity-0"
    : "pointer-events-none transition-opacity duration-150 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0";
  const threadTimeClassName = isConfirmingArchive ? "hidden" : "inline";
  const clearConfirmingArchive = useCallback(() => {
    setConfirmingArchiveThreadKey((current) => (current === threadKey ? null : current));
  }, [setConfirmingArchiveThreadKey, threadKey]);
  const handleMouseLeave = useCallback(() => {
    clearConfirmingArchive();
  }, [clearConfirmingArchive]);
  const handleBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLLIElement>) => {
      const currentTarget = event.currentTarget;
      requestAnimationFrame(() => {
        if (currentTarget.contains(document.activeElement)) {
          return;
        }
        clearConfirmingArchive();
      });
    },
    [clearConfirmingArchive],
  );
  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      handleThreadClick(event, threadRef, orderedProjectThreadKeys);
    },
    [handleThreadClick, orderedProjectThreadKeys, threadRef],
  );
  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigateToThread(threadRef);
    },
    [navigateToThread, threadRef],
  );
  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const hasSelection = useThreadSelectionStore.getState().hasSelection();
      if (hasSelection && isSelected) {
        void handleMultiSelectContextMenu({
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }

      if (hasSelection) {
        clearSelection();
      }
      void handleThreadContextMenu(threadRef, {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [clearSelection, handleMultiSelectContextMenu, handleThreadContextMenu, isSelected, threadRef],
  );
  const handlePrClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!prStatus) return;
      openPrLink(event, prStatus.url);
    },
    [openPrLink, prStatus],
  );
  const handleRenameInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && renamingInputRef.current !== element) {
        renamingInputRef.current = element;
        element.focus();
        element.select();
      }
    },
    [renamingInputRef],
  );
  const handleRenameInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRenamingTitle(event.target.value);
    },
    [setRenamingTitle],
  );
  const handleRenameInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        void commitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        cancelRename();
      }
    },
    [cancelRename, commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef],
  );
  const handleRenameInputBlur = useCallback(() => {
    if (!renamingCommittedRef.current) {
      void commitRename(threadRef, renamingTitle, thread.title);
    }
  }, [commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef]);
  const handleRenameInputClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);
  const handleConfirmArchiveRef = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element) {
        confirmArchiveButtonRefs.current.set(threadKey, element);
      } else {
        confirmArchiveButtonRefs.current.delete(threadKey);
      }
    },
    [confirmArchiveButtonRefs, threadKey],
  );
  const stopPropagationOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );
  const handleConfirmArchiveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearConfirmingArchive();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, clearConfirmingArchive, threadRef],
  );
  const handleStartArchiveConfirmation = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setConfirmingArchiveThreadKey(threadKey);
      requestAnimationFrame(() => {
        confirmArchiveButtonRefs.current.get(threadKey)?.focus();
      });
    },
    [confirmArchiveButtonRefs, setConfirmingArchiveThreadKey, threadKey],
  );
  const handleArchiveImmediateClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, threadRef],
  );
  const rowButtonRender = useMemo(() => <div role="button" tabIndex={0} />, []);

  return (
    <SidebarMenuSubItem
      className="w-full"
      data-thread-item
      onMouseLeave={handleMouseLeave}
      onBlurCapture={handleBlurCapture}
    >
      <SidebarMenuSubButton
        render={rowButtonRender}
        size="sm"
        isActive={isActive}
        data-testid={`thread-row-${thread.id}`}
        className={`${resolveThreadRowClassName({
          isActive,
          isSelected,
          isPendingOpen,
        })} relative isolate font-normal`}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleRowContextMenu}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {prStatus && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={prStatus.tooltip}
                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                    onClick={handlePrClick}
                  >
                    <ChangeRequestStatusIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
            </Tooltip>
          )}
          {threadStatus && <ThreadStatusLabel status={threadStatus} />}
          {renamingThreadKey === threadKey ? (
            <input
              ref={handleRenameInputRef}
              className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-[14px] leading-5 outline-none"
              value={renamingTitle}
              onChange={handleRenameInputChange}
              onKeyDown={handleRenameInputKeyDown}
              onBlur={handleRenameInputBlur}
              onClick={handleRenameInputClick}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="min-w-0 flex-1 truncate text-[13px] leading-5 text-inherit"
                    data-testid={`thread-title-${thread.id}`}
                  >
                    {thread.title}
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
                {thread.title}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {terminalStatus && (
            <span
              role="img"
              aria-label={terminalStatus.label}
              title={terminalStatus.label}
              className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
            >
              <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`} />
            </span>
          )}
          <div
            className={`flex min-w-11 justify-end transition-[min-width] duration-150 ${
              isRemoteThread ? "max-sm:min-w-24" : "max-sm:min-w-20"
            }`}
          >
            {isConfirmingArchive ? (
              <button
                ref={handleConfirmArchiveRef}
                type="button"
                data-thread-selection-safe
                data-testid={`thread-archive-confirm-${thread.id}`}
                aria-label={`Confirm archive ${thread.title}`}
                className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-full bg-destructive/12 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
                onPointerDown={stopPropagationOnPointerDown}
                onClick={handleConfirmArchiveClick}
              >
                Confirm
              </button>
            ) : !isThreadRunning ? (
              appSettingsConfirmThreadArchive ? (
                <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`thread-archive-${thread.id}`}
                    aria-label={`Archive ${thread.title}`}
                    className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onPointerDown={stopPropagationOnPointerDown}
                    onClick={handleStartArchiveConfirmation}
                  >
                    <ArchiveIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`thread-archive-${thread.id}`}
                          aria-label={`Archive ${thread.title}`}
                          className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onPointerDown={stopPropagationOnPointerDown}
                          onClick={handleArchiveImmediateClick}
                        >
                          <ArchiveIcon className="size-3.5" />
                        </button>
                      </div>
                    }
                  />
                  <TooltipPopup side="top">Archive</TooltipPopup>
                </Tooltip>
              )
            ) : null}
            <span className={threadMetaClassName}>
              <span className="inline-flex items-center gap-1">
                {isRemoteThread && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={threadEnvironmentLabel ?? "Remote"}
                          className="inline-flex h-5 items-center justify-center"
                        />
                      }
                    >
                      <CloudIcon className="block size-3 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{threadEnvironmentLabel}</TooltipPopup>
                  </Tooltip>
                )}
                {jumpLabel ? (
                  <span
                    className="inline-flex h-5 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-normal text-foreground shadow-sm"
                    title={jumpLabel}
                  >
                    {jumpLabel}
                  </span>
                ) : (
                  <span
                    className={`text-[12px] tabular-nums ${threadTimeClassName} ${
                      isHighlighted ? "text-muted-foreground/62" : "text-muted-foreground/50"
                    }`}
                  >
                    {isPendingOpen
                      ? "打开中"
                      : formatSidebarThreadTimeLabel(
                          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
                        )}
                  </span>
                )}
              </span>
            </span>
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

interface SidebarProjectThreadListProps {
  projectKey: string;
  projectExpanded: boolean;
  hasOverflowingThreads: boolean;
  hiddenThreadStatus: ThreadStatusPill | null;
  orderedProjectThreadKeys: readonly string[];
  renderedThreads: readonly SidebarThreadSummary[];
  showEmptyThreadState: boolean;
  shouldShowThreadPanel: boolean;
  isThreadListExpanded: boolean;
  projectCwd: string;
  activeRouteThreadKey: string | null;
  pendingOpenThreadKey: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveThreadKey: string | null;
  setConfirmingArchiveThreadKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadRef: ScopedThreadRef) => Promise<void>;
  openPrLink: (event: React.MouseEvent<HTMLElement>, prUrl: string) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
}

interface SidebarThreadListToggleProps {
  expanded: boolean;
  hiddenThreadStatus: ThreadStatusPill | null;
  onExpand: () => void;
  onCollapse: () => void;
}

const SidebarThreadListToggle = memo(function SidebarThreadListToggle(
  props: SidebarThreadListToggleProps,
) {
  const { expanded, hiddenThreadStatus, onExpand, onCollapse } = props;
  const { t } = useI18n();
  const buttonRender = useMemo(() => <button type="button" />, []);

  return (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        render={buttonRender}
        data-thread-selection-safe
        size="sm"
        className="t3-sidebar-thread-row h-7.5 w-full translate-x-0 justify-start rounded-[7px] px-2 text-left text-[13px] font-normal text-muted-foreground/70 hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-muted-foreground/90"
        onClick={expanded ? onCollapse : onExpand}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {!expanded && hiddenThreadStatus ? (
            <ThreadStatusLabel status={hiddenThreadStatus} compact />
          ) : null}
          <span>{expanded ? t("sidebar.collapseList") : t("sidebar.expandList")}</span>
        </span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

const SidebarProjectThreadList = memo(function SidebarProjectThreadList(
  props: SidebarProjectThreadListProps,
) {
  const {
    projectKey,
    projectExpanded,
    hasOverflowingThreads,
    hiddenThreadStatus,
    orderedProjectThreadKeys,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
    isThreadListExpanded,
    projectCwd,
    activeRouteThreadKey,
    pendingOpenThreadKey,
    threadJumpLabelByKey,
    appSettingsConfirmThreadArchive,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveThreadKey,
    setConfirmingArchiveThreadKey,
    confirmArchiveButtonRefs,
    attachThreadListAutoAnimateRef,
    handleThreadClick,
    navigateToThread,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveThread,
    openPrLink,
    expandThreadListForProject,
    collapseThreadListForProject,
  } = props;
  const { t } = useI18n();
  return (
    <SidebarMenuSub
      ref={attachThreadListAutoAnimateRef}
      className="mx-0 my-0 w-full translate-x-0 gap-0 overflow-hidden py-0 pl-6 pr-0"
    >
      {shouldShowThreadPanel && showEmptyThreadState ? (
        <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
          <div
            data-thread-selection-safe
            className="flex h-8.5 w-full translate-x-0 items-center px-2 text-left text-[14px] text-muted-foreground/55"
          >
            <span>{t("sidebar.noThreads")}</span>
          </div>
        </SidebarMenuSubItem>
      ) : null}
      {shouldShowThreadPanel &&
        renderedThreads.map((thread) => {
          const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          const isActive = activeRouteThreadKey === threadKey;
          return (
            <SidebarThreadRow
              key={threadKey}
              thread={thread}
              projectCwd={projectCwd}
              orderedProjectThreadKeys={orderedProjectThreadKeys}
              isActive={isActive}
              isPendingOpen={!isActive && pendingOpenThreadKey === threadKey}
              jumpLabel={threadJumpLabelByKey.get(threadKey) ?? null}
              appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
              renamingThreadKey={renamingThreadKey}
              renamingTitle={renamingTitle}
              setRenamingTitle={setRenamingTitle}
              renamingInputRef={renamingInputRef}
              renamingCommittedRef={renamingCommittedRef}
              confirmingArchiveThreadKey={confirmingArchiveThreadKey}
              setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
              confirmArchiveButtonRefs={confirmArchiveButtonRefs}
              handleThreadClick={handleThreadClick}
              navigateToThread={navigateToThread}
              handleMultiSelectContextMenu={handleMultiSelectContextMenu}
              handleThreadContextMenu={handleThreadContextMenu}
              clearSelection={clearSelection}
              commitRename={commitRename}
              cancelRename={cancelRename}
              attemptArchiveThread={attemptArchiveThread}
              openPrLink={openPrLink}
            />
          );
        })}

      {projectExpanded && hasOverflowingThreads && !isThreadListExpanded && (
        <SidebarThreadListToggle
          expanded={false}
          hiddenThreadStatus={hiddenThreadStatus}
          onExpand={() => {
            expandThreadListForProject(projectKey);
          }}
          onCollapse={() => {
            collapseThreadListForProject(projectKey);
          }}
        />
      )}
      {projectExpanded && hasOverflowingThreads && isThreadListExpanded && (
        <SidebarThreadListToggle
          expanded
          hiddenThreadStatus={hiddenThreadStatus}
          onExpand={() => {
            expandThreadListForProject(projectKey);
          }}
          onCollapse={() => {
            collapseThreadListForProject(projectKey);
          }}
        />
      )}
    </SidebarMenuSub>
  );
});

interface SidebarProjectItemProps {
  project: SidebarProjectSnapshot;
  isThreadListExpanded: boolean;
  activeRouteThreadKey: string | null;
  pendingOpenThreadKey: string | null;
  pinnedThreadKeySet: ReadonlySet<string>;
  conversationWorkspaceDirByEnvironmentId: ReadonlyMap<EnvironmentId, string>;
  newThreadShortcutLabel: string | null;
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  isManualProjectSorting: boolean;
  dragHandleProps: SortableProjectHandleProps | null;
}

interface ProjectContextMenuPosition {
  x: number;
  y: number;
}

function ProjectContextMenu({
  position,
  labels,
  onClose,
  onPinProject,
  onOpenInExplorer,
  onRenameProject,
  onProjectGrouping,
  onArchiveThreads,
  onRemoveProject,
}: {
  position: ProjectContextMenuPosition;
  labels: {
    pinProject: string;
    openInExplorer: string;
    renameProject: string;
    projectGrouping: string;
    archiveProjectThreads: string;
    removeProject: string;
  };
  onClose: () => void;
  onPinProject: () => void;
  onOpenInExplorer: () => void;
  onRenameProject: () => void;
  onProjectGrouping: () => void;
  onArchiveThreads: () => void;
  onRemoveProject: () => void;
}) {
  useEffect(() => {
    const handlePointerDown = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const runAction = (action: () => void) => {
    onClose();
    action();
  };
  const left = Math.min(Math.max(8, position.x), Math.max(8, window.innerWidth - 190));
  const top = Math.min(Math.max(8, position.y), Math.max(8, window.innerHeight - 188));
  const menuItemClass =
    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground/90 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent";
  const iconClass = "size-3.5 shrink-0 text-muted-foreground/80";

  return (
    <div
      className="fixed z-50 min-w-[166px] rounded-xl border border-border/70 bg-popover p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.16)]"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" className={menuItemClass} onClick={() => runAction(onPinProject)}>
        <PinIcon className={iconClass} />
        <span className="min-w-0 truncate">{labels.pinProject}</span>
      </button>
      <button type="button" className={menuItemClass} onClick={() => runAction(onOpenInExplorer)}>
        <FolderOpenIcon className={iconClass} />
        <span className="min-w-0 truncate">{labels.openInExplorer}</span>
      </button>
      <button type="button" className={menuItemClass} onClick={() => runAction(onRenameProject)}>
        <PencilIcon className={iconClass} />
        <span className="min-w-0 truncate">{labels.renameProject}</span>
      </button>
      <button type="button" className={menuItemClass} onClick={() => runAction(onProjectGrouping)}>
        <BlocksIcon className={iconClass} />
        <span className="min-w-0 truncate">{labels.projectGrouping}</span>
      </button>
      <button type="button" className={menuItemClass} onClick={() => runAction(onArchiveThreads)}>
        <ArchiveIcon className={iconClass} />
        <span className="min-w-0 truncate">{labels.archiveProjectThreads}</span>
      </button>
      <div className="my-1 h-px bg-border/70" />
      <button type="button" className={menuItemClass} onClick={() => runAction(onRemoveProject)}>
        <XIcon className={iconClass} />
        <span className="min-w-0 truncate">{labels.removeProject}</span>
      </button>
    </div>
  );
}

function SidebarProjectIcon({ project }: { project: SidebarProjectSnapshot }) {
  const DefaultIcon = project.repositoryIdentity ? FolderGit2Icon : FolderIcon;
  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/72">
      <DefaultIcon
        className="absolute inset-0 size-3.5 transition-[opacity,transform] duration-150 ease-out group-hover/project-header:scale-95 group-hover/project-header:opacity-0 group-focus-within/project-header:scale-95 group-focus-within/project-header:opacity-0"
        strokeWidth={1.8}
      />
      <FolderOpenIcon
        className="absolute inset-0 size-3.5 scale-95 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/project-header:scale-100 group-hover/project-header:opacity-100 group-focus-within/project-header:scale-100 group-focus-within/project-header:opacity-100"
        strokeWidth={1.8}
      />
    </span>
  );
}

const SidebarProjectItem = memo(function SidebarProjectItem(props: SidebarProjectItemProps) {
  const {
    project,
    isThreadListExpanded,
    activeRouteThreadKey,
    pendingOpenThreadKey,
    pinnedThreadKeySet,
    conversationWorkspaceDirByEnvironmentId,
    newThreadShortcutLabel,
    handleNewThread,
    archiveThread,
    deleteThread,
    navigateToThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    isManualProjectSorting,
    dragHandleProps,
  } = props;
  const threadSortOrder = useSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const appSettingsConfirmThreadDelete = useSettings<boolean>(
    (settings) => settings.confirmThreadDelete,
  );
  const appSettingsConfirmThreadArchive = useSettings<boolean>(
    (settings) => settings.confirmThreadArchive,
  );
  const defaultThreadEnvMode = useSettings<ThreadEnvMode>(
    (settings) => settings.defaultThreadEnvMode,
  );
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const { updateSettings } = useUpdateSettings();
  const sidebarThreadPreviewCount = useSettings<SidebarThreadPreviewCount>(
    (settings) => settings.sidebarThreadPreviewCount,
  );
  const { t } = useI18n();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const setNewThreadScope = useUiStateStore((state) => state.setNewThreadScope);
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const setThreadPinned = useUiStateStore((state) => state.setThreadPinned);
  const toggleProject = useUiStateStore((state) => state.toggleProject);
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: t("sidebar.thread.idCopied"),
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("sidebar.thread.idCopyFailed"),
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: t("sidebar.thread.pathCopied"),
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("sidebar.thread.pathCopyFailed"),
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, []);
  const sidebarThreads = useStore(
    useShallow(
      useMemo(
        () => (state: import("../store").AppState) =>
          selectSidebarThreadsForProjectRefs(state, project.memberProjectRefs),
        [project.memberProjectRefs],
      ),
    ),
  );
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Keep a ref so callbacks can read the latest map without appearing in
  // dependency arrays (avoids invalidating every thread-row memo on each
  // thread-list change).
  const sidebarThreadByKeyRef = useRef(sidebarThreadByKey);
  sidebarThreadByKeyRef.current = sidebarThreadByKey;
  const projectThreads = sidebarThreads;
  const projectExpanded = useUiStateStore(
    (state) => state.projectExpandedById[project.projectKey] ?? true,
  );
  const threadLastVisitedAts = useUiStateStore(
    useShallow((state) =>
      projectThreads.map(
        (thread) =>
          state.threadLastVisitedAtById[
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
          ] ?? null,
      ),
    ),
  );
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadKey, setConfirmingArchiveThreadKey] = useState<string | null>(null);
  const [projectRenameTarget, setProjectRenameTarget] = useState<SidebarProjectGroupMember | null>(
    null,
  );
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
  const [projectGroupingTarget, setProjectGroupingTarget] =
    useState<SidebarProjectGroupMember | null>(null);
  const [projectGroupingSelection, setProjectGroupingSelection] = useState<
    SidebarProjectGroupingMode | "inherit"
  >("inherit");
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const memberProjectByScopedKey = useMemo(
    () =>
      new Map(
        project.memberProjects.map((member) => [
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
          member,
        ]),
      ),
    [project.memberProjects],
  );
  const memberThreadCountByPhysicalKey = useMemo(() => {
    const counts = new Map<string, number>(
      project.memberProjects.map((member) => [member.physicalProjectKey, 0] as const),
    );
    for (const thread of projectThreads) {
      const member = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (!member) {
        continue;
      }
      counts.set(member.physicalProjectKey, (counts.get(member.physicalProjectKey) ?? 0) + 1);
    }
    return counts;
  }, [memberProjectByScopedKey, project.memberProjects, projectThreads]);

  const { visibleProjectThreads, orderedProjectThreadKeys } = useMemo(() => {
    const visibleProjectThreads = sortThreads(
      projectThreads.filter(
        (thread) =>
          thread.archivedAt === null &&
          !pinnedThreadKeySet.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      ),
      threadSortOrder,
    );
    return {
      orderedProjectThreadKeys: visibleProjectThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
      visibleProjectThreads,
    };
  }, [pinnedThreadKeySet, projectThreads, threadSortOrder]);

  const pinnedCollapsedThread = useMemo(() => {
    const activeThreadKey = activeRouteThreadKey ?? undefined;
    if (!activeThreadKey || projectExpanded) {
      return null;
    }
    return (
      visibleProjectThreads.find(
        (thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeThreadKey,
      ) ?? null
    );
  }, [activeRouteThreadKey, projectExpanded, visibleProjectThreads]);

  const {
    hasOverflowingThreads,
    hiddenThreadStatus,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
  } = useMemo(() => {
    const lastVisitedAtByThreadKey = new Map(
      projectThreads.map((thread, index) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        threadLastVisitedAts[index] ?? null,
      ]),
    );
    const resolveProjectThreadStatus = (thread: SidebarThreadSummary) => {
      const lastVisitedAt = lastVisitedAtByThreadKey.get(
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      return resolveThreadStatusPill({
        thread: {
          ...thread,
          ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
        },
      });
    };
    const hasOverflowingThreads = visibleProjectThreads.length > sidebarThreadPreviewCount;
    const previewThreads =
      isThreadListExpanded || !hasOverflowingThreads
        ? visibleProjectThreads
        : visibleProjectThreads.slice(0, sidebarThreadPreviewCount);
    const visibleThreadKeys = new Set(
      [...previewThreads, ...(pinnedCollapsedThread ? [pinnedCollapsedThread] : [])].map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    );
    const renderedThreads = pinnedCollapsedThread
      ? [pinnedCollapsedThread]
      : visibleProjectThreads.filter((thread) =>
          visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
        );
    const hiddenThreads = visibleProjectThreads.filter(
      (thread) =>
        !visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
    return {
      hasOverflowingThreads,
      hiddenThreadStatus: resolveProjectStatusIndicator(
        hiddenThreads.map((thread) => resolveProjectThreadStatus(thread)),
      ),
      renderedThreads,
      showEmptyThreadState: projectExpanded && visibleProjectThreads.length === 0,
      shouldShowThreadPanel: projectExpanded || pinnedCollapsedThread !== null,
    };
  }, [
    isThreadListExpanded,
    pinnedCollapsedThread,
    projectExpanded,
    projectThreads,
    sidebarThreadPreviewCount,
    threadLastVisitedAts,
    visibleProjectThreads,
  ]);
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const setProjectOrder = useUiStateStore((state) => state.setProjectOrder);
  const [projectContextMenuPosition, setProjectContextMenuPosition] =
    useState<ProjectContextMenuPosition | null>(null);

  const handleProjectButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (useThreadSelectionStore.getState().hasSelection()) {
        clearSelection();
      }
      toggleProject(project.projectKey);
    },
    [
      clearSelection,
      dragInProgressRef,
      project.projectKey,
      suppressProjectClickAfterDragRef,
      suppressProjectClickForContextMenuRef,
      toggleProject,
    ],
  );

  const handleProjectButtonKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      toggleProject(project.projectKey);
    },
    [dragInProgressRef, project.projectKey, toggleProject],
  );

  const handleProjectButtonPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [suppressProjectClickAfterDragRef, suppressProjectClickForContextMenuRef],
  );

  const openProjectRenameDialog = useCallback((member: SidebarProjectGroupMember) => {
    setProjectRenameTarget(member);
    setProjectRenameTitle(member.name);
  }, []);

  const openProjectGroupingDialog = useCallback(
    (member: SidebarProjectGroupMember) => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      setProjectGroupingTarget(member);
      setProjectGroupingSelection(
        projectGroupingSettings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
      );
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides],
  );

  const removeProject = useCallback(
    async (member: SidebarProjectGroupMember, options: { force?: boolean } = {}): Promise<void> => {
      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const draftStore = useComposerDraftStore.getState();
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(memberProjectRef);
      if (projectDraftThread) {
        draftStore.clearDraftThread(projectDraftThread.draftId);
      }
      draftStore.clearProjectDraftThreadId(memberProjectRef);

      const projectApi = readEnvironmentApi(member.environmentId);
      if (!projectApi) {
        throw new Error("Project API unavailable.");
      }

      await projectApi.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: member.id,
        ...(options.force === true ? { force: true } : {}),
      });
    },
    [],
  );

  const handleRemoveProject = useCallback(
    async (member: SidebarProjectGroupMember) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }

      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const memberThreadCount = memberThreadCountByPhysicalKey.get(member.physicalProjectKey) ?? 0;
      if (memberThreadCount > 0) {
        const warningToastId = toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Project is not empty",
            description: "Delete all threads in this project before removing it.",
            actionVariant: "destructive",
            actionProps: {
              children: "Delete anyway",
              onClick: () => {
                void (async () => {
                  toastManager.close(warningToastId);
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 180);
                  });

                  const latestProjectThreads = selectSidebarThreadsForProjectRefs(
                    useStore.getState(),
                    [memberProjectRef],
                  );
                  const confirmed = await api.dialogs.confirm(
                    latestProjectThreads.length > 0
                      ? [
                          `Remove project "${member.name}" and delete its ${latestProjectThreads.length} thread${
                            latestProjectThreads.length === 1 ? "" : "s"
                          }?`,
                          `Path: ${member.cwd}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This permanently clears conversation history for those threads.",
                          "This removes only this project entry.",
                          "This action cannot be undone.",
                        ].join("\n")
                      : [
                          `Remove project "${member.name}"?`,
                          `Path: ${member.cwd}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This removes only this project entry.",
                        ].join("\n"),
                  );
                  if (!confirmed) {
                    return;
                  }

                  await removeProject(member, { force: true });
                })().catch((error) => {
                  const message =
                    error instanceof Error ? error.message : "Unknown error removing project.";
                  console.error("Failed to remove project", {
                    projectId: member.id,
                    environmentId: member.environmentId,
                    error,
                  });
                  toastManager.add(
                    stackedThreadToast({
                      type: "error",
                      title: `Failed to remove "${member.name}"`,
                      description: message,
                    }),
                  );
                });
              },
            },
          }),
        );
        return;
      }

      const message = [
        `Remove project "${member.name}"?`,
        `Path: ${member.cwd}`,
        ...(member.environmentLabel ? [`Environment: ${member.environmentLabel}`] : []),
        "This removes only this project entry.",
      ].join("\n");
      const confirmed = await api.dialogs.confirm(message);
      if (!confirmed) {
        return;
      }

      try {
        await removeProject(member);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing project.";
        console.error("Failed to remove project", {
          projectId: member.id,
          environmentId: member.environmentId,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to remove "${member.name}"`,
            description: message,
          }),
        );
      }
    },
    [memberThreadCountByPhysicalKey, removeProject],
  );

  const representativeProjectMember = project.memberProjects[0] ?? null;
  const closeProjectContextMenu = useCallback(() => {
    setProjectContextMenuPosition(null);
  }, []);
  const pinProjectToTop = useCallback(() => {
    const draggedProjectIds = project.memberProjects.map((member) => member.physicalProjectKey);
    setProjectOrder([
      ...draggedProjectIds,
      ...projectOrder.filter((projectId) => !draggedProjectIds.includes(projectId)),
    ]);
    updateSettings({ sidebarProjectSortOrder: "manual" });
  }, [project.memberProjects, projectOrder, setProjectOrder, updateSettings]);
  const openRepresentativeProjectInExplorer = useCallback(() => {
    if (!representativeProjectMember) {
      return;
    }
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: t("sidebar.pathOpenFailed"),
        description: representativeProjectMember.cwd,
      });
      return;
    }
    void api.shell.openPath(representativeProjectMember.cwd).catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("sidebar.pathOpenFailed"),
          description: error instanceof Error ? error.message : representativeProjectMember.cwd,
        }),
      );
    });
  }, [representativeProjectMember, t]);
  const renameRepresentativeProject = useCallback(() => {
    if (representativeProjectMember) {
      openProjectRenameDialog(representativeProjectMember);
    }
  }, [openProjectRenameDialog, representativeProjectMember]);
  const openRepresentativeProjectGrouping = useCallback(() => {
    if (representativeProjectMember) {
      openProjectGroupingDialog(representativeProjectMember);
    }
  }, [openProjectGroupingDialog, representativeProjectMember]);
  const archiveVisibleProjectThreads = useCallback(() => {
    void (async () => {
      if (visibleProjectThreads.length === 0) {
        toastManager.add({ type: "info", title: t("sidebar.archiveProjectThreadsEmpty") });
        return;
      }
      try {
        for (const thread of visibleProjectThreads) {
          await archiveThread(scopeThreadRef(thread.environmentId, thread.id));
        }
        toastManager.add({ type: "success", title: t("sidebar.archiveProjectThreadsSuccess") });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("sidebar.archiveProjectThreadsFailed"),
            description: error instanceof Error ? error.message : "归档对话时发生错误。",
          }),
        );
      }
    })();
  }, [archiveThread, t, visibleProjectThreads]);
  const removeRepresentativeProject = useCallback(() => {
    if (representativeProjectMember) {
      void handleRemoveProject(representativeProjectMember);
    }
  }, [handleRemoveProject, representativeProjectMember]);
  const handleProjectButtonContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      suppressProjectClickForContextMenuRef.current = true;
      setProjectContextMenuPosition({ x: event.clientX, y: event.clientY });
    },
    [suppressProjectClickForContextMenuRef],
  );

  const handleThreadClick = useCallback(
    (
      event: React.MouseEvent,
      threadRef: ScopedThreadRef,
      orderedProjectThreadKeys: readonly string[],
    ) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const threadKey = scopedThreadKey(threadRef);
      const currentSelectionCount = useThreadSelectionStore.getState().selectedThreadKeys.size;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedProjectThreadKeys);
        return;
      }

      if (currentSelectionCount > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadKey);
      if (isMobile) {
        setOpenMobile(false);
      }
      navigateToThread(threadRef);
    },
    [
      clearSelection,
      isMobile,
      navigateToThread,
      rangeSelectTo,
      setOpenMobile,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = sidebarThreadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettingsConfirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedThreadKeys = new Set(threadKeys);
      for (const threadKey of threadKeys) {
        const thread = sidebarThreadByKeyRef.current.get(threadKey);
        if (!thread) continue;
        await deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
          deletedThreadKeys,
        });
      }
      removeFromSelection(threadKeys);
    },
    [
      appSettingsConfirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
    ],
  );

  const createThreadForProjectMember = useCallback(
    (member: SidebarProjectGroupMember) => {
      const projectRef = scopeProjectRef(member.environmentId, member.id);
      const currentRouteParams =
        router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const currentRouteTarget = resolveThreadRouteTarget(currentRouteParams);
      const currentActiveThread =
        currentRouteTarget?.kind === "server"
          ? (selectThreadByRef(useStore.getState(), currentRouteTarget.threadRef) ?? null)
          : null;
      const draftStore = useComposerDraftStore.getState();
      const currentActiveDraftThread =
        currentRouteTarget?.kind === "server"
          ? (draftStore.getDraftThread(currentRouteTarget.threadRef) ?? null)
          : currentRouteTarget?.kind === "draft"
            ? (draftStore.getDraftSession(currentRouteTarget.draftId) ?? null)
            : null;
      const seedContext = resolveSidebarNewThreadSeedContext({
        projectId: member.id,
        defaultEnvMode: resolveSidebarNewThreadEnvMode({
          defaultEnvMode: defaultThreadEnvMode,
        }),
        activeThread:
          currentActiveThread && currentActiveThread.projectId === member.id
            ? {
                projectId: currentActiveThread.projectId,
                branch: currentActiveThread.branch,
                worktreePath: currentActiveThread.worktreePath,
              }
            : null,
        activeDraftThread:
          currentActiveDraftThread && currentActiveDraftThread.projectId === member.id
            ? {
                projectId: currentActiveDraftThread.projectId,
                branch: currentActiveDraftThread.branch,
                worktreePath: currentActiveDraftThread.worktreePath,
                envMode: currentActiveDraftThread.envMode,
              }
            : null,
      });
      if (isMobile) {
        setOpenMobile(false);
      }
      setNewThreadScope({ kind: "project", projectRef });
      void handleNewThread(projectRef, {
        ...(seedContext.branch !== undefined ? { branch: seedContext.branch } : {}),
        ...(seedContext.worktreePath !== undefined
          ? { worktreePath: seedContext.worktreePath }
          : {}),
        envMode: seedContext.envMode,
      });
    },
    [defaultThreadEnvMode, handleNewThread, isMobile, router, setNewThreadScope, setOpenMobile],
  );

  const handleCreateThreadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (project.memberProjects.length === 1) {
        createThreadForProjectMember(project.memberProjects[0]!);
        return;
      }

      void (async () => {
        const api = readLocalApi();
        if (!api) {
          return;
        }
        const clicked = await api.contextMenu.show(
          project.memberProjects.map((member) => ({
            id: member.physicalProjectKey,
            label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
          })),
          {
            x: event.clientX,
            y: event.clientY,
          },
        );
        if (!clicked) {
          return;
        }
        const targetMember = project.memberProjects.find(
          (member) => member.physicalProjectKey === clicked,
        );
        if (!targetMember) {
          return;
        }
        createThreadForProjectMember(targetMember);
      })();
    },
    [createThreadForProjectMember, project.groupedProjectCount, project.memberProjects],
  );

  const attemptArchiveThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      try {
        await archiveThread(threadRef);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to archive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [archiveThread],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const threadKey = scopedThreadKey(threadRef);
      const finishRename = () => {
        setRenamingThreadKey((current) => {
          if (current !== threadKey) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: t("sidebar.thread.titleEmpty"),
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadRef.threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("sidebar.thread.renameFailed"),
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      finishRename();
    },
    [t],
  );

  const closeProjectRenameDialog = useCallback(() => {
    setProjectRenameTarget(null);
    setProjectRenameTitle("");
  }, []);

  const submitProjectRename = useCallback(async () => {
    if (!projectRenameTarget) {
      return;
    }

    const trimmed = projectRenameTitle.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project title cannot be empty",
      });
      return;
    }

    if (trimmed === projectRenameTarget.name) {
      closeProjectRenameDialog();
      return;
    }

    const api = readEnvironmentApi(projectRenameTarget.environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: "Project API unavailable.",
        }),
      );
      return;
    }

    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: projectRenameTarget.id,
        title: trimmed,
      });
      closeProjectRenameDialog();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [closeProjectRenameDialog, projectRenameTarget, projectRenameTitle]);

  const closeProjectGroupingDialog = useCallback(() => {
    setProjectGroupingTarget(null);
    setProjectGroupingSelection("inherit");
  }, []);

  const saveProjectGroupingPreference = useCallback(() => {
    if (!projectGroupingTarget) {
      return;
    }

    const overrideKey = deriveProjectGroupingOverrideKey(projectGroupingTarget);
    const nextOverrides = {
      ...projectGroupingSettings.sidebarProjectGroupingOverrides,
    };
    if (projectGroupingSelection === "inherit") {
      delete nextOverrides[overrideKey];
    } else {
      nextOverrides[overrideKey] = projectGroupingSelection;
    }
    updateSettings({
      sidebarProjectGroupingOverrides: nextOverrides,
    });
    closeProjectGroupingDialog();
  }, [
    closeProjectGroupingDialog,
    projectGroupingSelection,
    projectGroupingSettings.sidebarProjectGroupingOverrides,
    projectGroupingTarget,
    updateSettings,
  ]);

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return;
      const threadProject = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      const threadConversationWorkspacePath =
        thread.projectId === CONVERSATION_PROJECT_ID
          ? resolveConversationWorkspacePath(
              conversationWorkspaceDirByEnvironmentId.get(thread.environmentId),
              thread.id,
            )
          : undefined;
      const threadWorkspacePath =
        thread.projectId === CONVERSATION_PROJECT_ID
          ? (thread.worktreePath ?? threadConversationWorkspacePath ?? null)
          : (thread.worktreePath ?? threadProject?.cwd ?? project.cwd ?? null);
      const isPinned = pinnedThreadKeySet.has(threadKey);
      const clicked = await api.contextMenu.show(
        [
          {
            id: "pin",
            label: isPinned ? t("sidebar.thread.unpin") : t("sidebar.thread.pin"),
            icon: "pin",
          },
          { id: "rename", label: t("sidebar.thread.rename"), icon: "edit" },
          { id: "archive", label: t("sidebar.thread.archive"), icon: "archive" },
          { id: "mark-unread", label: t("sidebar.thread.markUnread") },
          {
            id: "open-path",
            label: t("sidebar.thread.openInExplorer"),
            icon: "folder-open",
            disabled: threadWorkspacePath === null,
          },
          {
            id: "copy-path",
            label: t("sidebar.thread.copyWorkspace"),
            icon: "copy",
            disabled: threadWorkspacePath === null,
          },
          { id: "copy-thread-id", label: t("sidebar.thread.copySessionId"), icon: "copy" },
        ] satisfies readonly ContextMenuItem<
          | "pin"
          | "rename"
          | "archive"
          | "mark-unread"
          | "open-path"
          | "copy-path"
          | "copy-thread-id"
        >[],
        position,
      );

      if (clicked === "pin") {
        setThreadPinned(threadKey, !isPinned);
        return;
      }

      if (clicked === "rename") {
        setRenamingThreadKey(threadKey);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "open-path" || clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: t("sidebar.thread.pathUnavailable"),
              description: t("sidebar.thread.pathUnavailableDescription"),
            }),
          );
          return;
        }
        if (clicked === "open-path") {
          await openWorkspaceDirectoryInExplorer({
            environmentId: thread.environmentId,
            path: threadWorkspacePath,
            openPath: api.shell.openPath,
          })
            .catch((error: unknown) => {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: t("sidebar.thread.pathOpenFailed"),
                  description: error instanceof Error ? error.message : threadWorkspacePath,
                }),
              );
            });
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked !== "archive") return;
      if (appSettingsConfirmThreadArchive) {
        const confirmed = await api.dialogs.confirm(
          [
            t("sidebar.thread.confirmArchiveTitle", { title: thread.title }),
            t("sidebar.thread.confirmArchiveDescription"),
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      try {
        await archiveThread(threadRef);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("sidebar.thread.archiveFailed"),
            description: error instanceof Error ? error.message : "归档对话时发生错误。",
          }),
        );
      }
    },
    [
      appSettingsConfirmThreadArchive,
      archiveThread,
      conversationWorkspaceDirByEnvironmentId,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      markThreadUnread,
      memberProjectByScopedKey,
      pinnedThreadKeySet,
      project.cwd,
      setThreadPinned,
      t,
    ],
  );

  return (
    <>
      <div className="group/project-header relative">
        <SidebarMenuButton
          ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
          size="sm"
          className="t3-sidebar-project-row h-7 cursor-default gap-2 rounded-[7px] px-2 py-0 pr-7 text-left text-[13px] font-normal leading-5 text-foreground/66 hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] hover:text-foreground/82 group-hover/project-header:text-foreground/82 max-sm:pr-14"
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
          onPointerDownCapture={handleProjectButtonPointerDownCapture}
          onClick={handleProjectButtonClick}
          onKeyDown={handleProjectButtonKeyDown}
          onContextMenu={handleProjectButtonContextMenu}
        >
          <SidebarProjectIcon project={project} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate text-[13px] font-normal leading-5 text-foreground/66 group-hover/project-header:text-foreground/82">
              {project.displayName}
            </span>
            {project.groupedProjectCount > 1 ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {project.groupedProjectCount} projects
              </span>
            ) : null}
          </span>
        </SidebarMenuButton>
        {/* 环境标记默认可见，悬停时与“新建对话”按钮做透明度切换。 */}
        {project.environmentPresence === "remote-only" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-label={
                    project.environmentPresence === "remote-only"
                      ? "Remote project"
                      : "Available in multiple environments"
                  }
                  className="pointer-events-none absolute top-1 right-1.5 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-opacity duration-150 max-sm:right-7 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0 max-sm:group-hover/project-header:opacity-100 max-sm:group-focus-within/project-header:opacity-100"
                />
              }
            >
              <CloudIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              Remote environment: {project.remoteEnvironmentLabels.join(", ")}
            </TooltipPopup>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="pointer-events-none absolute top-1 right-1.5 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
                <button
                  type="button"
                  aria-label={`Create new thread in ${project.displayName}`}
                  data-testid="new-thread-button"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={handleCreateThreadClick}
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              </div>
            }
          />
          <TooltipPopup side="top">
            {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
          </TooltipPopup>
        </Tooltip>
      </div>
      {projectContextMenuPosition ? (
        <ProjectContextMenu
          position={projectContextMenuPosition}
          labels={{
            pinProject: t("sidebar.pinProject"),
            openInExplorer: t("sidebar.openInExplorer"),
            renameProject: t("sidebar.renameProject"),
            projectGrouping: t("sidebar.projectGrouping"),
            archiveProjectThreads: t("sidebar.archiveProjectThreads"),
            removeProject: t("sidebar.removeProject"),
          }}
          onClose={closeProjectContextMenu}
          onPinProject={pinProjectToTop}
          onOpenInExplorer={openRepresentativeProjectInExplorer}
          onRenameProject={renameRepresentativeProject}
          onProjectGrouping={openRepresentativeProjectGrouping}
          onArchiveThreads={archiveVisibleProjectThreads}
          onRemoveProject={removeRepresentativeProject}
        />
      ) : null}

      <SidebarProjectThreadList
        projectKey={project.projectKey}
        projectExpanded={projectExpanded}
        hasOverflowingThreads={hasOverflowingThreads}
        hiddenThreadStatus={hiddenThreadStatus}
        orderedProjectThreadKeys={orderedProjectThreadKeys}
        renderedThreads={renderedThreads}
        showEmptyThreadState={showEmptyThreadState}
        shouldShowThreadPanel={shouldShowThreadPanel}
        isThreadListExpanded={isThreadListExpanded}
        projectCwd={project.cwd}
        activeRouteThreadKey={activeRouteThreadKey}
        pendingOpenThreadKey={pendingOpenThreadKey}
        threadJumpLabelByKey={threadJumpLabelByKey}
        appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
        renamingThreadKey={renamingThreadKey}
        renamingTitle={renamingTitle}
        setRenamingTitle={setRenamingTitle}
        renamingInputRef={renamingInputRef}
        renamingCommittedRef={renamingCommittedRef}
        confirmingArchiveThreadKey={confirmingArchiveThreadKey}
        setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
        confirmArchiveButtonRefs={confirmArchiveButtonRefs}
        attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
        handleThreadClick={handleThreadClick}
        navigateToThread={navigateToThread}
        handleMultiSelectContextMenu={handleMultiSelectContextMenu}
        handleThreadContextMenu={handleThreadContextMenu}
        clearSelection={clearSelection}
        commitRename={commitRename}
        cancelRename={cancelRename}
        attemptArchiveThread={attemptArchiveThread}
        openPrLink={openPrLink}
        expandThreadListForProject={expandThreadListForProject}
        collapseThreadListForProject={collapseThreadListForProject}
      />

      <Dialog
        open={projectRenameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectRenameDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              {projectRenameTarget
                ? `Update the title for ${projectRenameTarget.cwd}.`
                : "Update the project title."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Project title</span>
              <Input
                aria-label="Project title"
                value={projectRenameTitle}
                onChange={(event) => setProjectRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitProjectRename();
                  }
                }}
              />
            </div>
            {projectRenameTarget?.environmentLabel ? (
              <p className="text-xs text-muted-foreground">
                Environment: {projectRenameTarget.environmentLabel}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectRenameDialog}>
              Cancel
            </Button>
            <Button onClick={() => void submitProjectRename()}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={projectGroupingTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectGroupingDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Project grouping</DialogTitle>
            <DialogDescription>
              {projectGroupingTarget
                ? `Choose how ${projectGroupingTarget.cwd} should be grouped in the sidebar.`
                : "Choose how this project should be grouped in the sidebar."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Grouping rule</span>
              <Select
                value={projectGroupingSelection}
                onValueChange={(value) => {
                  if (
                    value === "inherit" ||
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  ) {
                    setProjectGroupingSelection(value);
                  }
                }}
              >
                <SelectTrigger className="w-full" aria-label="Project grouping rule">
                  <SelectValue>
                    {projectGroupingSelection === "inherit"
                      ? `Use global default (${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]})`
                      : PROJECT_GROUPING_MODE_LABELS[projectGroupingSelection]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="inherit">
                    Use global default
                  </SelectItem>
                  <SelectItem hideIndicator value="repository">
                    {PROJECT_GROUPING_MODE_LABELS.repository}
                  </SelectItem>
                  <SelectItem hideIndicator value="repository_path">
                    {PROJECT_GROUPING_MODE_LABELS.repository_path}
                  </SelectItem>
                  <SelectItem hideIndicator value="separate">
                    {PROJECT_GROUPING_MODE_LABELS.separate}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {projectGroupingSelection === "inherit"
                ? projectGroupingModeDescription(projectGroupingSettings.sidebarProjectGroupingMode)
                : projectGroupingModeDescription(projectGroupingSelection)}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectGroupingDialog}>
              Cancel
            </Button>
            <Button onClick={saveProjectGroupingPreference}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
});

const SidebarProjectListRow = memo(function SidebarProjectListRow(props: SidebarProjectItemProps) {
  return (
    <SidebarMenuItem className="rounded-md">
      <SidebarProjectItem {...props} />
    </SidebarMenuItem>
  );
});

function BahewMark() {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 rounded-[4px] object-contain"
      draggable={false}
      src="/apple-touch-icon.png"
    />
  );
}

type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: string;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const brandContent = (
    <>
      <BahewMark />
      <span className="truncate text-[12px] font-medium tracking-tight text-muted-foreground">
        {APP_BASE_NAME}
      </span>
      <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
        {APP_STAGE_LABEL}
      </span>
    </>
  );
  const wordmark = (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <SidebarTrigger className="shrink-0 md:hidden" />
      {isElectron ? (
        <div
          aria-label={`${APP_BASE_NAME} ${APP_STAGE_LABEL}`}
          className="ml-1 flex min-w-0 flex-1 select-none items-center gap-1.5 rounded-md"
        >
          {brandContent}
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                aria-label="Go to threads"
                className="ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2"
                draggable={false}
                to="/"
              >
                {brandContent}
              </Link>
            }
          />
          <TooltipPopup side="bottom" sideOffset={2}>
            Version {APP_VERSION}
          </TooltipPopup>
        </Tooltip>
      )}
      <SidebarAppUpdateButton />
    </div>
  );

  return isElectron ? (
    <SidebarHeader className="drag-region h-[38px] flex-row items-center gap-2 px-2 py-0 pl-[90px] wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+0.85em)]">
      {wordmark}
    </SidebarHeader>
  ) : (
    <SidebarHeader className="gap-1 px-2 py-1.5">{wordmark}</SidebarHeader>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  const { updateSettings } = useUpdateSettings();
  const layoutMode = useSettings((settings) => settings.layoutMode);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const publishedCommercialAuthState = usePublishedDesktopCommercialAuthState();
  const [commercialAuthState, setCommercialAuthState] = useState(() =>
    typeof window === "undefined" ? null : publishedCommercialAuthState,
  );
  const providerStatuses = useServerProviders();
  const codexProvider = providerStatuses.find((provider) => provider.driver === "codex") ?? null;
  const providerUsage = codexProvider?.auth.rateLimits?.usage ?? null;
  const accountLabel =
    commercialAuthState?.userLabel ??
    codexProvider?.auth.email ??
    codexProvider?.auth.label ??
    "Bahew account";
  const accountSecondaryLabel =
    codexProvider?.auth.email && codexProvider.auth.email !== accountLabel
      ? codexProvider.auth.email
      : (codexProvider?.auth.label ?? accountLabel);
  const accountPlanLabel =
    providerUsage?.planLabel ??
    (providerUsage?.plan ? formatPlanLabel(providerUsage.plan) : undefined) ??
    codexProvider?.auth.label ??
    "AI Plus";
  const accountAvatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
    accountLabel,
  )}`;
  const accountWebBaseUrl =
    commercialAuthState?.webAuthBaseUrl || DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL;
  const canSignOut =
    typeof window !== "undefined" && Boolean(window.desktopBridge?.signOutCommercialAuth);

  useEffect(() => {
    if (publishedCommercialAuthState) {
      setCommercialAuthState(publishedCommercialAuthState);
    }
  }, [publishedCommercialAuthState]);

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    if (!bridge?.getCommercialAuthState) {
      return;
    }

    let disposed = false;
    void bridge
      .getCommercialAuthState()
      .then((state) => {
        if (disposed) return;
        setCommercialAuthState(state);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, []);

  const handleOpenSettings = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    const url = resolveAccountActionUrl(accountWebBaseUrl, "/account/settings");
    openExternalAccountUrl(url);
  }, [accountWebBaseUrl, isMobile, setOpenMobile]);

  const handleOpenSystemSettings = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleSignOut = useCallback(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    if (!bridge?.signOutCommercialAuth || isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    void bridge
      .signOutCommercialAuth()
      .then((state) => {
        publishDesktopCommercialAuthState(state);
      })
      .catch((error: unknown) => {
        setIsSigningOut(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("sidebar.signOutFailed"),
            description: error instanceof Error ? error.message : t("sidebar.signOutFailed"),
          }),
        );
      });
  }, [isSigningOut, t]);

  const handleOpenBilling = useCallback(() => {
    const url = resolveAccountActionUrl(accountWebBaseUrl, "/account/billing");
    openExternalAccountUrl(url);
  }, [accountWebBaseUrl]);

  const handleOpenSupport = useCallback(() => {
    const url = resolveAccountActionUrl(accountWebBaseUrl, "/account/support");
    openExternalAccountUrl(url);
  }, [accountWebBaseUrl]);

  const handleOpenPlans = useCallback(() => {
    const url = resolveAccountActionUrl(accountWebBaseUrl, "/pricing");
    openExternalAccountUrl(url);
  }, [accountWebBaseUrl]);

  const handleOpenReferrals = useCallback(() => {
    const url = resolveAccountActionUrl(accountWebBaseUrl, "/account/settings?invite=1");
    openExternalAccountUrl(url);
  }, [accountWebBaseUrl]);

  return (
    <SidebarFooter className="t3-project-sidebar-footer px-2 py-1">
      <SidebarProviderUpdatePill />
      <div className="flex items-center justify-between gap-1.5">
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 rounded-[7px] px-1.5 py-1 text-[13px] font-normal text-muted-foreground/78 hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-foreground/86"
              />
            }
          >
            <SettingsIcon className="size-3.5" />
            <span>{t("sidebar.settings")}</span>
          </MenuTrigger>
          <MenuPopup
            align="start"
            side="top"
            sideOffset={8}
            className="w-[324px] overflow-hidden rounded-[20px] border-zinc-200 bg-white p-0 shadow-[0px_8px_32px_0px_rgba(0,0,0,0.08)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0px_8px_32px_0px_rgba(0,0,0,0.3)] [&>div]:p-0"
          >
            <MenuGroup>
              <div className="flex min-w-0 items-center gap-3 border-zinc-200 border-b px-4 py-4 dark:border-zinc-800">
                <div className="size-10 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <img
                    alt={accountLabel}
                    className="size-full"
                    draggable={false}
                    src={accountAvatarUrl}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[14px] font-semibold leading-5 text-zinc-900 dark:text-zinc-100"
                    title={accountLabel}
                  >
                    {accountLabel}
                  </div>
                  <div className="truncate text-[12px] leading-[18px] text-zinc-500 dark:text-zinc-400">
                    {accountSecondaryLabel}
                  </div>
                </div>
                <div className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                  {accountPlanLabel}
                </div>
              </div>
              <MenuSeparator className="mx-0 my-0 bg-zinc-200 dark:bg-zinc-800" />
              <div className="space-y-1 p-3">
                <MenuSub>
                  <MenuSubTrigger className="min-h-11 rounded-xl px-3 text-[13px] font-medium text-zinc-800 data-highlighted:bg-zinc-100 data-popup-open:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800 dark:data-popup-open:bg-zinc-800">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      <SparklesIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">剩余用量</span>
                  </MenuSubTrigger>
                  <MenuSubPopup className="w-[324px] overflow-hidden rounded-[20px] border-zinc-200 bg-white p-0 shadow-[0px_8px_32px_0px_rgba(0,0,0,0.08)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0px_8px_32px_0px_rgba(0,0,0,0.3)] [&>div]:p-0">
                    <AccountUsageCard
                      credits={codexProvider?.auth.rateLimits?.credits ?? null}
                      providerUsage={providerUsage}
                      onInvite={handleOpenReferrals}
                      onUpgrade={handleOpenPlans}
                    />
                  </MenuSubPopup>
                </MenuSub>
                <MenuItem
                  className="min-h-11 rounded-xl px-3 text-[13px] font-medium text-zinc-800 data-highlighted:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800"
                  onClick={handleOpenSettings}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <CircleUserRoundIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">个人设置</span>
                  <ExternalLinkIcon className="size-3.5 text-zinc-400 opacity-70" />
                </MenuItem>
                <MenuItem
                  className="min-h-11 rounded-xl px-3 text-[13px] font-medium text-zinc-800 data-highlighted:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800"
                  onClick={handleOpenBilling}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <CreditCardIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">订阅与账单</span>
                  <ExternalLinkIcon className="size-3.5 text-zinc-400 opacity-70" />
                </MenuItem>
                <MenuItem
                  className="min-h-11 rounded-xl px-3 text-[13px] font-medium text-zinc-800 data-highlighted:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800"
                  onClick={handleOpenSupport}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <HelpCircleIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">帮助与支持</span>
                  <ExternalLinkIcon className="size-3.5 text-zinc-400 opacity-70" />
                </MenuItem>
                <MenuSeparator className="mx-2 my-2 bg-zinc-200 dark:bg-zinc-800" />
                <MenuItem
                  className="min-h-11 rounded-xl px-3 text-[13px] font-medium text-zinc-800 data-highlighted:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800"
                  onClick={handleOpenSystemSettings}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <SettingsIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">系统设置</span>
                </MenuItem>
                {canSignOut ? (
                  <MenuItem
                    className="min-h-11 rounded-xl px-3 text-[13px] font-medium data-[variant=destructive]:text-red-600 data-highlighted:bg-red-50 dark:data-[variant=destructive]:text-red-400 dark:data-highlighted:bg-red-950/30"
                    disabled={isSigningOut}
                    onClick={handleSignOut}
                    variant="destructive"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400">
                      <LogOutIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      {isSigningOut ? t("sidebar.signingOut") : t("sidebar.signOut")}
                    </span>
                  </MenuItem>
                ) : null}
              </div>
            </MenuGroup>
          </MenuPopup>
        </Menu>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={layoutMode === "cursor" ? "切换到默认布局" : "切换到 Code 模式"}
          className="size-7 rounded-[7px] text-muted-foreground/78 hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-foreground/86"
          onClick={() =>
            updateSettings({ layoutMode: layoutMode === "cursor" ? "codex" : "cursor" })
          }
        >
          <PanelLeftIcon className="size-3.5" />
        </Button>
      </div>
    </SidebarFooter>
  );
});

type CommercialAccountUsage = Awaited<
  ReturnType<NonNullable<NonNullable<Window["desktopBridge"]>["getCommercialAccountUsage"]>>
>;

type CommercialUsageLike = NonNullable<NonNullable<ServerProvider["auth"]["rateLimits"]>["usage"]>;

function normalizeCommercialUsage(
  usage: CommercialAccountUsage | CommercialUsageLike | null | undefined,
): CommercialAccountUsage | null {
  if (!usage?.currentWindow || !usage.weeklyWindow) {
    return null;
  }

  return {
    balance: "balance" in usage ? (usage.balance ?? null) : null,
    plan:
      usage.plan === "free" || usage.plan === "plus" || usage.plan === "pro" ? usage.plan : "plus",
    planLabel: usage.planLabel ?? "AI Plus",
    planMultiplier: usage.planMultiplier ?? (usage.plan === "pro" ? 4 : 2),
    currentWindow: usage.currentWindow,
    weeklyWindow: usage.weeklyWindow,
    totalTokens: usage.totalTokens,
    todayTokens: usage.todayTokens ?? null,
    totalActualCost: usage.totalActualCost ?? null,
    todayActualCost: usage.todayActualCost ?? null,
  } satisfies CommercialAccountUsageSchema;
}

function AccountUsageCard(props: {
  credits: NonNullable<ServerProvider["auth"]["rateLimits"]>["credits"] | null;
  providerUsage: CommercialUsageLike | null;
  onInvite: () => void;
  onUpgrade: () => void;
}) {
  const [usage, setUsage] = useState<CommercialAccountUsage | undefined>(undefined);

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    const getCommercialAccountUsage = bridge?.getCommercialAccountUsage;
    if (!getCommercialAccountUsage) {
      return;
    }

    let disposed = false;
    const refreshUsage = () => {
      void getCommercialAccountUsage()
        .then((value) => {
          if (!disposed) {
            setUsage(value);
          }
        })
        .catch(() => {
          if (!disposed) {
            setUsage(null);
          }
        });
    };

    refreshUsage();
    const interval = window.setInterval(refreshUsage, 10_000);
    const onFocus = () => refreshUsage();
    window.addEventListener("focus", onFocus);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (usage === undefined && props.providerUsage) {
      setUsage(normalizeCommercialUsage(props.providerUsage));
    }
  }, [props.providerUsage, usage]);

  const resolvedUsage = usage ?? props.providerUsage;
  const currentWindow = resolvedUsage?.currentWindow ?? null;
  const weeklyWindow = resolvedUsage?.weeklyWindow ?? null;
  const planLabel =
    resolvedUsage?.planLabel ??
    (resolvedUsage?.plan ? formatPlanLabel(resolvedUsage.plan) : "AI Plus");
  const multiplier = resolvedUsage?.planMultiplier ?? (resolvedUsage?.plan === "pro" ? 4 : 2);
  const resolvedBalance =
    resolvedUsage && "balance" in resolvedUsage && typeof resolvedUsage.balance === "number"
      ? resolvedUsage.balance
      : null;
  const balanceLabel = formatCreditBalance(resolvedBalance, props.credits?.balance);
  const nearLimit =
    (currentWindow ? clampUsagePercent(currentWindow.usedPercent) >= 85 : false) ||
    (weeklyWindow ? clampUsagePercent(weeklyWindow.usedPercent) >= 85 : false);
  const limitReached =
    (currentWindow ? clampUsagePercent(currentWindow.usedPercent) >= 100 : false) ||
    (weeklyWindow ? clampUsagePercent(weeklyWindow.usedPercent) >= 100 : false);
  const nextPlan = resolvedUsage?.plan === "free" ? "AI Plus" : "AI Pro";
  const canUpgrade = resolvedUsage?.plan !== "pro";

  return (
    <div className="px-3 py-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
              用量限制
            </div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {planLabel} · 标准限额的 {formatUsageMultiplier(multiplier)} 倍
            </div>
          </div>
          {nearLimit ? (
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <SparklesIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">可用积分余额</span>
          <span className="shrink-0 font-semibold tabular-nums">{balanceLabel}</span>
        </div>
        <UsageLimitRow
          className="mt-4"
          label="当前用量"
          loading={usage === undefined && props.providerUsage === null}
          window={currentWindow}
        />
        <UsageLimitRow
          className="mt-4"
          label="每周上限"
          loading={usage === undefined && props.providerUsage === null}
          window={weeklyWindow}
        />

        {limitReached || nearLimit ? (
          <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-[18px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            当前额度紧张时，除了升级订阅，也可以邀请好友获得奖励积分继续使用。
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-2">
          {canUpgrade ? (
            <button
              type="button"
              onClick={props.onUpgrade}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-800 transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            >
              升级到 {nextPlan}
              <ArrowUpRight className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={props.onInvite}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zinc-800 active:bg-zinc-950 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Share2Icon className="size-3.5" />
            邀请好友赚积分
          </button>
        </div>
      </div>
    </div>
  );
}

function UsageLimitRow(props: {
  className?: string;
  label: string;
  loading: boolean;
  window: CommercialUsageLike["currentWindow"] | null | undefined;
}) {
  const percent = props.window ? clampUsagePercent(props.window.usedPercent) : 0;
  const resetLabel = formatResetTime(props.window?.resetsAt ?? null);

  return (
    <div className={props.className}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{props.label}</span>
        <span className="ml-auto font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
          {props.loading ? "--" : `${Math.round(percent)}%`}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            percent >= 90 ? "bg-red-500" : "bg-zinc-950 dark:bg-white",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="tabular-nums">
          {props.loading || !props.window
            ? "加载中"
            : `${formatUsageUnits(props.window.usedUnits)} / ${formatUsageUnits(
                props.window.limitUnits,
              )} units`}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
          <RefreshCwIcon className="size-3" />
          {resetLabel}
        </span>
      </div>
    </div>
  );
}

function clampUsagePercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatPlanLabel(plan: string): string {
  switch (plan) {
    case "plus":
      return "AI Plus";
    case "pro":
      return "AI Pro";
    default:
      return "Free";
  }
}

function formatUsageMultiplier(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "1";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatUsageUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatCreditBalance(value: number | null | undefined, fallback?: string | null): string {
  if (value !== null && value !== undefined && Number.isFinite(value)) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  const normalized = fallback?.trim();
  if (normalized) return normalized.replace(/^\$/, "");
  return "0";
}

function formatResetTime(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function resolveAccountActionUrl(baseUrl: string | null | undefined, path: string): string {
  const fallback = new URL(path, DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL).toString();
  if (!baseUrl) {
    return fallback;
  }

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return fallback;
  }
}

function openExternalAccountUrl(url: string): void {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  if (bridge?.openExternal) {
    void bridge.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

interface SidebarProjectsContentProps {
  showArm64IntelBuildWarning: boolean;
  arm64IntelBuildWarningDescription: string | null;
  desktopUpdateButtonAction: "download" | "install" | "none";
  desktopUpdateButtonDisabled: boolean;
  handleDesktopUpdateButtonClick: () => void;
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  projectGroupingMode: SidebarProjectGroupingMode;
  threadPreviewCount: SidebarThreadPreviewCount;
  updateSettings: ReturnType<typeof useUpdateSettings>["updateSettings"];
  isManualProjectSorting: boolean;
  projectDnDSensors: ReturnType<typeof useSensors>;
  projectCollisionDetection: CollisionDetection;
  handleProjectDragStart: (event: DragStartEvent) => void;
  handleProjectDragEnd: (event: DragEndEvent) => void;
  handleProjectDragCancel: (event: DragCancelEvent) => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  sortedProjects: readonly SidebarProjectSnapshot[];
  expandedThreadListsByProject: ReadonlySet<string>;
  activeRouteProjectKey: string | null;
  routeThreadKey: string | null;
  pendingOpenThreadKey: string | null;
  newThreadShortcutLabel: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void;
  projectsLength: number;
  pinnedThreads: readonly SidebarThreadSummary[];
  pinnedThreadKeySet: ReadonlySet<string>;
  conversationWorkspaceDirByEnvironmentId: ReadonlyMap<EnvironmentId, string>;
  globalThreads: readonly SidebarThreadSummary[];
  isProjectsSectionExpanded: boolean;
  isPinnedSectionExpanded: boolean;
  isConversationsSectionExpanded: boolean;
  setProjectsSectionExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setPinnedSectionExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setConversationsSectionExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

function SidebarSectionTitle({
  action,
  children,
  draggable = false,
  expanded,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  draggable?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}) {
  const ExpandIcon = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      className={cn(
        "group/section-title mb-1 flex h-6 items-center justify-between px-0",
        draggable ? "cursor-default" : "",
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="inline-flex min-w-0 cursor-default items-center gap-1 rounded-md text-[13px] font-normal text-muted-foreground/72 outline-hidden transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onToggle}
      >
        <span className="truncate">{children}</span>
        <ExpandIcon className="size-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover/section-title:opacity-100 group-focus-within/section-title:opacity-100" />
      </button>
      {action ? (
        <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/section-title:pointer-events-auto group-hover/section-title:opacity-100 group-focus-within/section-title:pointer-events-auto group-focus-within/section-title:opacity-100">
          {action}
        </div>
      ) : null}
    </div>
  );
}

function SidebarNavButton({
  icon: Icon,
  isActive = false,
  label,
  trailing,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
  label: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  const buttonRender = useMemo(() => <button type="button" />, []);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={buttonRender}
        size="sm"
        isActive={isActive}
        className="t3-sidebar-nav-row h-7.5 gap-2 rounded-[7px] px-2 text-[13px] font-normal text-foreground/82 hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-foreground focus-visible:ring-0"
        onClick={onClick}
      >
        <Icon className="size-3.5 text-foreground/72" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {trailing ? (
          <span className="ml-auto shrink-0 text-[12px] text-muted-foreground/60">{trailing}</span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const SidebarProjectsContent = memo(function SidebarProjectsContent(
  props: SidebarProjectsContentProps,
) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const setNewThreadScope = useUiStateStore((state) => state.setNewThreadScope);
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [isProjectDropActive, setIsProjectDropActive] = useState(false);
  const defaultSidebarSectionOrder = useCursorLayoutStore(
    (state) => state.defaultSidebarSectionOrder,
  );
  const setDefaultSidebarSectionOrder = useCursorLayoutStore(
    (state) => state.setDefaultSidebarSectionOrder,
  );
  const draggedDefaultSidebarSectionRef = useRef<DefaultSidebarSectionId | null>(null);
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const {
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    handleDesktopUpdateButtonClick,
    isManualProjectSorting,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    handleNewThread,
    archiveThread,
    deleteThread,
    navigateToThread,
    sortedProjects,
    expandedThreadListsByProject,
    activeRouteProjectKey,
    routeThreadKey,
    pendingOpenThreadKey,
    newThreadShortcutLabel,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    attachProjectListAutoAnimateRef,
    projectsLength,
    pinnedThreads,
    pinnedThreadKeySet,
    conversationWorkspaceDirByEnvironmentId,
    globalThreads,
    isProjectsSectionExpanded,
    isPinnedSectionExpanded,
    isConversationsSectionExpanded,
    setProjectsSectionExpanded,
    setPinnedSectionExpanded,
    setConversationsSectionExpanded,
  } = props;
  const defaultSidebarSectionOrderIndex = useMemo(
    () =>
      new Map(defaultSidebarSectionOrder.map((sectionId, index) => [sectionId, index] as const)),
    [defaultSidebarSectionOrder],
  );
  const moveDefaultSidebarSection = useCallback(
    (draggedSection: DefaultSidebarSectionId, targetSection: DefaultSidebarSectionId) => {
      if (draggedSection === targetSection) {
        return;
      }
      const nextOrder = defaultSidebarSectionOrder.filter(
        (sectionId) => sectionId !== draggedSection,
      );
      const targetIndex = nextOrder.indexOf(targetSection);
      if (targetIndex < 0) {
        return;
      }
      nextOrder.splice(targetIndex, 0, draggedSection);
      setDefaultSidebarSectionOrder(nextOrder);
    },
    [defaultSidebarSectionOrder, setDefaultSidebarSectionOrder],
  );
  const handleDefaultSectionDragStart = useCallback(
    (sectionId: DefaultSidebarSectionId, event: React.DragEvent<HTMLDivElement>) => {
      draggedDefaultSidebarSectionRef.current = sectionId;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-t3code-default-sidebar-section", sectionId);
    },
    [],
  );
  const handleDefaultSectionDrop = useCallback(
    (sectionId: DefaultSidebarSectionId, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const draggedSection =
        (event.dataTransfer.getData(
          "application/x-t3code-default-sidebar-section",
        ) as DefaultSidebarSectionId) || draggedDefaultSidebarSectionRef.current;
      draggedDefaultSidebarSectionRef.current = null;
      if (draggedSection === "projects" || draggedSection === "conversations") {
        moveDefaultSidebarSection(draggedSection, sectionId);
      }
    },
    [moveDefaultSidebarSection],
  );
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);
  const confirmThreadArchive = useSettings((s) => s.confirmThreadArchive);
  const [isGlobalThreadListExpanded, setIsGlobalThreadListExpanded] = useState(false);
  const [isPinnedThreadListExpanded, setIsPinnedThreadListExpanded] = useState(false);
  const sidebarThreadPreviewCount = useSettings((s) => s.sidebarThreadPreviewCount);
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const setThreadPinned = useUiStateStore((state) => state.setThreadPinned);

  const pinnedThreadKeys = useMemo(
    () => pinnedThreads.map((t) => scopedThreadKey(scopeThreadRef(t.environmentId, t.id))),
    [pinnedThreads],
  );
  const pinnedThreadVisibility = useMemo(() => {
    const activeThreadId =
      routeThreadKey === null
        ? undefined
        : (pinnedThreads.find(
            (thread) =>
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
          )?.id ?? undefined);
    return getVisibleThreadsForProject({
      threads: pinnedThreads,
      activeThreadId,
      isThreadListExpanded: isPinnedThreadListExpanded,
      previewLimit: sidebarThreadPreviewCount,
    });
  }, [isPinnedThreadListExpanded, pinnedThreads, routeThreadKey, sidebarThreadPreviewCount]);
  const hiddenPinnedThreadStatus = useMemo(
    () =>
      resolveProjectStatusIndicator(
        pinnedThreadVisibility.hiddenThreads.map((thread) => {
          const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          const lastVisitedAt = threadLastVisitedAtById[threadKey];
          return resolveThreadStatusPill({
            thread: {
              ...thread,
              ...(lastVisitedAt ? { lastVisitedAt } : {}),
            },
          });
        }),
      ),
    [pinnedThreadVisibility.hiddenThreads, threadLastVisitedAtById],
  );

  const globalThreadKeys = useMemo(
    () => globalThreads.map((t) => scopedThreadKey(scopeThreadRef(t.environmentId, t.id))),
    [globalThreads],
  );
  const globalThreadVisibility = useMemo(() => {
    const activeThreadId =
      routeThreadKey === null
        ? undefined
        : (globalThreads.find(
            (thread) =>
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
          )?.id ?? undefined);
    return getVisibleThreadsForProject({
      threads: globalThreads,
      activeThreadId,
      isThreadListExpanded: isGlobalThreadListExpanded,
      previewLimit: sidebarThreadPreviewCount,
    });
  }, [globalThreads, isGlobalThreadListExpanded, routeThreadKey, sidebarThreadPreviewCount]);
  const hiddenGlobalThreadStatus = useMemo(
    () =>
      resolveProjectStatusIndicator(
        globalThreadVisibility.hiddenThreads.map((thread) => {
          const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          const lastVisitedAt = threadLastVisitedAtById[threadKey];
          return resolveThreadStatusPill({
            thread: {
              ...thread,
              ...(lastVisitedAt ? { lastVisitedAt } : {}),
            },
          });
        }),
      ),
    [globalThreadVisibility.hiddenThreads, threadLastVisitedAtById],
  );

  const handleGlobalThreadClick = useCallback(
    (event: React.MouseEvent, threadRef: ScopedThreadRef, orderedKeys: readonly string[]) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const threadKey = scopedThreadKey(threadRef);

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedKeys);
        return;
      }

      clearSelection();
      setSelectionAnchor(threadKey);
      navigateToThread(threadRef);
    },
    [clearSelection, navigateToThread, rangeSelectTo, setSelectionAnchor, toggleThreadSelection],
  );

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadKey, setConfirmingArchiveThreadKey] = useState<string | null>(null);
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: t("sidebar.thread.idCopied"),
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("sidebar.thread.idCopyFailed"),
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: t("sidebar.thread.pathCopied"),
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("sidebar.thread.pathCopyFailed"),
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });

  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const projectCwdByScopedProjectKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project.cwd,
        ]),
      ),
    [projects],
  );
  const conversationThreadByKey = useMemo(
    () =>
      new Map(
        [...pinnedThreads, ...globalThreads].map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [globalThreads, pinnedThreads],
  );
  const openThreadPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, []);

  const handleGlobalThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = conversationThreadByKey.get(threadKey);
      if (!thread) return;
      const threadConversationWorkspacePath =
        thread.projectId === CONVERSATION_PROJECT_ID
          ? resolveConversationWorkspacePath(
              conversationWorkspaceDirByEnvironmentId.get(thread.environmentId),
              thread.id,
            )
          : undefined;
      const threadWorkspacePath =
        thread.projectId === CONVERSATION_PROJECT_ID
          ? (thread.worktreePath ?? threadConversationWorkspacePath ?? null)
          : (thread.worktreePath ??
            projectCwdByScopedProjectKey.get(
              scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
            ) ??
            null);
      const isPinned = pinnedThreadKeySet.has(threadKey);

      const clicked = await api.contextMenu.show(
        [
          {
            id: "pin",
            label: isPinned ? t("sidebar.thread.unpin") : t("sidebar.thread.pin"),
            icon: "pin",
          },
          { id: "rename", label: t("sidebar.thread.rename"), icon: "edit" },
          { id: "archive", label: t("sidebar.thread.archive"), icon: "archive" },
          { id: "mark-unread", label: t("sidebar.thread.markUnread") },
          {
            id: "open-path",
            label: t("sidebar.thread.openInExplorer"),
            icon: "folder-open",
            disabled: threadWorkspacePath === null,
          },
          {
            id: "copy-path",
            label: t("sidebar.thread.copyWorkspace"),
            icon: "copy",
            disabled: threadWorkspacePath === null,
          },
          { id: "copy-thread-id", label: t("sidebar.thread.copySessionId"), icon: "copy" },
        ] satisfies readonly ContextMenuItem<
          | "pin"
          | "rename"
          | "archive"
          | "mark-unread"
          | "open-path"
          | "copy-path"
          | "copy-thread-id"
        >[],
        position,
      );

      if (clicked === "pin") {
        setThreadPinned(threadKey, !isPinned);
        return;
      }

      if (clicked === "rename") {
        setRenamingThreadKey(threadKey);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "open-path" || clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: t("sidebar.thread.pathUnavailable"),
              description: t("sidebar.thread.pathUnavailableDescription"),
            }),
          );
          return;
        }
        if (clicked === "open-path") {
          await openWorkspaceDirectoryInExplorer({
            environmentId: thread.environmentId,
            path: threadWorkspacePath,
            openPath: api.shell.openPath,
          })
            .catch((error: unknown) => {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: t("sidebar.thread.pathOpenFailed"),
                  description: error instanceof Error ? error.message : threadWorkspacePath,
                }),
              );
            });
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked !== "archive") return;
      if (confirmThreadArchive) {
        const confirmed = await api.dialogs.confirm(
          [
            t("sidebar.thread.confirmArchiveTitle", { title: thread.title }),
            t("sidebar.thread.confirmArchiveDescription"),
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      try {
        await archiveThread(threadRef);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("sidebar.thread.archiveFailed"),
            description: error instanceof Error ? error.message : "归档对话时发生错误。",
          }),
        );
      }
    },
    [
      archiveThread,
      confirmThreadArchive,
      conversationWorkspaceDirByEnvironmentId,
      conversationThreadByKey,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      markThreadUnread,
      pinnedThreadKeySet,
      projectCwdByScopedProjectKey,
      setThreadPinned,
      t,
    ],
  );

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const threadKey = scopedThreadKey(threadRef);
      const finishRename = () => {
        setRenamingThreadKey((current) => (current === threadKey ? null : current));
        renamingCommittedRef.current = false;
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: t("sidebar.thread.titleEmpty"),
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }

      try {
        const api = readEnvironmentApi(threadRef.environmentId);
        if (!api) {
          finishRename();
          return;
        }
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadRef.threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("sidebar.thread.renameFailed"),
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      finishRename();
    },
    [t],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
  }, []);
  const openConversationThread = useCallback(() => {
    void startNewConversationThread({
      environmentId: primaryEnvironmentId,
      setNewThreadScope,
      navigateToConversationHome: () => navigate({ to: "/" }),
    });
  }, [navigate, primaryEnvironmentId, setNewThreadScope]);
  const handleCreateGlobalThread = useCallback(() => {
    openConversationThread();
  }, [openConversationThread]);
  const handleCreateConversationThread = useCallback(() => {
    openConversationThread();
  }, [openConversationThread]);
  const handleOpenExtensions = useCallback(() => {
    void navigate({ to: "/extensions" });
  }, [navigate]);
  const handleOpenPullRequests = useCallback(() => {
    void navigate({ to: "/settings/source-control" });
  }, [navigate]);
  const handleOpenAutomation = useCallback(() => {
    void navigate({ to: "/automations" });
  }, [navigate]);
  const addExternalProjectsFromDrop = useCallback(
    async (event: React.DragEvent) => {
      if (!primaryEnvironmentId) {
        throw new Error("No local environment is available.");
      }
      const paths = getExternalFolderPathsFromDrop(event);
      if (paths.length === 0) {
        throw new Error("The desktop drag payload did not include a folder path.");
      }
      const createdProjectIds = await Promise.all(
        paths.map((rawPath) =>
          ensureCursorProjectForPath({
            environmentId: primaryEnvironmentId,
            rawPath,
            projects,
            pinToExplorer: false,
          }),
        ),
      );
      const projectId = createdProjectIds[0];
      if (projectId) {
        const projectRef = scopeProjectRef(primaryEnvironmentId, projectId);
        setNewThreadScope({ kind: "project", projectRef });
        void handleNewThread(projectRef, { envMode: defaultThreadEnvMode });
      }
      toastManager.add({
        type: "success",
        title: paths.length === 1 ? "Project added" : "Projects added",
      });
    },
    [defaultThreadEnvMode, handleNewThread, primaryEnvironmentId, projects, setNewThreadScope],
  );

  return (
    <SidebarContent hideScrollbars={false} className="t3-project-sidebar gap-0">
      <SidebarGroup className="px-1.5 pt-2 pb-2">
        <SidebarMenu className="gap-0.5">
          <SidebarNavButton
            icon={MessageCircleIcon}
            label={t("sidebar.quickConversation")}
            onClick={handleCreateGlobalThread}
          />
          <SidebarMenuItem>
            <CommandDialogTrigger
              render={
                <SidebarMenuButton
                  size="sm"
                  className="t3-sidebar-nav-row h-7.5 gap-2 rounded-[7px] px-2 text-[13px] font-normal text-foreground/82 hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-foreground focus-visible:ring-0"
                  data-testid="command-palette-trigger"
                />
              }
            >
              <SearchIcon className="size-3.5 text-foreground/72" />
              <span className="min-w-0 flex-1 truncate text-left">{t("sidebar.search")}</span>
            </CommandDialogTrigger>
          </SidebarMenuItem>
          <SidebarNavButton
            icon={BlocksIcon}
            isActive={pathname.startsWith("/extensions")}
            label={t("sidebar.plugins")}
            onClick={handleOpenExtensions}
          />
          <SidebarNavButton
            icon={GitPullRequestIcon}
            label={t("sidebar.pullRequests")}
            onClick={handleOpenPullRequests}
          />
          <SidebarNavButton
            icon={Clock3Icon}
            isActive={pathname.startsWith("/automations")}
            label={t("sidebar.automations")}
            onClick={handleOpenAutomation}
          />
        </SidebarMenu>
      </SidebarGroup>
      {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
        <SidebarGroup className="px-2 pt-1.5 pb-0">
          <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
            <TriangleAlertIcon />
            <AlertTitle>Intel build on Apple Silicon</AlertTitle>
            <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
            {desktopUpdateButtonAction !== "none" ? (
              <AlertAction>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={desktopUpdateButtonDisabled}
                  onClick={handleDesktopUpdateButtonClick}
                >
                  {desktopUpdateButtonAction === "download"
                    ? "Download ARM build"
                    : "Install ARM build"}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        </SidebarGroup>
      ) : null}
      <SidebarGroup
        className="px-1.5 py-0.5"
        style={{ order: 20 + (defaultSidebarSectionOrderIndex.get("projects") ?? 0) }}
      >
        <SidebarSectionTitle
          draggable
          expanded={isProjectsSectionExpanded}
          onToggle={() => setProjectsSectionExpanded((expanded) => !expanded)}
          onDragStart={(event) => handleDefaultSectionDragStart("projects", event)}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("application/x-t3code-default-sidebar-section")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => handleDefaultSectionDrop("projects", event)}
          action={
            <Tooltip>
              <TooltipTrigger
                render={
                  <AddProjectMenu
                    title={t("sidebar.addProject")}
                    pinToCursorExplorer={false}
                    trigger={
                      <button
                        type="button"
                        aria-label={t("sidebar.addProject")}
                        data-testid="sidebar-add-project-trigger"
                        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-accent/45 hover:text-foreground"
                      >
                        <FolderPlusIcon className="size-3.5" />
                      </button>
                    }
                  />
                }
              />
              <TooltipPopup side="right">{t("sidebar.addProject")}</TooltipPopup>
            </Tooltip>
          }
        >
          {t("sidebar.projects")}
        </SidebarSectionTitle>

        {isProjectsSectionExpanded ? (
          <>
            <div
              className={cn(isProjectDropActive ? "rounded-lg bg-accent/30" : "")}
              onDragEnter={(event) => {
                if (hasExternalFolderDrop(event)) {
                  event.preventDefault();
                  setIsProjectDropActive(true);
                }
              }}
              onDragOver={(event) => {
                if (hasExternalFolderDrop(event)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setIsProjectDropActive(false);
                }
              }}
              onDrop={(event) => {
                if (!hasExternalFolderDrop(event)) {
                  return;
                }
                event.preventDefault();
                setIsProjectDropActive(false);
                void addExternalProjectsFromDrop(event).catch((error) => {
                  toastManager.add({
                    type: "error",
                    title: "Could not add dropped folder",
                    description:
                      error instanceof Error ? error.message : "The folder could not be added.",
                  });
                });
              }}
            >
              {isManualProjectSorting ? (
                <DndContext
                  sensors={projectDnDSensors}
                  collisionDetection={projectCollisionDetection}
                  modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                  onDragStart={handleProjectDragStart}
                  onDragEnd={handleProjectDragEnd}
                  onDragCancel={handleProjectDragCancel}
                >
                  <SidebarMenu className="gap-0.5">
                    <SortableContext
                      items={sortedProjects.map((project) => project.projectKey)}
                      strategy={verticalListSortingStrategy}
                    >
                      {sortedProjects.map((project) => (
                        <SortableProjectItem
                          key={project.projectKey}
                          projectId={project.projectKey}
                        >
                          {(dragHandleProps) => (
                            <SidebarProjectItem
                              project={project}
                              isThreadListExpanded={expandedThreadListsByProject.has(
                                project.projectKey,
                              )}
                              activeRouteThreadKey={
                                activeRouteProjectKey === project.projectKey ? routeThreadKey : null
                              }
                              pendingOpenThreadKey={pendingOpenThreadKey}
                              pinnedThreadKeySet={pinnedThreadKeySet}
                              conversationWorkspaceDirByEnvironmentId={
                                conversationWorkspaceDirByEnvironmentId
                              }
                              newThreadShortcutLabel={newThreadShortcutLabel}
                              handleNewThread={handleNewThread}
                              archiveThread={archiveThread}
                              deleteThread={deleteThread}
                              navigateToThread={navigateToThread}
                              threadJumpLabelByKey={threadJumpLabelByKey}
                              attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                              expandThreadListForProject={expandThreadListForProject}
                              collapseThreadListForProject={collapseThreadListForProject}
                              dragInProgressRef={dragInProgressRef}
                              suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                              suppressProjectClickForContextMenuRef={
                                suppressProjectClickForContextMenuRef
                              }
                              isManualProjectSorting={isManualProjectSorting}
                              dragHandleProps={dragHandleProps}
                            />
                          )}
                        </SortableProjectItem>
                      ))}
                    </SortableContext>
                  </SidebarMenu>
                </DndContext>
              ) : (
                <SidebarMenu ref={attachProjectListAutoAnimateRef} className="gap-0.5">
                  {sortedProjects.map((project) => (
                    <SidebarProjectListRow
                      key={project.projectKey}
                      project={project}
                      isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
                      activeRouteThreadKey={
                        activeRouteProjectKey === project.projectKey ? routeThreadKey : null
                      }
                      pendingOpenThreadKey={pendingOpenThreadKey}
                      pinnedThreadKeySet={pinnedThreadKeySet}
                      conversationWorkspaceDirByEnvironmentId={
                        conversationWorkspaceDirByEnvironmentId
                      }
                      newThreadShortcutLabel={newThreadShortcutLabel}
                      handleNewThread={handleNewThread}
                      archiveThread={archiveThread}
                      deleteThread={deleteThread}
                      navigateToThread={navigateToThread}
                      threadJumpLabelByKey={threadJumpLabelByKey}
                      attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                      expandThreadListForProject={expandThreadListForProject}
                      collapseThreadListForProject={collapseThreadListForProject}
                      dragInProgressRef={dragInProgressRef}
                      suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                      suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
                      isManualProjectSorting={isManualProjectSorting}
                      dragHandleProps={null}
                    />
                  ))}
                </SidebarMenu>
              )}
            </div>

            {projectsLength === 0 && (
              <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
                {t("sidebar.noProjects")}
              </div>
            )}
          </>
        ) : null}
      </SidebarGroup>
      {pinnedThreads.length > 0 ? (
        <SidebarGroup
          className="mt-2 px-2 py-1"
          style={{
            order: 20 + (defaultSidebarSectionOrderIndex.get("conversations") ?? 1) - 0.25,
          }}
        >
          <SidebarSectionTitle
            expanded={isPinnedSectionExpanded}
            onToggle={() => setPinnedSectionExpanded((expanded) => !expanded)}
          >
            {t("sidebar.pinned")}
          </SidebarSectionTitle>
          {isPinnedSectionExpanded ? (
            <SidebarMenu ref={attachThreadListAutoAnimateRef}>
              {pinnedThreadVisibility.visibleThreads.map((thread) => {
                const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                const isActive = routeThreadKey === threadKey;
                return (
                  <SidebarThreadRow
                    key={threadKey}
                    thread={thread}
                    projectCwd={null}
                    orderedProjectThreadKeys={pinnedThreadKeys}
                    isActive={isActive}
                    isPendingOpen={!isActive && pendingOpenThreadKey === threadKey}
                    jumpLabel={threadJumpLabelByKey.get(threadKey) ?? null}
                    appSettingsConfirmThreadArchive={confirmThreadArchive}
                    renamingThreadKey={renamingThreadKey}
                    renamingTitle={renamingTitle}
                    setRenamingTitle={setRenamingTitle}
                    renamingInputRef={renamingInputRef}
                    renamingCommittedRef={renamingCommittedRef}
                    confirmingArchiveThreadKey={confirmingArchiveThreadKey}
                    setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
                    confirmArchiveButtonRefs={confirmArchiveButtonRefs}
                    handleThreadClick={handleGlobalThreadClick}
                    navigateToThread={navigateToThread}
                    handleMultiSelectContextMenu={async () => {}}
                    handleThreadContextMenu={handleGlobalThreadContextMenu}
                    clearSelection={clearSelection}
                    commitRename={commitRename}
                    cancelRename={cancelRename}
                    attemptArchiveThread={archiveThread}
                    openPrLink={openThreadPrLink}
                  />
                );
              })}
              {pinnedThreadVisibility.hasHiddenThreads ? (
                <SidebarThreadListToggle
                  expanded={isPinnedThreadListExpanded}
                  hiddenThreadStatus={hiddenPinnedThreadStatus}
                  onExpand={() => {
                    setIsPinnedThreadListExpanded(true);
                  }}
                  onCollapse={() => {
                    setIsPinnedThreadListExpanded(false);
                  }}
                />
              ) : null}
            </SidebarMenu>
          ) : null}
        </SidebarGroup>
      ) : null}
      <SidebarGroup
        className="mt-2 px-2 py-1"
        style={{ order: 20 + (defaultSidebarSectionOrderIndex.get("conversations") ?? 1) }}
      >
        <SidebarSectionTitle
          draggable
          expanded={isConversationsSectionExpanded}
          onToggle={() => setConversationsSectionExpanded((expanded) => !expanded)}
          onDragStart={(event) => handleDefaultSectionDragStart("conversations", event)}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("application/x-t3code-default-sidebar-section")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => handleDefaultSectionDrop("conversations", event)}
          action={
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={t("sidebar.newConversation")}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    onClick={handleCreateConversationThread}
                  />
                }
              >
                <SquarePenIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="right">{t("sidebar.newConversation")}</TooltipPopup>
            </Tooltip>
          }
        >
          {t("sidebar.conversations")}
        </SidebarSectionTitle>
        {isConversationsSectionExpanded ? (
          <SidebarMenu ref={attachThreadListAutoAnimateRef}>
            {globalThreadVisibility.visibleThreads.map((thread) => {
              const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
              const isActive = routeThreadKey === threadKey;
              return (
                <SidebarThreadRow
                  key={threadKey}
                  thread={thread}
                  projectCwd={null}
                  orderedProjectThreadKeys={globalThreadKeys}
                  isActive={isActive}
                  isPendingOpen={!isActive && pendingOpenThreadKey === threadKey}
                  jumpLabel={threadJumpLabelByKey.get(threadKey) ?? null}
                  appSettingsConfirmThreadArchive={confirmThreadArchive}
                  renamingThreadKey={renamingThreadKey}
                  renamingTitle={renamingTitle}
                  setRenamingTitle={setRenamingTitle}
                  renamingInputRef={renamingInputRef}
                  renamingCommittedRef={renamingCommittedRef}
                  confirmingArchiveThreadKey={confirmingArchiveThreadKey}
                  setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
                  confirmArchiveButtonRefs={confirmArchiveButtonRefs}
                  handleThreadClick={handleGlobalThreadClick}
                  navigateToThread={navigateToThread}
                  handleMultiSelectContextMenu={async () => {}}
                  handleThreadContextMenu={handleGlobalThreadContextMenu}
                  clearSelection={clearSelection}
                  commitRename={commitRename}
                  cancelRename={cancelRename}
                  attemptArchiveThread={archiveThread}
                  openPrLink={openThreadPrLink}
                />
              );
            })}
            {globalThreadVisibility.hasHiddenThreads ? (
              <SidebarThreadListToggle
                expanded={isGlobalThreadListExpanded}
                hiddenThreadStatus={hiddenGlobalThreadStatus}
                onExpand={() => {
                  setIsGlobalThreadListExpanded(true);
                }}
                onCollapse={() => {
                  setIsGlobalThreadListExpanded(false);
                }}
              />
            ) : null}
          </SidebarMenu>
        ) : null}
      </SidebarGroup>
    </SidebarContent>
  );
});

export default function Sidebar() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const pinnedThreadKeys = useUiStateStore((store) => store.pinnedThreadKeys);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname.startsWith("/settings");
  const sidebarThreadSortOrder = useSettings((s) => s.sidebarThreadSortOrder);
  const sidebarProjectSortOrder = useSettings((s) => s.sidebarProjectSortOrder);
  const sidebarProjectGroupingMode = useSettings((s) => s.sidebarProjectGroupingMode);
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const sidebarThreadPreviewCount = useSettings((s) => s.sidebarThreadPreviewCount);
  const { updateSettings } = useUpdateSettings();
  const { handleNewThread } = useNewThreadHandler();
  const { archiveThread, deleteThread } = useThreadActions();
  const { isMobile, setOpenMobile } = useSidebar();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const keybindings = useServerKeybindings();
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const pendingOpenThreadRef = useUiStateStore((store) => store.pendingOpenThreadRef);
  const setPendingOpenThreadRef = useUiStateStore((store) => store.setPendingOpenThreadRef);
  const pendingOpenThreadKey = pendingOpenThreadRef ? scopedThreadKey(pendingOpenThreadRef) : null;
  const [isProjectsSectionExpanded, setProjectsSectionExpanded] = useState(true);
  const [isPinnedSectionExpanded, setPinnedSectionExpanded] = useState(true);
  const [isConversationsSectionExpanded, setConversationsSectionExpanded] = useState(true);
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const platform = navigator.platform;
  const shortcutModifiers = useShortcutModifierState();
  const modelPickerOpen = useModelPickerOpen();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryServerConfig = useServerConfig();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((s) => s.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((s) => s.byId);
  const conversationWorkspaceDirByEnvironmentId = useMemo(() => {
    const entries: Array<readonly [EnvironmentId, string]> = [];
    for (const [environmentId, runtime] of Object.entries(savedEnvironmentRuntimeById)) {
      const conversationWorkspaceDir = runtime.serverConfig?.conversationWorkspaceDir;
      if (conversationWorkspaceDir) {
        entries.push([EnvironmentId.make(environmentId), conversationWorkspaceDir]);
      }
    }
    if (primaryEnvironmentId && primaryServerConfig?.conversationWorkspaceDir) {
      entries.push([primaryEnvironmentId, primaryServerConfig.conversationWorkspaceDir]);
    }
    return new Map(entries);
  }, [
    primaryEnvironmentId,
    primaryServerConfig?.conversationWorkspaceDir,
    savedEnvironmentRuntimeById,
  ]);
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
    });
  }, [projectOrder, projects]);

  // Build a mapping from physical project key → logical project key for
  // cross-environment grouping.  Projects that share a repositoryIdentity
  // canonicalKey are treated as one logical project in the sidebar.
  const physicalToLogicalKey = useMemo(() => {
    return buildPhysicalToLogicalProjectKeyMap({
      projects: orderedProjects,
      settings: projectGroupingSettings,
    });
  }, [orderedProjects, projectGroupingSettings]);
  const projectPhysicalKeyByScopedRef = useMemo(
    () =>
      new Map(
        orderedProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          derivePhysicalProjectKey(project),
        ]),
      ),
    [orderedProjects],
  );

  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(() => {
    return buildSidebarProjectSnapshots({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => {
        const rt = savedEnvironmentRuntimeById[environmentId];
        const saved = savedEnvironmentRegistry[environmentId];
        return rt?.descriptor?.label ?? saved?.label ?? null;
      },
    });
  }, [
    orderedProjects,
    projectGroupingSettings,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);

  const sidebarProjectByKey = useMemo(
    () => new Map(sidebarProjects.map((project) => [project.projectKey, project] as const)),
    [sidebarProjects],
  );
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Resolve the active route's project key to a logical key so it matches the
  // sidebar's grouped project entries.
  const activeRouteProjectKey = useMemo(() => {
    if (!routeThreadKey) {
      return null;
    }
    const activeThread = sidebarThreadByKey.get(routeThreadKey);
    if (!activeThread) return null;
    const physicalKey =
      projectPhysicalKeyByScopedRef.get(
        scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId)),
      ) ?? scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId));
    return physicalToLogicalKey.get(physicalKey) ?? physicalKey;
  }, [routeThreadKey, sidebarThreadByKey, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);

  // Group threads by logical project key so all threads from grouped projects
  // are displayed together.
  const threadsByProjectKey = useMemo(() => {
    const next = new Map<string, SidebarThreadSummary[]>();
    for (const thread of sidebarThreads) {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      const logicalKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = next.get(logicalKey);
      if (existing) {
        existing.push(thread);
      } else {
        next.set(logicalKey, [thread]);
      }
    }
    return next;
  }, [sidebarThreads, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: routeThreadRef
        ? selectThreadTerminalState(
            useTerminalStateStore.getState().terminalStateByThreadKey,
            routeThreadRef,
          ).terminalOpen
        : false,
      modelPickerOpen,
    }),
    [modelPickerOpen, routeThreadRef],
  );
  const newThreadShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: false,
      },
    }),
    [platform],
  );
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal", newThreadShortcutLabelOptions) ??
    shortcutLabelForCommand(keybindings, "chat.new", newThreadShortcutLabelOptions);

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      const threadKey = scopedThreadKey(threadRef);
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setPendingOpenThreadRef(threadRef);
      setSelectionAnchor(threadKey);
      if (isMobile) {
        setOpenMobile(false);
      }
      const releasePreload = retainThreadDetailSubscription(
        threadRef.environmentId,
        threadRef.threadId,
        {
          initialDetailMode: "full",
        },
      );
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      })
        .catch(() => {
          const current = useUiStateStore.getState().pendingOpenThreadRef;
          if (
            current?.environmentId === threadRef.environmentId &&
            current.threadId === threadRef.threadId
          ) {
            setPendingOpenThreadRef(null);
          }
        })
        .finally(() => {
          releasePreload();
        });
    },
    [
      clearSelection,
      isMobile,
      navigate,
      setOpenMobile,
      setPendingOpenThreadRef,
      setSelectionAnchor,
    ],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = sidebarProjects.find((project) => project.projectKey === active.id);
      const overProject = sidebarProjects.find((project) => project.projectKey === over.id);
      if (!activeProject || !overProject) return;
      const activeMemberKeys = activeProject.memberProjects.map(
        (member) => member.physicalProjectKey,
      );
      const overMemberKeys = overProject.memberProjects.map((member) => member.physicalProjectKey);
      reorderProjects(activeMemberKeys, overMemberKeys);
    },
    [sidebarProjectSortOrder, reorderProjects, sidebarProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>());
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListsRef.current.add(node);
  }, []);

  const visibleThreads = useMemo(
    () => sidebarThreads.filter((thread) => thread.archivedAt === null),
    [sidebarThreads],
  );
  const pinnedThreadKeySet = useMemo(() => new Set(pinnedThreadKeys), [pinnedThreadKeys]);
  const pinnedThreads = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: visibleThreads.filter((thread) =>
          pinnedThreadKeySet.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
        ),
        preferredIds: pinnedThreadKeys,
        getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      }),
    [pinnedThreadKeySet, pinnedThreadKeys, visibleThreads],
  );
  const sortedProjects = useMemo(() => {
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableThreads = visibleThreads
      .filter(
        (thread) =>
          !pinnedThreadKeySet.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      )
      .map((thread) => {
        const physicalKey =
          projectPhysicalKeyByScopedRef.get(
            scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
          ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
        return {
          ...thread,
          projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
        };
      });
    return sortProjectsForSidebar(
      sortableProjects,
      sortableThreads,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [
    sidebarProjectSortOrder,
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
    sidebarProjectByKey,
    sidebarProjects,
    pinnedThreadKeySet,
    visibleThreads,
  ]);
  const isManualProjectSorting = sidebarProjectSortOrder === "manual";
  const visibleProjectSidebarThreadKeys = useMemo(() => {
    if (!isProjectsSectionExpanded) {
      return [];
    }
    return sortedProjects.flatMap((project) => {
      const projectThreads = sortThreads(
        (threadsByProjectKey.get(project.projectKey) ?? []).filter(
          (thread) =>
            thread.archivedAt === null &&
            !pinnedThreadKeySet.has(
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
            ),
        ),
        sidebarThreadSortOrder,
      );
      const projectExpanded = projectExpandedById[project.projectKey] ?? true;
      const activeThreadKey = routeThreadKey ?? undefined;
      const pinnedCollapsedThread =
        !projectExpanded && activeThreadKey
          ? (projectThreads.find(
              (thread) =>
                scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                activeThreadKey,
            ) ?? null)
          : null;
      const shouldShowThreadPanel = projectExpanded || pinnedCollapsedThread !== null;
      if (!shouldShowThreadPanel) {
        return [];
      }
      const isThreadListExpanded = expandedThreadListsByProject.has(project.projectKey);
      const hasOverflowingThreads = projectThreads.length > sidebarThreadPreviewCount;
      const previewThreads =
        isThreadListExpanded || !hasOverflowingThreads
          ? projectThreads
          : projectThreads.slice(0, sidebarThreadPreviewCount);
      const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : previewThreads;
      return renderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
    });
  }, [
    isProjectsSectionExpanded,
    sidebarThreadSortOrder,
    sidebarThreadPreviewCount,
    expandedThreadListsByProject,
    projectExpandedById,
    pinnedThreadKeySet,
    routeThreadKey,
    sortedProjects,
    threadsByProjectKey,
  ]);
  const globalThreads = useMemo(() => {
    const projectIds = new Set(projects.map((p) => p.id));
    return sortThreads(
      visibleThreads.filter(
        (t) =>
          (!t.projectId || !projectIds.has(t.projectId)) &&
          !pinnedThreadKeySet.has(scopedThreadKey(scopeThreadRef(t.environmentId, t.id))),
      ),
      sidebarThreadSortOrder,
    );
  }, [pinnedThreadKeySet, projects, visibleThreads, sidebarThreadSortOrder]);

  const visibleSidebarThreadKeys = useMemo(
    () => [
      ...(isPinnedSectionExpanded
        ? pinnedThreads.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          )
        : []),
      ...visibleProjectSidebarThreadKeys,
      ...(isConversationsSectionExpanded
        ? globalThreads.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          )
        : []),
    ],
    [
      globalThreads,
      isConversationsSectionExpanded,
      isPinnedSectionExpanded,
      pinnedThreads,
      visibleProjectSidebarThreadKeys,
    ],
  );
  const threadJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadKey] of visibleSidebarThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(threadKey, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadKeys]);
  const threadJumpThreadKeys = useMemo(
    () => [...threadJumpCommandByKey.keys()],
    [threadJumpCommandByKey],
  );
  const sidebarShortcutContext = useMemo(
    () => ({
      terminalFocus: false,
      terminalOpen: routeThreadRef
        ? selectThreadTerminalState(
            useTerminalStateStore.getState().terminalStateByThreadKey,
            routeThreadRef,
          ).terminalOpen
        : false,
      modelPickerOpen,
    }),
    [modelPickerOpen, routeThreadRef],
  );
  const threadJumpLabelByKey = useMemo(
    () =>
      buildThreadJumpLabelMap({
        keybindings,
        platform,
        terminalOpen: sidebarShortcutContext.terminalOpen,
        threadJumpCommandByKey,
      }),
    [keybindings, platform, sidebarShortcutContext.terminalOpen, threadJumpCommandByKey],
  );
  const shouldShowThreadJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform,
      context: sidebarShortcutContext,
    },
  );
  const visibleThreadJumpLabelByKey = showThreadJumpHints
    ? threadJumpLabelByKey
    : EMPTY_THREAD_JUMP_LABELS;
  const orderedSidebarThreadKeys = visibleSidebarThreadKeys;
  const prewarmedSidebarThreadKeys = useMemo(
    () => getSidebarThreadIdsToPrewarm(visibleSidebarThreadKeys),
    [visibleSidebarThreadKeys],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () =>
      prewarmedSidebarThreadKeys.flatMap((threadKey) => {
        const ref = parseScopedThreadKey(threadKey);
        return ref ? [ref] : [];
      }),
    [prewarmedSidebarThreadKeys],
  );

  useEffect(() => {
    const releases = prewarmedSidebarThreadRefs.map((ref) =>
      retainThreadDetailSubscription(ref.environmentId, ref.threadId, {
        initialDetailMode: "shell",
      }),
    );

    return () => {
      for (const release of releases) {
        release();
      }
    };
  }, [prewarmedSidebarThreadRefs]);

  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowThreadJumpHintsNow);
  }, [shouldShowThreadJumpHintsNow, updateThreadJumpHintsVisibility]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcutContext = getCurrentSidebarShortcutContext();

      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform,
        context: shortcutContext,
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadKey = resolveAdjacentThreadId({
          threadIds: orderedSidebarThreadKeys,
          currentThreadId: routeThreadKey,
          direction: traversalDirection,
        });
        if (!targetThreadKey) {
          return;
        }
        const targetThread = sidebarThreadByKey.get(targetThreadKey);
        if (!targetThread) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return;
      }

      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetThreadKey = threadJumpThreadKeys[jumpIndex];
      if (!targetThreadKey) {
        return;
      }
      const targetThread = sidebarThreadByKey.get(targetThreadKey);
      if (!targetThread) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
    };

    window.addEventListener("keydown", onWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    getCurrentSidebarShortcutContext,
    keybindings,
    navigateToThread,
    orderedSidebarThreadKeys,
    platform,
    routeThreadKey,
    sidebarThreadByKey,
    threadJumpThreadKeys,
  ]);

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!useThreadSelectionStore.getState().hasSelection()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start update download",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopUpdateState),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectKey)) return current;
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />

      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
          <SidebarProjectsContent
            showArm64IntelBuildWarning={showArm64IntelBuildWarning}
            arm64IntelBuildWarningDescription={arm64IntelBuildWarningDescription}
            desktopUpdateButtonAction={desktopUpdateButtonAction}
            desktopUpdateButtonDisabled={desktopUpdateButtonDisabled}
            handleDesktopUpdateButtonClick={handleDesktopUpdateButtonClick}
            projectSortOrder={sidebarProjectSortOrder}
            threadSortOrder={sidebarThreadSortOrder}
            projectGroupingMode={sidebarProjectGroupingMode}
            threadPreviewCount={sidebarThreadPreviewCount}
            updateSettings={updateSettings}
            isManualProjectSorting={isManualProjectSorting}
            projectDnDSensors={projectDnDSensors}
            projectCollisionDetection={projectCollisionDetection}
            handleProjectDragStart={handleProjectDragStart}
            handleProjectDragEnd={handleProjectDragEnd}
            handleProjectDragCancel={handleProjectDragCancel}
            handleNewThread={handleNewThread}
            archiveThread={archiveThread}
            deleteThread={deleteThread}
            navigateToThread={navigateToThread}
            sortedProjects={sortedProjects}
            expandedThreadListsByProject={expandedThreadListsByProject}
            activeRouteProjectKey={activeRouteProjectKey}
            routeThreadKey={routeThreadKey}
            pendingOpenThreadKey={pendingOpenThreadKey}
            newThreadShortcutLabel={newThreadShortcutLabel}
            threadJumpLabelByKey={visibleThreadJumpLabelByKey}
            attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
            expandThreadListForProject={expandThreadListForProject}
            collapseThreadListForProject={collapseThreadListForProject}
            dragInProgressRef={dragInProgressRef}
            suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
            suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
            attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
            projectsLength={projects.length}
            pinnedThreads={pinnedThreads}
            pinnedThreadKeySet={pinnedThreadKeySet}
            conversationWorkspaceDirByEnvironmentId={conversationWorkspaceDirByEnvironmentId}
            globalThreads={globalThreads}
            isProjectsSectionExpanded={isProjectsSectionExpanded}
            isPinnedSectionExpanded={isPinnedSectionExpanded}
            isConversationsSectionExpanded={isConversationsSectionExpanded}
            setProjectsSectionExpanded={setProjectsSectionExpanded}
            setPinnedSectionExpanded={setPinnedSectionExpanded}
            setConversationsSectionExpanded={setConversationsSectionExpanded}
          />

          <SidebarSeparator />
          <SidebarChromeFooter />
        </>
      )}
    </>
  );
}
