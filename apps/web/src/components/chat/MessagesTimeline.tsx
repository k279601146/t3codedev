import {
  type EnvironmentId,
  type MessageId,
  type ServerProviderSkill,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import {
  createContext,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { type TurnDiffSummary } from "../../types";
import { getPatchDisplayPath, parseUnifiedDiff, type UnifiedDiffLine } from "../../lib/unifiedDiff";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  FilePlus2Icon,
  FileTextIcon,
  EyeIcon,
  GoalIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  AppWindowIcon,
  SquarePenIcon,
  ChromeIcon,
  MonitorIcon,
  MousePointerClickIcon,
  PencilIcon,
  TerminalSquareIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  deriveTurnProcessCollapseState,
  fileChangeVerbLabel,
  isCommandWorkEntry,
  normalizeCompactToolLabel,
  resolveAggregateFileChangeAction,
  resolveFileChangeActionFromKind,
  resolveAssistantMessageCopyState,
  resolveRunningWorkEntryStatusLabel,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { parseRenderableUnifiedDiff } from "../DiffPanel.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ShimmerScanText } from "../ui/shimmer-scan-text";
import { ImageGenerationShimmer } from "../ui/image-generation-shimmer";
import { Skeleton } from "../ui/skeleton";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { setPerformanceModeActive } from "~/performanceMode";
import { readEnvironmentApi } from "../../environmentApi";
import { readLocalApi } from "../../localApi";
import { revealFileInFolder } from "../../lib/openContainingFolder";
import { toastManager } from "../ui/toast";
import { useUiStateStore } from "~/uiStateStore";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";

import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { SkillInlineText } from "./SkillInlineText";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import {
  type MarkdownFileLinkMeta,
  isBareMarkdownPreviewPath,
  rewriteMarkdownFileUriHref,
} from "../../markdown-links";

// ---------------------------------------------------------------------------
// Context shared by transcript rows. Row-scoped data stays on the row props;
// callbacks and non-row state live here so memoized rows are not rebuilt by
// scroll events. `nowIso` is intentionally excluded because self-ticking
// components (WorkingTimer, LiveElapsed) handle it.
// ---------------------------------------------------------------------------

interface TimelineRowSharedState {
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  threadId: ThreadId;
  inferredCheckpointTurnCountByTurnId: Readonly<Record<TurnId, number | undefined>>;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertUserMessage: (messageId: MessageId) => void;
  goalMessageIds: ReadonlySet<MessageId>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onOpenMarkdownFile: ((file: MarkdownFileLinkMeta) => void) | undefined;
  onOpenUrl: ((url: string, mode: "preview" | "external") => void) | undefined;
  onSubmitEditedUserMessage: ((messageId: MessageId, text: string) => Promise<void>) | null;
  /** 历史字段名保留；这里的 id 是成果 owner，可能是助手消息，也可能是计划/图片行。 */
  collapsedAssistantMessageIds: ReadonlySet<string>;
  /** 拥有“已处理 X ›”开关的成果 owner id。 */
  summaryAssistantMessageIds: ReadonlySet<string>;
  /** 每个成果 owner 对应的人类可读耗时。 */
  elapsedByAssistantMessageId: ReadonlyMap<string, string>;
  /** 过程成员行 → 成果 owner；出现在这里的行会跟随“已处理”开关收展。 */
  ownerAssistantMessageIdByRowId: ReadonlyMap<string, string>;
  /** 首个过程成员行 → 成果 owner；开关渲染在这个成员行上方。 */
  summaryButtonHostByRowId: ReadonlyMap<string, string>;
  toggleAssistantTurnCollapsed: (assistantMessageId: string) => void;
  /** Resolves the transcript scroller for viewport-pinned summary toggles. */
  getScrollContainer: () => HTMLElement | null;
}

interface TimelineRowActivityState {
  activeTurnInProgress: boolean;
  activeTurnId: TurnId | null;
  isWorking: boolean;
  isRevertingCheckpoint: boolean;
  completionSummary: string | null;
}

const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);
const TimelineRowActivityCtx = createContext<TimelineRowActivityState>(null!);
const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />;
const EMPTY_TIMELINE_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];
const EMPTY_GOAL_MESSAGE_IDS = new Set<MessageId>();

const ASSISTANT_URL_PATTERN = /https?:\/\/[^\s"'`<>)\]]+/gi;

// ---------------------------------------------------------------------------
// Props (public API)
// ---------------------------------------------------------------------------

interface MessagesTimelineProps {
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnId?: TurnId | null;
  activeTurnStartedAt: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  turnDiffSummaries?: ReadonlyArray<TurnDiffSummary>;
  routeThreadKey: string;
  threadId: ThreadId;
  inferredCheckpointTurnCountByTurnId?: Readonly<Record<TurnId, number | undefined>>;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onOpenMarkdownFile?: ((file: MarkdownFileLinkMeta) => void) | undefined;
  onOpenUrl?: ((url: string, mode: "preview" | "external") => void) | undefined;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  onSubmitEditedUserMessage?: (messageId: MessageId, text: string) => Promise<void>;
  goalMessageIds?: ReadonlySet<MessageId>;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  onIsAtEndChange: (isAtEnd: boolean) => void;
  isLoadingHistory?: boolean;
  hasMoreBefore?: boolean;
  isLoadingBefore?: boolean;
  onLoadMoreBefore?: () => void;
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  activeTurnId,
  activeTurnStartedAt,
  scrollRef,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  turnDiffSummaryByAssistantMessageId,
  turnDiffSummaries = [],
  routeThreadKey,
  threadId,
  inferredCheckpointTurnCountByTurnId = {},
  onOpenTurnDiff,
  onOpenMarkdownFile,
  onOpenUrl,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  onSubmitEditedUserMessage,
  goalMessageIds = EMPTY_GOAL_MESSAGE_IDS,
  isRevertingCheckpoint,
  onImageExpand,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  skills = EMPTY_TIMELINE_SKILLS,
  onIsAtEndChange,
  isLoadingHistory = false,
  hasMoreBefore = false,
  isLoadingBefore = false,
  onLoadMoreBefore,
}: MessagesTimelineProps) {
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnInProgress,
        activeTurnId: activeTurnId ?? null,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      completionDividerBeforeEntryId,
      isWorking,
      activeTurnInProgress,
      activeTurnId,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const stableRows = useStableRows(rawRows);

  const {
    ownerAssistantMessageIdByRowId,
    summaryAssistantMessageIds,
    elapsedByAssistantMessageId,
    summaryButtonHostByRowId,
  } = useMemo(() => deriveTurnProcessCollapseState(stableRows), [stableRows]);

  /** Default collapse policy: every turn-summary owner is collapsed by
   *  default (mirrors the screenshot — only the "已处理 X ›" button is
   *  visible). Manual toggles are tracked as a delta on top of that
   *  default. */
  const [expandedAssistantMessageIds, setExpandedAssistantMessageIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  /** The active in-flight turn stays expanded automatically. We resolve its
   *  assistant message id by looking for the assistant row whose turnId
   *  matches the activeTurnId. */
  const activeAssistantMessageId = useMemo(() => {
    if (!activeTurnInProgress || activeTurnId == null) return null;
    for (let i = stableRows.length - 1; i >= 0; i -= 1) {
      const row = stableRows[i];
      if (!row || row.kind !== "message") continue;
      if (row.message.role !== "assistant") continue;
      if (row.message.turnId === activeTurnId) return row.message.id;
    }
    return null;
  }, [activeTurnId, activeTurnInProgress, stableRows]);

  const toggleAssistantTurnCollapsed = useCallback((assistantMessageId: string) => {
    setExpandedAssistantMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(assistantMessageId)) next.delete(assistantMessageId);
      else next.add(assistantMessageId);
      return next;
    });
  }, []);

  /** Set of summary owners that should currently be collapsed — i.e.
   *  every owner *except* the one whose user manually expanded it,
   *  except the active in-flight turn, and except any streaming message
   *  whose "Worked for X" duration isn't known yet. */
  const collapsedAssistantMessageIds = useMemo(() => {
    const next = new Set<string>();
    for (const id of summaryAssistantMessageIds) {
      if (expandedAssistantMessageIds.has(id)) continue;
      if (id === activeAssistantMessageId) continue;
      if (!elapsedByAssistantMessageId.has(id)) continue;
      next.add(id);
    }
    return next;
  }, [
    activeAssistantMessageId,
    elapsedByAssistantMessageId,
    expandedAssistantMessageIds,
    summaryAssistantMessageIds,
  ]);

  /** Keep collapsed member rows in the DOM and animate their height to zero.
   *  Removing them entirely would shift the transcript while the user reads. */
  const rows = stableRows;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isScrollingRef = useRef(false);
  const scrollingEndTimerRef = useRef<number | null>(null);
  const scrollMeasureFrameRef = useRef<number | null>(null);
  const pendingPrependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const loadMoreBeforeInFlightRef = useRef(false);

  const getScrollContainer = useCallback(() => {
    return scrollRef.current;
  }, [scrollRef]);

  const handleScroll = useCallback(() => {
    if (!isScrollingRef.current) {
      isScrollingRef.current = true;
      window.requestAnimationFrame(() => {
        if (isScrollingRef.current) {
          setPerformanceModeActive("scrolling", true);
        }
      });
    }
    if (scrollingEndTimerRef.current !== null) {
      window.clearTimeout(scrollingEndTimerRef.current);
    }
    scrollingEndTimerRef.current = window.setTimeout(() => {
      scrollingEndTimerRef.current = null;
      if (isScrollingRef.current) {
        isScrollingRef.current = false;
        setPerformanceModeActive("scrolling", false);
      }
    }, 160);
    if (scrollMeasureFrameRef.current === null) {
      scrollMeasureFrameRef.current = window.requestAnimationFrame(() => {
        scrollMeasureFrameRef.current = null;
        const scrollEl = getScrollContainer();
        if (!scrollEl) return;
        const isAtEnd = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 10;
        onIsAtEndChange(isAtEnd);
        if (
          hasMoreBefore &&
          !isLoadingBefore &&
          !loadMoreBeforeInFlightRef.current &&
          onLoadMoreBefore &&
          scrollEl.scrollTop < 240
        ) {
          loadMoreBeforeInFlightRef.current = true;
          pendingPrependAnchorRef.current = {
            scrollHeight: scrollEl.scrollHeight,
            scrollTop: scrollEl.scrollTop,
          };
          onLoadMoreBefore();
        }
      });
    }
  }, [hasMoreBefore, isLoadingBefore, onIsAtEndChange, onLoadMoreBefore, getScrollContainer]);

  useEffect(() => {
    if (!isLoadingBefore) {
      loadMoreBeforeInFlightRef.current = false;
    }
    if (!hasMoreBefore) {
      pendingPrependAnchorRef.current = null;
    }
  }, [hasMoreBefore, isLoadingBefore]);

  useEffect(() => {
    const scrollEl = getScrollContainer();
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", handleScroll);
    };
  }, [getScrollContainer, handleScroll]);

  useEffect(
    () => () => {
      if (scrollingEndTimerRef.current !== null) {
        window.clearTimeout(scrollingEndTimerRef.current);
      }
      if (scrollMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollMeasureFrameRef.current);
        scrollMeasureFrameRef.current = null;
      }
      if (isScrollingRef.current) {
        isScrollingRef.current = false;
        setPerformanceModeActive("scrolling", false);
      }
    },
    [],
  );

  const didInitialScrollRef = useRef(false);
  const previousRowCountRef = useRef(rows.length);
  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;

    const shouldScrollToInitialEnd =
      !didInitialScrollRef.current && rows.length > 0 && !pendingPrependAnchorRef.current;
    const shouldScrollAfterEmptyLoad = previousRowCount === 0 && rows.length > 0;
    if (!shouldScrollToInitialEnd && !shouldScrollAfterEmptyLoad) {
      return;
    }
    didInitialScrollRef.current = true;

    onIsAtEndChange(true);
    const frameId = window.requestAnimationFrame(() => {
      const scrollEl = getScrollContainer();
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [getScrollContainer, onIsAtEndChange, rows.length]);

  useEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    if (!anchor || isLoadingBefore) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      const scrollEl = getScrollContainer();
      if (!scrollEl) return;
      scrollEl.scrollTop = scrollEl.scrollHeight - anchor.scrollHeight + anchor.scrollTop;
      pendingPrependAnchorRef.current = null;
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [getScrollContainer, isLoadingBefore, rows.length]);

  const lastRow = rows.at(-1) ?? null;
  useEffect(() => {
    if (!lastRow) {
      return;
    }

    const scrollEl = getScrollContainer();
    const isAtEnd = scrollEl
      ? scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 10
      : true;

    if (!isAtEnd) {
      onIsAtEndChange(false);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const nextScrollEl = getScrollContainer();
      if (nextScrollEl) {
        nextScrollEl.scrollTop = nextScrollEl.scrollHeight;
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTurnInProgress, lastRow, onIsAtEndChange, getScrollContainer]);

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey,
      threadId,
      inferredCheckpointTurnCountByTurnId,
      turnDiffSummaries,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onRevertUserMessage,
      onSubmitEditedUserMessage: onSubmitEditedUserMessage ?? null,
      goalMessageIds,
      onImageExpand,
      onOpenTurnDiff,
      onOpenMarkdownFile,
      onOpenUrl,
      collapsedAssistantMessageIds,
      summaryAssistantMessageIds,
      elapsedByAssistantMessageId,
      ownerAssistantMessageIdByRowId,
      summaryButtonHostByRowId,
      toggleAssistantTurnCollapsed,
      getScrollContainer,
    }),
    [
      timestampFormat,
      routeThreadKey,
      threadId,
      inferredCheckpointTurnCountByTurnId,
      turnDiffSummaries,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onRevertUserMessage,
      onSubmitEditedUserMessage,
      goalMessageIds,
      onImageExpand,
      onOpenTurnDiff,
      onOpenMarkdownFile,
      onOpenUrl,
      collapsedAssistantMessageIds,
      summaryAssistantMessageIds,
      elapsedByAssistantMessageId,
      ownerAssistantMessageIdByRowId,
      summaryButtonHostByRowId,
      toggleAssistantTurnCollapsed,
      getScrollContainer,
    ],
  );
  const activityState = useMemo<TimelineRowActivityState>(
    () => ({
      activeTurnInProgress,
      activeTurnId: activeTurnId ?? null,
      isWorking,
      isRevertingCheckpoint,
      completionSummary,
    }),
    [activeTurnInProgress, activeTurnId, completionSummary, isRevertingCheckpoint, isWorking],
  );

  // Rows read shared state from context; scroll state is kept outside rows.
  if (rows.length === 0 && isLoadingHistory) {
    return <MessagesTimelineHistorySkeleton />;
  }

  if (rows.length === 0 && !isWorking) {
    return (
      <div
        className="h-full"
        aria-label="暂无对话内容"
        data-timeline-empty-placeholder="true"
        data-testid="timeline-empty-placeholder"
      />
    );
  }

  return (
    <TimelineRowCtx.Provider value={sharedState}>
      <TimelineRowActivityCtx.Provider value={activityState}>
        <div
          ref={containerRef}
          className="h-full min-h-0 w-full min-w-0 flex-1 bg-white dark:bg-background"
        >
          <div
            ref={scrollRef}
            className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain bg-white px-4 [scrollbar-gutter:stable] [touch-action:pan-y] sm:px-6 dark:bg-background"
          >
            {TIMELINE_LIST_HEADER}
            {hasMoreBefore ? (
              <div className="mx-auto flex w-full max-w-[736px] justify-center py-2">
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs transition-colors hover:border-border hover:text-foreground disabled:cursor-default disabled:opacity-60"
                  disabled={isLoadingBefore}
                  onClick={() => {
                    const scrollEl = getScrollContainer();
                    if (loadMoreBeforeInFlightRef.current) {
                      return;
                    }
                    loadMoreBeforeInFlightRef.current = true;
                    if (scrollEl) {
                      pendingPrependAnchorRef.current = {
                        scrollHeight: scrollEl.scrollHeight,
                        scrollTop: scrollEl.scrollTop,
                      };
                    }
                    onLoadMoreBefore?.();
                  }}
                >
                  {isLoadingBefore ? "加载中..." : "加载更早记录"}
                </button>
              </div>
            ) : null}
            {rows.map((row) => (
              <div
                key={keyExtractor(row)}
                className="mx-auto w-full min-w-0 max-w-[736px] overflow-x-clip [contain:layout_paint]"
                data-timeline-root="true"
              >
                <TimelineRowContent row={row} />
              </div>
            ))}
            {TIMELINE_LIST_FOOTER}
          </div>
        </div>
      </TimelineRowActivityCtx.Provider>
    </TimelineRowCtx.Provider>
  );
});

function MessagesTimelineHistorySkeleton() {
  return (
    <div
      className="h-full min-h-0 overflow-hidden px-3 sm:px-5"
      aria-busy="true"
      aria-label="正在加载对话内容"
      data-timeline-history-skeleton="true"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6">
        <div className="flex justify-end">
          <div className="w-[78%] max-w-xl rounded-md bg-muted/35 p-4">
            <Skeleton className="h-3 w-11/12 rounded-full" />
            <Skeleton className="mt-3 h-3 w-7/12 rounded-full" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-24 rounded-full" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-10/12 rounded-full" />
          <Skeleton className="h-3 w-8/12 rounded-full" />
        </div>
        <div className="flex justify-end">
          <div className="w-[64%] max-w-lg rounded-md bg-muted/30 p-4">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="mt-3 h-3 w-2/3 rounded-full" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-20 rounded-full" />
          <Skeleton className="h-3 w-11/12 rounded-full" />
          <Skeleton className="h-3 w-9/12 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

// ---------------------------------------------------------------------------
// TimelineRowContent — the actual row component
// ---------------------------------------------------------------------------

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];
type TimelineRow = MessagesTimelineRow;

const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  const ctx = use(TimelineRowCtx);
  const hostAssistantMessageId = ctx.summaryButtonHostByRowId.get(row.id);
  const ownerAssistantMessageId = ctx.ownerAssistantMessageIdByRowId.get(row.id);
  const isCollapsedMember =
    ownerAssistantMessageId !== undefined &&
    ctx.collapsedAssistantMessageIds.has(ownerAssistantMessageId);

  const innerRow = (
    <div
      className={cn(
        timelineRowSpacingClass(row),
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" ? (
        <WorkGroupSection
          groupedEntries={row.groupedEntries}
          turnDiffSummary={row.turnDiffSummary}
        />
      ) : null}
      {row.kind === "message" && row.message.role === "user" ? <UserTimelineRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "assistant" ? (
        <AssistantTimelineRow row={row} />
      ) : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "image-generation" ? <ImageGenerationTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
    </div>
  );

  return (
    <>
      {hostAssistantMessageId ? (
        <TurnSummaryToggleHeader assistantMessageId={hostAssistantMessageId} />
      ) : null}
      {ownerAssistantMessageId ? (
        <CollapsibleMember collapsed={isCollapsedMember}>{innerRow}</CollapsibleMember>
      ) : (
        innerRow
      )}
    </>
  );
});

function timelineRowSpacingClass(row: TimelineRow): string {
  if (row.kind === "message") {
    if (row.message.role === "assistant") {
      return row.showAssistantMeta ? "pb-4" : "pb-3";
    }
    return "pb-3";
  }
  if (row.kind === "work") return "pb-2";
  return "pb-3";
}

/** Toggle header rendered above the first member row of a collapsed span. */
function TurnSummaryToggleHeader({ assistantMessageId }: { assistantMessageId: string }) {
  const ctx = use(TimelineRowCtx);
  const isCollapsed = ctx.collapsedAssistantMessageIds.has(assistantMessageId);
  const elapsed = ctx.elapsedByAssistantMessageId.get(assistantMessageId) ?? null;
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Keep the toggle button visually pinned at its current viewport
  // position across the expand/collapse animation. The content grows
  // (or collapses) below it instead of pushing the button out of view.
  // We retry the alignment for several frames because async row content can
  // settle after the first commit and otherwise move the toggle.
  const handleToggle = useCallback(() => {
    const button = buttonRef.current;
    const container = ctx.getScrollContainer();

    // Capture the button's pre-toggle viewport offset so we can pin it
    // to the same y-coordinate after the layout commits.
    let pinnedTopOffset: number | null = null;
    if (button && container) {
      const buttonRect = button.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      pinnedTopOffset = buttonRect.top - containerRect.top;
    }

    ctx.toggleAssistantTurnCollapsed(assistantMessageId);

    if (pinnedTopOffset == null || !button || !container) return;

    const SETTLE_TOLERANCE = 1.5;
    const MAX_ATTEMPTS = 16; // ~16 * 16ms ≈ 256ms — covers grid-row anim.

    let attempt = 0;
    let frameId = 0;
    let cancelled = false;

    const align = () => {
      if (cancelled) return;
      attempt += 1;
      const buttonRect = button.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const currentTopOffset = buttonRect.top - containerRect.top;
      const delta = currentTopOffset - pinnedTopOffset!;
      if (Math.abs(delta) > SETTLE_TOLERANCE) {
        // Direct scrollTop assignment — repeated smooth scrolls cancel
        // each other and never converge while the grid-row transition
        // is still resizing the rows.
        container.scrollTop += delta;
      }
      if (attempt < MAX_ATTEMPTS) {
        frameId = window.requestAnimationFrame(align);
      }
    };
    frameId = window.requestAnimationFrame(align);
    return () => {
      cancelled = true;
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [assistantMessageId, ctx]);

  return (
    <div className="pt-1 pb-1.5">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
        className="chat-text group/turn-summary inline-flex items-center gap-1 rounded-md px-0 py-0.5 text-[13px] leading-5 text-muted-foreground/70 transition-colors hover:text-foreground/75"
        data-turn-summary-toggle="true"
        data-turn-summary-collapsed={isCollapsed ? "true" : "false"}
        data-scroll-anchor-ignore
      >
        <span className="min-w-0 truncate">{elapsed ? `已处理 ${elapsed}` : "已处理"}</span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 -rotate-90 text-muted-foreground/58 transition-transform duration-200 group-hover/turn-summary:text-muted-foreground/80",
            !isCollapsed && "rotate-0",
          )}
        />
      </button>
    </div>
  );
}

/** Collapsible wrapper using the CSS Grid `1fr ↔ 0fr` trick so the inner
 *  row's natural height animates without measuring it.
 *
 *  We deliberately suppress transitions on the very first render so that
 *  switching threads or re-mounting the timeline doesn't replay the open
 *  animation — that's where the "page is jittering" feeling comes from.
 *  Transitions only kick in once the `collapsed` prop actually changes
 *  while this instance is alive (i.e. the user clicked the toggle). */
function CollapsibleMember({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}) {
  const initialCollapsedRef = useRef(collapsed);
  const [hasUserToggled, setHasUserToggled] = useState(false);
  useEffect(() => {
    if (collapsed !== initialCollapsedRef.current && !hasUserToggled) {
      setHasUserToggled(true);
    }
  }, [collapsed, hasUserToggled]);

  return (
    <div
      className={cn(
        "grid",
        hasUserToggled &&
          "transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
        collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
      )}
      aria-hidden={collapsed}
      data-collapsible-member="true"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function UserTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);
  const userAttachments = row.message.attachments ?? [];
  const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
  const imageAttachments = userAttachments.filter(
    (attachment) => attachment.type === "image" && attachment.previewUrl,
  );
  const fileAttachments = userAttachments.filter(
    (attachment) => attachment.type === "file" || !attachment.previewUrl,
  );
  const canRevertAgentWork = typeof row.revertTurnCount === "number";
  const editableText = displayedUserMessage.copyText || row.message.text;
  const canEditUserMessage =
    ctx.onSubmitEditedUserMessage !== null &&
    row.canEditUserMessage === true &&
    !activity.isWorking &&
    !activity.isRevertingCheckpoint;
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(editableText);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [submittedEditText, setSubmittedEditText] = useState<string | null>(null);
  const editTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const visibleMessageText =
    isSubmittingEdit && submittedEditText ? submittedEditText : row.message.text;
  const visibleDisplayedUserMessage = deriveDisplayedUserMessageState(visibleMessageText);
  const visibleTerminalContexts = visibleDisplayedUserMessage.contexts;
  const visibleHasUserMessageBody =
    visibleDisplayedUserMessage.visibleText.trim().length > 0 || visibleTerminalContexts.length > 0;
  const visibleHasUserMessageBubble = imageAttachments.length > 0 || visibleHasUserMessageBody;

  useEffect(() => {
    if (!isEditing) {
      setDraftText(editableText);
    }
  }, [editableText, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      const textArea = editTextAreaRef.current;
      if (!textArea) return;
      textArea.focus();
      textArea.selectionStart = textArea.value.length;
      textArea.selectionEnd = textArea.value.length;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isEditing]);

  const cancelEdit = useCallback(() => {
    if (isSubmittingEdit) return;
    setDraftText(editableText);
    setIsEditing(false);
  }, [editableText, isSubmittingEdit]);

  const submitEdit = useCallback(async () => {
    const trimmed = draftText.trim();
    if (!trimmed || !ctx.onSubmitEditedUserMessage || isSubmittingEdit) {
      return;
    }

    setIsSubmittingEdit(true);
    setSubmittedEditText(trimmed);
    try {
      await ctx.onSubmitEditedUserMessage(row.message.id, trimmed);
      setIsEditing(false);
    } catch {
      // 错误已由发送层写入线程错误横幅；这里保留编辑态方便用户重试。
      setSubmittedEditText(null);
    } finally {
      setIsSubmittingEdit(false);
    }
  }, [ctx, draftText, isSubmittingEdit, row.message.id]);

  return (
    <>
      <div className="flex justify-end">
        <div className="group flex max-w-[80%] flex-col items-end">
          {isEditing && !isSubmittingEdit ? (
            <div className="w-[min(46rem,calc(100vw-2rem))] max-w-full rounded-md border border-border/60 bg-white px-3 py-3 shadow-sm dark:bg-background">
              <textarea
                ref={editTextAreaRef}
                value={draftText}
                disabled={isSubmittingEdit}
                rows={Math.max(2, Math.min(8, draftText.split("\n").length))}
                onChange={(event) => setDraftText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEdit();
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void submitEdit();
                  }
                }}
                className="chat-text block max-h-64 min-h-16 w-full resize-none border-none bg-transparent px-0 py-0 text-[14px] leading-[1.78] text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-wait"
                aria-label="编辑用户消息"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={isSubmittingEdit}
                  onClick={cancelEdit}
                  className="rounded-md border-border/60 bg-background/80 px-3 text-foreground/80 shadow-none hover:bg-background"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="xs"
                  disabled={draftText.trim().length === 0 || isSubmittingEdit}
                  onClick={() => void submitEdit()}
                  className="rounded-md px-3"
                >
                  发送
                </Button>
              </div>
            </div>
          ) : (
            <>
              {fileAttachments.length > 0 ? (
                <div className="mb-2 flex max-w-full flex-wrap justify-end gap-1.5">
                  {fileAttachments.map((attachment) => (
                    <UserFileAttachmentChip key={attachment.id} attachment={attachment} />
                  ))}
                </div>
              ) : null}
              {visibleHasUserMessageBubble ? (
                <div className="w-fit max-w-full rounded-[18px] border border-border/55 bg-secondary px-4 py-2.5">
                  {imageAttachments.length > 0 ? (
                    <div
                      className={cn(
                        "grid max-w-[548px] gap-3",
                        imageAttachments.length === 1 ? "grid-cols-1" : "grid-cols-2",
                        visibleHasUserMessageBody && "mb-2",
                      )}
                    >
                      {imageAttachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="overflow-hidden rounded-lg border border-border bg-background"
                        >
                          <button
                            type="button"
                            className="h-full w-full cursor-zoom-in"
                            aria-label={`预览 ${attachment.name}`}
                            onClick={() => {
                              const preview = buildExpandedImagePreview(
                                userAttachments,
                                attachment.id,
                              );
                              if (!preview) return;
                              ctx.onImageExpand(preview);
                            }}
                          >
                            <img
                              src={attachment.previewUrl}
                              alt={attachment.name}
                              className="block h-auto max-h-[396px] w-full object-cover"
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {visibleHasUserMessageBody ? (
                    <CollapsibleUserMessageBody
                      text={visibleDisplayedUserMessage.visibleText}
                      terminalContexts={visibleTerminalContexts}
                      skills={ctx.skills}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          )}
          <div
            className="mt-1 flex min-h-5 items-center justify-end gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100"
            data-user-message-actions="true"
          >
            <span className="px-0 text-[11px] text-muted-foreground/45">
              {formatTimestamp(row.message.createdAt, ctx.timestampFormat)}
            </span>
            {displayedUserMessage.copyText && (
              <MessageCopyButton
                text={displayedUserMessage.copyText}
                size="icon-xs"
                className="border-border/55 bg-background/80 text-muted-foreground/70 shadow-none hover:border-border/75 hover:bg-background hover:text-foreground"
              />
            )}
            {ctx.goalMessageIds.has(row.message.id) ? <GoalMessageMarker /> : null}
            {canRevertAgentWork && <RevertUserMessageButton messageId={row.message.id} />}
            {canEditUserMessage ? (
              <EditUserMessageButton
                disabled={isEditing || isSubmittingEdit}
                onClick={() => setIsEditing(true)}
              />
            ) : null}
          </div>
        </div>
      </div>
      {row.showCompletionDivider && <AssistantCompletionDivider />}
    </>
  );
}

function UserFileAttachmentChip({
  attachment,
}: {
  attachment: NonNullable<TimelineMessage["attachments"]>[number];
}) {
  const ctx = use(TimelineRowCtx);
  const className =
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 text-[12px] font-medium leading-none text-foreground shadow-sm transition-colors hover:border-border hover:bg-muted/45";
  const content = (
    <>
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
      <span className="min-w-0 truncate">{attachment.name}</span>
    </>
  );

  const openAttachmentFolder = async () => {
    const environmentApi = readEnvironmentApi(ctx.activeThreadEnvironmentId);
    const localApi = readLocalApi();
    if (!environmentApi || !localApi) {
      toastManager.add({
        type: "error",
        title: "无法打开文件夹",
        description: "本地或当前环境连接不可用。",
      });
      return;
    }

    try {
      const result = await environmentApi.server.resolveAttachmentPath({
        attachmentId: attachment.id,
      });
      if (!result.path) {
        throw new Error("未能定位该附件的本地保存路径。");
      }
      await revealFileInFolder(localApi, result.path);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "无法打开文件夹",
        description: error instanceof Error ? error.message : "打开文件夹失败。",
      });
    }
  };

  return (
    <button
      type="button"
      className={cn(className, "cursor-pointer")}
      title={attachment.name}
      aria-label={`打开 ${attachment.name} 所在文件夹`}
      onClick={() => void openAttachmentFolder()}
    >
      {content}
    </button>
  );
}

function EditUserMessageButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            disabled={disabled}
            onClick={onClick}
            title="编辑并作为新需求发送"
            aria-label="编辑并作为新需求发送"
            className="border-border/55 bg-background/80 text-muted-foreground/70 shadow-none hover:border-border/75 hover:bg-background hover:text-foreground"
          />
        }
      >
        <PencilIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>
        <p>编辑并作为新需求发送</p>
      </TooltipPopup>
    </Tooltip>
  );
}

function RevertUserMessageButton({ messageId }: { messageId: MessageId }) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            disabled={activity.isRevertingCheckpoint || activity.isWorking}
            onClick={() => ctx.onRevertUserMessage(messageId)}
            title="Revert to before this message"
            aria-label="Revert to before this message"
            className="border-border/55 bg-background/80 text-muted-foreground/70 shadow-none hover:border-border/75 hover:bg-background hover:text-foreground"
          />
        }
      >
        <Undo2Icon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>
        <p>Restore files and chat to before this message</p>
      </TooltipPopup>
    </Tooltip>
  );
}

function GoalMessageMarker() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex h-6 select-none items-center gap-1.5 rounded-md px-1.5 text-[12px] font-normal text-muted-foreground/70"
            aria-label="目标"
          />
        }
      >
        <GoalIcon className="size-3.5" />
        <span>目标</span>
      </TooltipTrigger>
      <TooltipPopup>
        <p>这条消息以目标模式发送</p>
      </TooltipPopup>
    </Tooltip>
  );
}

function trimAssistantUrl(value: string): string {
  let output = value.replace(/[.,;!?，。；！？]+$/g, "");
  while (output.endsWith(")") || output.endsWith("]") || output.endsWith("}")) {
    const close = output.charAt(output.length - 1);
    const open = close === ")" ? "(" : close === "]" ? "[" : "{";
    const opens = output.split(open).length - 1;
    const closes = output.split(close).length - 1;
    if (opens >= closes) break;
    output = output.slice(0, -1);
  }
  return output;
}

function extractAssistantUrls(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  ASSISTANT_URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(ASSISTANT_URL_PATTERN)) {
    const url = trimAssistantUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function UrlPreviewCard({ url }: { url: string }) {
  const ctx = use(TimelineRowCtx);
  const onOpenUrl = ctx.onOpenUrl;
  if (!onOpenUrl) {
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-card/45 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
          <GlobeIcon className="size-5" />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpenUrl(url, "preview")}
          title={url}
        >
          <div className="chat-text truncate text-[14px] font-medium leading-5 text-foreground">
            网页预览
          </div>
          <div className="truncate text-[13px] leading-5 text-muted-foreground">网站</div>
        </button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-[13px]"
              >
                打开方式
                <ChevronDownIcon className="size-3.5 opacity-60" />
              </Button>
            }
          />
          <MenuPopup align="end">
            <MenuItem onClick={() => onOpenUrl(url, "preview")}>侧边预览</MenuItem>
            <MenuItem onClick={() => onOpenUrl(url, "external")}>外部浏览器</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}

function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
  const previewUrl = row.showUrlPreviewCard ? (extractAssistantUrls(messageText)[0] ?? null) : null;

  return (
    <>
      {row.showSteerMarkerBefore ? <SteerConversationMarker /> : null}
      <div className="min-w-0 py-0.5">
        <ChatMarkdown
          text={messageText}
          cwd={ctx.markdownCwd}
          isStreaming={Boolean(row.message.streaming)}
          skills={ctx.skills}
          onOpenFile={ctx.onOpenMarkdownFile}
        />
        <AssistantChangedFilesSection
          turnSummary={row.assistantTurnDiffSummary}
          markdownCwd={ctx.markdownCwd}
          workspaceRoot={ctx.workspaceRoot}
          onOpenFile={ctx.onOpenMarkdownFile}
          onOpenTurnDiff={ctx.onOpenTurnDiff}
        />
        {previewUrl ? <UrlPreviewCard url={previewUrl} /> : null}
        {row.showAssistantMeta ? (
          <div className="mt-1 flex items-center gap-2">
            <p className="text-[11px] text-muted-foreground/45" data-assistant-message-meta="true">
              {row.message.streaming ? (
                <LiveMessageMeta
                  createdAt={row.message.createdAt}
                  durationStart={row.durationStart}
                  timestampFormat={ctx.timestampFormat}
                />
              ) : (
                formatMessageMeta(
                  row.message.createdAt,
                  formatElapsed(row.durationStart, row.message.completedAt),
                  ctx.timestampFormat,
                )
              )}
            </p>
            <AssistantCopyButton row={row} />
          </div>
        ) : null}
      </div>
      {row.showCompletionDivider && <AssistantCompletionDivider />}
    </>
  );
}

function SteerConversationMarker() {
  return (
    <div
      className="mb-1.5 px-1 text-[13px] leading-5 text-muted-foreground/55"
      data-steer-conversation-marker="true"
    >
      已引导对话
    </div>
  );
}

function AssistantCopyButton({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const activity = use(TimelineRowActivityCtx);
  const assistantTurnStillInProgress =
    activity.activeTurnInProgress &&
    activity.activeTurnId !== null &&
    row.message.turnId === activity.activeTurnId;
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: row.message.text ?? null,
    showCopyButton: row.showAssistantCopyButton,
    streaming: Boolean(row.message.streaming) || assistantTurnStillInProgress,
  });

  if (!assistantCopyState.visible || !assistantCopyState.text) {
    return null;
  }

  return (
    <div className="opacity-0 transition-opacity duration-200 group-hover/assistant:opacity-100 focus-within:opacity-100">
      <MessageCopyButton
        text={assistantCopyState.text}
        size="icon-xs"
        variant="outline"
        className="border-border/50 bg-background/35 text-muted-foreground/45 shadow-none hover:border-border/70 hover:bg-background/55 hover:text-muted-foreground/70"
      />
    </div>
  );
}

function AssistantCompletionDivider() {
  const activity = use(TimelineRowActivityCtx);

  return (
    <div className="my-3 flex flex-col gap-2">
      <span className="self-start text-[13px] leading-5 text-muted-foreground/62">
        {activity.completionSummary ?? "已结束"}
      </span>
      <span className="h-px bg-border/70" />
    </div>
  );
}

function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposedPlanCard
        planMarkdown={row.proposedPlan.planMarkdown}
        environmentId={ctx.activeThreadEnvironmentId}
        cwd={ctx.markdownCwd}
        workspaceRoot={ctx.workspaceRoot}
        onOpenFile={ctx.onOpenMarkdownFile}
      />
    </div>
  );
}

function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  return (
    <div className="py-0.5 pl-1.5" data-working-started-at={row.createdAt ?? undefined}>
      <RunningStatusShimmer label="正在思考" />
    </div>
  );
}

function RunningStatusShimmer({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex min-w-0 max-w-full items-center py-1", className)}
      style={{
        // 强制覆盖字号，确保清晰可见
        fontSize: "14px",
      }}
      aria-busy="true"
    >
      {/* 使用纯原生 CSS 注入动画与渐变，确保绝对兼容 */}
      <span
        style={{
          display: "inline-block",
          fontWeight: 500,
          letterSpacing: 0,
          // 1. 设置渐变背景：深灰 -> 极亮白 -> 深灰
          backgroundImage: "linear-gradient(90deg, #8a8a8a 0%, #f7f7f7 50%, #8a8a8a 100%)",
          backgroundSize: "200% 100%",
          // 2. 核心：将背景裁剪到文字上
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          // 3. 注入原生的扫光动画（无限循环）
          animation: "textShimmerMoving 2.5s linear infinite",
        }}
      >
        {label}

        {/* 注入全局动画的关键帧（只在组件渲染时生效，不污染全局） */}
        <style>{`
      @keyframes textShimmerMoving {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `}</style>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ImageGenerationTimelineRow — first-class media card in the chat stream.
//
// While the model is generating an image the row renders a Skeleton-Shimmer
// placeholder. Once the final image path is available we swap to a real
// <img>, fade it in, and hook into ExpandedImagePreview so it shares the
// same lightbox UX as user-uploaded images.
//
// When a single request produces multiple images (e.g. an n=4 prompt) the
// row spreads them in a responsive grid — each tile shimmers independently
// and resolves to the final image as it arrives, matching the behavior of
// ChatGPT / DALL-E / Midjourney's batch view.
// ---------------------------------------------------------------------------

type ImageGenerationRowKind = Extract<TimelineRow, { kind: "image-generation" }>;
type ImageGenerationItem = ImageGenerationRowKind["items"][number];

interface ResolvedImageGenerationItem {
  readonly item: ImageGenerationItem;
  readonly resolvedSrc: string | null;
  readonly resolvedName: string;
  readonly isFinal: boolean;
  readonly isFailed: boolean;
}

function resolveImageGenerationItem(item: ImageGenerationItem): ResolvedImageGenerationItem {
  const resolvedSrc = item.imagePath
    ? (rewriteMarkdownFileUriHref(item.imagePath) ?? item.imagePath)
    : null;
  const resolvedName = (() => {
    if (!item.imagePath) return item.label ?? "Generated image";
    const segments = item.imagePath.split(/[\\/]/);
    return segments.at(-1) || item.label || "Generated image";
  })();
  return {
    item,
    resolvedSrc,
    resolvedName,
    isFinal: item.status !== "running" && Boolean(resolvedSrc),
    isFailed: item.status === "failed" && !resolvedSrc,
  };
}

function ImageGenerationTimelineRow({ row }: { row: ImageGenerationRowKind }) {
  const ctx = use(TimelineRowCtx);
  const resolved = useMemo<ResolvedImageGenerationItem[]>(
    () => row.items.map(resolveImageGenerationItem),
    [row.items],
  );

  const finalItems = useMemo(
    () =>
      resolved.filter(
        (entry): entry is ResolvedImageGenerationItem & { resolvedSrc: string } =>
          entry.isFinal && entry.resolvedSrc !== null,
      ),
    [resolved],
  );

  const handleExpand = useCallback(
    (selectedId: string) => {
      if (finalItems.length === 0) return;
      const preview = buildExpandedImagePreview(
        finalItems.map((entry) => ({
          id: entry.item.id,
          name: entry.resolvedName,
          previewUrl: entry.resolvedSrc,
        })),
        selectedId,
      );
      if (!preview) return;
      ctx.onImageExpand(preview);
    },
    [ctx, finalItems],
  );

  const isMulti = resolved.length > 1;
  const overallStatus = resolved.some((entry) => entry.item.status === "running")
    ? "running"
    : resolved.some((entry) => entry.item.status === "failed")
      ? "failed"
      : "completed";

  return (
    <div
      className="py-1"
      data-image-generation-row="true"
      data-image-status={overallStatus}
      data-image-count={resolved.length}
    >
      <div className={cn("flex flex-wrap gap-3", isMulti ? "max-w-[636px]" : "max-w-[424px]")}>
        {resolved.map((entry) => (
          <ImageGenerationTile
            key={entry.item.id}
            entry={entry}
            tileMaxWidth={isMulti ? 204 : 424}
            tileBasis={isMulti ? "min(204px, 100%)" : "100%"}
            onExpand={handleExpand}
          />
        ))}
      </div>
    </div>
  );
}

const ImageGenerationTile = memo(function ImageGenerationTile({
  entry,
  tileMaxWidth,
  tileBasis,
  onExpand,
}: {
  entry: ResolvedImageGenerationItem;
  tileMaxWidth: number;
  tileBasis: string;
  onExpand: (selectedId: string) => void;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const src = entry.resolvedSrc;
  const showFinalImage = entry.isFinal && Boolean(src);
  const showFailure = entry.isFailed;

  useEffect(() => {
    setImageLoaded(false);
  }, [src]);

  return (
    <div
      className="min-w-[180px] flex-1"
      style={{ maxWidth: `${tileMaxWidth}px`, flexBasis: tileBasis }}
      data-image-generation-tile="true"
      data-image-tile-status={
        showFailure ? "failed" : showFinalImage && imageLoaded ? "final" : "running"
      }
    >
      {showFailure ? (
        <div className="flex aspect-[4/3] min-h-[168px] w-full flex-col items-start justify-center gap-2 rounded-xl border border-destructive/35 bg-destructive/8 p-4 text-destructive shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CircleAlertIcon className="size-4 shrink-0" />
            <span>{entry.item.label ?? "图片生成失败"}</span>
          </div>
          {entry.item.errorMessage ? (
            <p className="line-clamp-4 text-xs leading-5 text-destructive/80">
              {entry.item.errorMessage}
            </p>
          ) : null}
        </div>
      ) : showFinalImage && src ? (
        <button
          type="button"
          className={cn(
            "group/image-card relative block w-full overflow-hidden rounded-xl border border-border/55 bg-background",
            imageLoaded ? "cursor-zoom-in" : "cursor-default",
          )}
          aria-label={`Preview ${entry.resolvedName}`}
          aria-busy={imageLoaded ? undefined : true}
          disabled={!imageLoaded}
          onClick={() => {
            if (imageLoaded) {
              onExpand(entry.item.id);
            }
          }}
        >
          <ImageGenerationShimmer
            maxWidth="100%"
            label={entry.item.label ?? "正在生成图片…"}
            className={cn(
              "absolute inset-0 z-10 max-w-none border-0 transition-opacity duration-150 ease-out",
              imageLoaded ? "pointer-events-none opacity-0" : "opacity-100",
            )}
            paused={imageLoaded}
          />
          <img
            src={src}
            alt={entry.resolvedName}
            className={cn(
              "block h-auto w-full object-cover opacity-0 transition-[opacity,transform] duration-300 ease-out",
              imageLoaded && "opacity-100 group-hover/image-card:scale-[1.01]",
            )}
            onLoad={() => setImageLoaded(true)}
          />
        </button>
      ) : (
        <ImageGenerationShimmer maxWidth="100%" label={entry.item.label ?? "正在生成图片…"} />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Self-ticking labels — update their own text nodes so elapsed-time display
// does not create a React commit every second while a response is streaming.
// ---------------------------------------------------------------------------

/** Live timestamp + elapsed duration for a streaming assistant message. */
function LiveMessageMeta({
  createdAt,
  durationStart,
  timestampFormat,
}: {
  createdAt: string;
  durationStart: string | null | undefined;
  timestampFormat: TimestampFormat;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatLiveMessageMetaNow(createdAt, durationStart, timestampFormat);

  useEffect(() => {
    const updateText = () => {
      if (textRef.current) {
        textRef.current.textContent = formatLiveMessageMetaNow(
          createdAt,
          durationStart,
          timestampFormat,
        );
      }
    };
    updateText();
    if (!durationStart) {
      return;
    }
    const id = setInterval(updateText, 1000);
    return () => clearInterval(id);
  }, [createdAt, durationStart, timestampFormat]);

  return <span ref={textRef}>{initialText}</span>;
}

// ---------------------------------------------------------------------------
// Extracted row sections — own their state / store subscriptions so changes
// re-render only the affected row, not the entire list.
// ---------------------------------------------------------------------------

/** Owns its own expand/collapse state so toggling re-renders only this row.
 *  State resets on unmount which is fine — work groups start collapsed. */
const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
  turnDiffSummary,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
  turnDiffSummary: TurnDiffSummary | undefined;
}) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const [isExpanded, setIsExpanded] = useState(false);
  const compactRequestErrorMessage = getCompactRequestErrorMessage(groupedEntries);
  const summary = summarizeWorkGroup(groupedEntries);
  const showLiveScan = groupedEntries.some((entry) => entry.status === "running");

  if (compactRequestErrorMessage) {
    return <CompactRequestErrorRow message={compactRequestErrorMessage} />;
  }

  if (groupedEntries.length === 1 && groupedEntries[0]?.userInputSummary) {
    return <UserInputSummaryTimelineRow workEntry={groupedEntries[0]} />;
  }

  if (groupedEntries.length === 1 && isFileChangeWorkEntry(groupedEntries[0]!, turnDiffSummary)) {
    return (
      <div className="pt-2 pb-3 pl-1">
        <SimpleWorkEntryRow
          workEntry={groupedEntries[0]!}
          workspaceRoot={workspaceRoot}
          turnDiffSummary={turnDiffSummary}
        />
      </div>
    );
  }

  if (groupedEntries.length === 1 && isCommandWorkEntry(groupedEntries[0]!)) {
    return (
      <div className="pt-2 pb-3 pl-1">
        <CommandWorkEntryRow workEntry={groupedEntries[0]!} />
      </div>
    );
  }

  const isSearchGroup = isSearchWorkGroup(groupedEntries);
  const SummaryIcon = isSearchGroup ? GlobeIcon : TerminalSquareIcon;

  return (
    <div className="pt-2 pb-3 pl-1">
      <button
        type="button"
        className="chat-text group/work-summary flex max-w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[13px] leading-5 text-muted-foreground/62 transition-colors hover:text-foreground/78"
        aria-expanded={isExpanded}
        data-work-group-summary="true"
        onClick={() => setIsExpanded((value) => !value)}
      >
        <SummaryIcon className="size-4 shrink-0 text-muted-foreground/58" />
        {showLiveScan ? (
          <RunningStatusShimmer className="-my-0.5" label={summary.liveLabel} />
        ) : (
          <span className="min-w-0 truncate">{summary.label}</span>
        )}
        {isExpanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/52 transition-colors group-hover/work-summary:text-muted-foreground/75" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/42 transition-colors group-hover/work-summary:text-muted-foreground/70" />
        )}
      </button>
      {isExpanded ? (
        <div className="mt-1 space-y-0.5 pl-4" data-work-group-details="true">
          {isSearchGroup ? (
            <SearchWorkGroupDetails groupedEntries={groupedEntries} />
          ) : (
            groupedEntries.map((workEntry) => (
              <SimpleWorkEntryRow
                key={`work-row:${workEntry.id}`}
                workEntry={workEntry}
                workspaceRoot={workspaceRoot}
                turnDiffSummary={turnDiffSummary}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
});

function isSearchWorkEntry(entry: TimelineWorkEntry): boolean {
  return entry.toolFamily === "search" || entry.itemType === "web_search";
}

function isSearchWorkGroup(entries: ReadonlyArray<TimelineWorkEntry>): boolean {
  return entries.length > 0 && entries.every(isSearchWorkEntry);
}

function isFileChangeWorkEntry(
  entry: TimelineWorkEntry,
  turnDiffSummary?: TurnDiffSummary | undefined,
): boolean {
  const hasStructuredFileChange =
    entry.requestKind === "file-change" ||
    entry.itemType === "file_change" ||
    (entry.changedFiles?.length ?? 0) > 0;
  const hasOnlyTurnDiffFileChange =
    entry.status === "completed" &&
    (turnDiffSummary?.files.length ?? 0) > 0 &&
    !(entry.detail?.trim() || entry.output?.trim()) &&
    (entry.changedFiles?.length ?? 0) === 0;

  return (
    hasStructuredFileChange ||
    hasOnlyTurnDiffFileChange
  );
}

function searchWorkEntryDetail(entry: TimelineWorkEntry): string | null {
  const detail = workEntryPreview(entry, undefined)?.trim();
  if (detail) {
    return detail;
  }
  const label = normalizeCompactToolLabel(entry.toolTitle ?? entry.label).trim();
  return label.length > 0 ? label : null;
}

const SearchWorkGroupDetails = memo(function SearchWorkGroupDetails({
  groupedEntries,
}: {
  groupedEntries: ReadonlyArray<TimelineWorkEntry>;
}) {
  const details = [
    ...new Set(
      groupedEntries
        .map(searchWorkEntryDetail)
        .filter((detail): detail is string => detail !== null),
    ),
  ];

  if (details.length === 0) {
    return <p className="px-0.5 text-[13px] leading-5 text-muted-foreground/55">搜索详情不可用</p>;
  }

  return (
    <div className="space-y-0.5">
      {details.map((detail) => (
        <p
          key={detail}
          className="px-0.5 text-[13px] leading-5 text-muted-foreground/65 wrap-break-word"
          title={detail}
        >
          {detail}
        </p>
      ))}
    </div>
  );
});

function getCompactRequestErrorMessage(entries: ReadonlyArray<TimelineWorkEntry>): string | null {
  if (entries.length !== 1) {
    return null;
  }
  const entry = entries[0];
  if (!entry || entry.tone !== "error") {
    return null;
  }
  if (
    entry.command ||
    entry.rawCommand ||
    entry.requestKind ||
    (entry.changedFiles?.length ?? 0) > 0 ||
    entry.toolFamily === "command" ||
    entry.toolFamily === "file"
  ) {
    return null;
  }
  const message = (entry.detail || entry.label).trim();
  return message.length > 0 ? message : null;
}

const CompactRequestErrorRow = memo(function CompactRequestErrorRow({
  message,
}: {
  message: string;
}) {
  return (
    <div className="pt-2 pb-3">
      <div
        className="flex min-h-10 items-center gap-3 rounded-2xl border border-border/75 bg-background px-4 py-2.5 text-[13px] leading-5 text-foreground shadow-[0_1px_0_rgba(0,0,0,0.02)]"
        title={message}
      >
        <CircleAlertIcon className="size-4 shrink-0 text-foreground/80" />
        <p className="min-w-0 flex-1 truncate">{message}</p>
      </div>
    </div>
  );
});

function summarizeWorkGroup(entries: ReadonlyArray<TimelineWorkEntry>): {
  label: string;
  liveLabel: string;
} {
  if (isSearchWorkGroup(entries)) {
    const runningEntry = entries.find((entry) => entry.status === "running") ?? null;
    const preview = runningEntry ? searchWorkEntryDetail(runningEntry) : null;
    return {
      label: `已搜索网页 ${entries.length} 次`,
      liveLabel: preview ? `正在搜索 ${preview}` : "正在搜索网页",
    };
  }

  const commandCount = entries.filter(isCommandWorkEntry).length;
  const changedFileCount = new Set(entries.flatMap((entry) => [...(entry.changedFiles ?? [])]))
    .size;
  const runningEntry = entries.find((entry) => entry.status === "running") ?? null;
  const runningAction = runningEntry ? runningWorkEntryLabel(runningEntry) : "正在处理";

  if (commandCount > 0 && changedFileCount > 0) {
    return {
      label: `已运行 ${commandCount} 条命令，已编辑 ${changedFileCount} 个文件`,
      liveLabel: runningAction,
    };
  }
  if (commandCount > 0) {
    return {
      label: `已运行 ${commandCount} 条命令`,
      liveLabel: runningAction,
    };
  }
  if (changedFileCount > 0) {
    return {
      label: `已编辑 ${changedFileCount} 个文件`,
      liveLabel: runningAction,
    };
  }
  return {
    label: `已处理 ${entries.length} 项`,
    liveLabel: runningAction,
  };
}

function runningWorkEntryLabel(entry: TimelineWorkEntry): string {
  const statusLabel = resolveRunningWorkEntryStatusLabel(entry);
  if (isCommandWorkEntry(entry)) {
    const preview = workEntryPreview(entry, undefined);
    return preview ? `${statusLabel ?? "正在运行"} ${preview}` : "正在运行命令";
  }
  if (statusLabel) {
    const preview = workEntryPreview(entry, undefined);
    return preview ? `${statusLabel} ${preview}` : statusLabel;
  }
  return `正在处理 ${toolWorkEntryHeading(entry)}`;
}

/** Subscribes directly to the UI state store for expand/collapse state,
 *  so toggling re-renders only this component — not the entire list. */
const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
  markdownCwd,
  workspaceRoot,
  onOpenFile,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary | undefined;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  onOpenFile?: ((file: MarkdownFileLinkMeta) => void) | undefined;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  if (!turnSummary) return null;
  const checkpointFiles = buildCheckpointFileItems({
    files: turnSummary.files,
    markdownCwd,
    workspaceRoot,
  });
  if (checkpointFiles.length === 0) return null;

  return (
    <AssistantChangedFilesSectionInner
      turnSummary={turnSummary}
      checkpointFiles={checkpointFiles}
      workspaceRoot={workspaceRoot}
      onOpenFile={onOpenFile}
      onOpenTurnDiff={onOpenTurnDiff}
    />
  );
});

/** Inner component that only mounts when there are actual changed files,
 *  so the store subscription is unconditional (no hooks after early return). */
function AssistantChangedFilesSectionInner({
  turnSummary,
  checkpointFiles,
  workspaceRoot,
  onOpenFile,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary;
  checkpointFiles: CheckpointFileItem[];
  workspaceRoot: string | undefined;
  onOpenFile?: ((file: MarkdownFileLinkMeta) => void) | undefined;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const [showAllFiles, setShowAllFiles] = useState(false);
  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
  const isSingleFile = checkpointFiles.length === 1;
  const firstFile = checkpointFiles[0];
  const visibleFiles = showAllFiles ? checkpointFiles : checkpointFiles.slice(0, 3);
  const hiddenFileCount = Math.max(0, checkpointFiles.length - visibleFiles.length);
  const singleFileTitle = firstFile
    ? basenameOfChangedFile(firstFile.path)
    : `${checkpointFiles.length} 个文件`;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-card/70 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          <FilePlus2Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="chat-text truncate text-[14px] font-medium leading-5 text-foreground">
                {isSingleFile && firstFile ? (
                  <span className="inline-flex min-w-0 max-w-full items-baseline gap-1">
                    <span className="shrink-0">已编辑</span>
                    <ChangedFileOpenButton
                      filePath={firstFile.linkMeta?.filePath ?? firstFile.path}
                      displayPath={singleFileTitle}
                      title={firstFile.linkMeta?.displayPath ?? singleFileTitle}
                      className="min-w-0"
                      onOpenFile={firstFile.linkMeta ? onOpenFile : undefined}
                    />
                  </span>
                ) : (
                  `已编辑 ${checkpointFiles.length} 个文件`
                )}
              </div>
              {hasNonZeroStat(summaryStat) ? (
                <div className="mt-0.5 font-mono text-[13px] leading-5 tabular-nums">
                  <DiffStatLabel
                    additions={summaryStat.additions}
                    deletions={summaryStat.deletions}
                  />
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled
                title="撤销更改暂不可用"
                className="h-8 gap-1 rounded-md px-2 text-[13px] text-foreground opacity-70"
              >
                撤销
                <Undo2Icon className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg px-3 text-[13px] font-medium"
                onClick={() => onOpenTurnDiff(turnSummary.turnId, firstFile?.path)}
              >
                审核
              </Button>
            </div>
          </div>
          {!isSingleFile ? (
            <div className="mt-4 space-y-3">
              {visibleFiles.map((file) => (
                <button
                  key={`${turnSummary.turnId}:${file.path}`}
                  type="button"
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left text-[13px] leading-5 hover:text-foreground"
                  onClick={() => onOpenTurnDiff(turnSummary.turnId, file.path)}
                >
                  <ChangedFileOpenButton
                    filePath={file.linkMeta?.filePath ?? file.path}
                    displayPath={formatChangedFilePath(file.path, workspaceRoot)}
                    title={
                      file.linkMeta?.displayPath ?? formatChangedFilePath(file.path, workspaceRoot)
                    }
                    className="min-w-0"
                    onOpenFile={file.linkMeta ? onOpenFile : undefined}
                    stopPropagation
                  />
                  <span className="shrink-0 font-mono text-[13px] tabular-nums">
                    <DiffStatLabel
                      additions={file.additions ?? 0}
                      deletions={file.deletions ?? 0}
                    />
                  </span>
                </button>
              ))}
              {hiddenFileCount > 0 || showAllFiles ? (
                <button
                  type="button"
                  className="inline-flex h-6 items-center gap-1 text-[13px] text-foreground/90 hover:text-foreground"
                  onClick={() => setShowAllFiles((value) => !value)}
                >
                  {showAllFiles ? "收起文件" : `再显示 ${hiddenFileCount} 个文件`}
                  <ChevronDownIcon
                    className={cn("size-3.5 transition-transform", showAllFiles && "rotate-180")}
                  />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface CheckpointFileItem {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  linkMeta?: MarkdownFileLinkMeta | undefined;
}

export function buildCheckpointFileItems({
  files,
  markdownCwd,
  workspaceRoot,
}: {
  files: ReadonlyArray<TurnDiffSummary["files"][number]>;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
}): CheckpointFileItem[] {
  const rootPath = markdownCwd ?? workspaceRoot;
  return files.flatMap((file) => {
    if (!file.path) {
      return [];
    }
    const linkMeta = isDeletedFileKind(file.kind)
      ? null
      : buildCheckpointDeliverableLinkMeta(file.path, rootPath);
    return [{ ...file, ...(linkMeta ? { linkMeta } : {}) }];
  });
}

function buildCheckpointDeliverableLinkMeta(
  filePath: string,
  rootPath: string | undefined,
): MarkdownFileLinkMeta | null {
  const targetPath = resolveCheckpointDeliverableTarget(filePath, rootPath);
  if (!targetPath) {
    return null;
  }
  return {
    filePath: targetPath,
    targetPath,
    previewPath: filePath,
    displayPath: formatWorkspaceRelativePath(targetPath, rootPath),
    basename: basenameOfChangedFile(targetPath),
  };
}

function resolveCheckpointDeliverableTarget(
  filePath: string,
  rootPath: string | undefined,
): string | null {
  if (/^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath) || filePath.startsWith("/")) {
    return filePath;
  }
  if (!rootPath) {
    return null;
  }
  const root = rootPath.replace(/[\\/]+$/, "");
  return `${root}/${filePath.replace(/^[\\/]+/, "").replaceAll("\\", "/")}`;
}

function isDeletedFileKind(kind: string | undefined): boolean {
  const normalized = kind?.trim().toLowerCase().replace(/_/g, "-") ?? "";
  return normalized === "deleted" || normalized === "removed" || normalized === "delete";
}

function basenameOfChangedFile(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function formatChangedFilePath(filePath: string, workspaceRoot: string | undefined): string {
  const displayedPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
  if (!workspaceRoot) return displayedPath;
  const normalizedWorkspaceName = workspaceRoot
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .at(-1);
  if (normalizedWorkspaceName && displayedPath.startsWith(`${normalizedWorkspaceName}/`)) {
    return displayedPath.slice(normalizedWorkspaceName.length + 1);
  }
  return displayedPath;
}

function formatChangedFileListLabel(filePath: string): string {
  return basenameOfChangedFile(filePath);
}

function buildChangedFileLinkMeta(filePath: string, displayPath: string): MarkdownFileLinkMeta {
  return {
    filePath,
    targetPath: filePath,
    previewPath: filePath,
    displayPath,
    basename: basenameOfChangedFile(filePath),
  };
}

function ChangedFileOpenButton({
  filePath,
  displayPath,
  title,
  className,
  onOpenFile,
  stopPropagation = false,
}: {
  filePath: string;
  displayPath: string;
  title?: string | undefined;
  className?: string | undefined;
  onOpenFile?: ((file: MarkdownFileLinkMeta) => void) | undefined;
  stopPropagation?: boolean | undefined;
}) {
  if (!onOpenFile || isBareMarkdownPreviewPath(filePath)) {
    return (
      <span className={className} title={title ?? displayPath}>
        {displayPath}
      </span>
    );
  }

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
    onOpenFile(buildChangedFileLinkMeta(filePath, displayPath));
  };

  return (
    <button
      type="button"
      className={cn(
        "min-w-0 truncate text-left font-mono text-[#147DFF] underline-offset-2 transition-colors hover:text-[#0F66D0] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      title={title ?? displayPath}
      onClick={handleClick}
    >
      {displayPath}
    </button>
  );
}

interface InlineDiffFileSummary {
  path: string;
  displayPath: string;
  listLabel: string;
  additions: number;
  deletions: number;
  hasStats: boolean;
  kind?: string | undefined;
  patch: ReturnType<typeof parseUnifiedDiff>[number] | null;
}

function AnimatedDiffStatLabel(props: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] tabular-nums">
      <AnimatedDiffNumber value={props.additions} tone="add" />
      <AnimatedDiffNumber value={props.deletions} tone="delete" />
    </span>
  );
}

function AnimatedDiffNumber(props: { value: number; tone: "add" | "delete" }) {
  const [pulseKey, setPulseKey] = useState(0);
  const previousValueRef = useRef(props.value);

  useEffect(() => {
    if (previousValueRef.current !== props.value) {
      previousValueRef.current = props.value;
      setPulseKey((value) => value + 1);
    }
  }, [props.value]);

  const className = props.tone === "add" ? "text-emerald-600" : "text-red-500";
  const prefix = props.tone === "add" ? "+" : "-";
  return (
    <span
      key={`${props.tone}:${pulseKey}`}
      className={cn(
        "inline-block min-w-[2ch] animate-[diff-stat-bounce_260ms_cubic-bezier(0.2,0.8,0.2,1)]",
        className,
      )}
    >
      {prefix}
      {props.value}
    </span>
  );
}

function InlineChangedFilesDiff(props: { files: ReadonlyArray<InlineDiffFileSummary> }) {
  const renderableFiles = props.files.filter((file) => file.patch);
  if (renderableFiles.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 max-h-[264px] overflow-y-auto rounded-md border border-border/70 bg-card shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
      {renderableFiles.map((file) =>
        file.patch ? <InlineDiffFile key={file.path} file={file} patch={file.patch} /> : null,
      )}
    </div>
  );
}

function InlineDiffPlaceholder(props: { fileName: string; state: "loading" | "empty" }) {
  return (
    <div className="mt-1 rounded-md border border-border/70 bg-card shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/55 bg-muted/35 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] leading-4 text-muted-foreground">
          {props.fileName}
        </span>
      </div>
      <div className="px-3 py-2 text-[12px] leading-5 text-muted-foreground/70">
        {props.state === "loading" ? "正在加载 diff..." : "暂未获取到可展示的 diff 内容。"}
      </div>
    </div>
  );
}

function InlineDiffFile(props: {
  file: InlineDiffFileSummary;
  patch: ReturnType<typeof parseUnifiedDiff>[number];
}) {
  const [copied, setCopied] = useState(false);
  const copyPatch = useCallback(() => {
    const text = props.patch.hunks
      .flatMap((hunk) =>
        hunk.lines.map(
          (line) => `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.text}`,
        ),
      )
      .join("\n");
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    });
  }, [props.patch]);

  return (
    <div className="border-b border-border/45 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/55 bg-muted/35 px-3 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-left font-mono text-[12px] leading-4 text-muted-foreground"
          title={props.file.displayPath}
        >
          {props.file.listLabel}
        </span>
        <AnimatedDiffStatLabel additions={props.file.additions} deletions={props.file.deletions} />
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-background/80 hover:text-foreground"
          title={copied ? "已复制" : "复制 diff"}
          aria-label={copied ? "已复制 diff" : "复制 diff"}
          onClick={copyPatch}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      <div className="overflow-x-auto py-1">
        {props.patch.hunks.map((hunk, hunkIndex) => (
          <InlineDiffHunk key={`${hunk.oldStart}:${hunk.newStart}:${hunkIndex}`} hunk={hunk} />
        ))}
      </div>
    </div>
  );
}

function InlineDiffHunk(props: {
  hunk: ReturnType<typeof parseUnifiedDiff>[number]["hunks"][number];
}) {
  let oldLineNumber = props.hunk.oldStart;
  let newLineNumber = props.hunk.newStart;

  return (
    <div className="min-w-max">
      {props.hunk.lines.map((line, index) => {
        const oldDisplay = line.type === "add" ? null : oldLineNumber;
        const newDisplay = line.type === "remove" ? null : newLineNumber;
        if (line.type !== "add") oldLineNumber += 1;
        if (line.type !== "remove") newLineNumber += 1;
        return (
          <InlineDiffLine
            key={`${props.hunk.oldStart}:${props.hunk.newStart}:${index}`}
            line={line}
            oldLineNumber={oldDisplay}
            newLineNumber={newDisplay}
          />
        );
      })}
    </div>
  );
}

function InlineDiffLine(props: {
  line: UnifiedDiffLine;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}) {
  const lineClassName =
    props.line.type === "add"
      ? "border-l-2 border-emerald-600 bg-emerald-500/13 text-foreground"
      : props.line.type === "remove"
        ? "border-l-2 border-red-500 bg-red-500/11 text-foreground"
        : "border-l-2 border-transparent text-foreground/86";
  const lineNumberClassName =
    props.line.type === "add"
      ? "text-emerald-600"
      : props.line.type === "remove"
        ? "text-red-500"
        : "text-muted-foreground/78";
  const displayLineNumber = props.newLineNumber ?? props.oldLineNumber ?? "";

  return (
    <div
      className={cn(
        "grid min-w-max grid-cols-[4rem_1fr] font-mono text-[12px] leading-5",
        lineClassName,
      )}
    >
      <span className={cn("select-none bg-background/35 px-3 text-right", lineNumberClassName)}>
        {displayLineNumber}
      </span>
      <code className="whitespace-pre px-3 text-[12px]">
        {props.line.text.length > 0 ? props.line.text : " "}
      </code>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaf components
// ---------------------------------------------------------------------------

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const MAX_COLLAPSED_USER_MESSAGE_LINES = 8;
const MAX_COLLAPSED_USER_MESSAGE_LENGTH = 600;
const COLLAPSED_USER_MESSAGE_FADE_HEIGHT_REM = 1.75;
const COLLAPSED_USER_MESSAGE_FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${COLLAPSED_USER_MESSAGE_FADE_HEIGHT_REM}rem), transparent)`;

function shouldCollapseUserMessage(text: string): boolean {
  if (text.trim().length === 0) {
    return false;
  }

  return (
    text.length > MAX_COLLAPSED_USER_MESSAGE_LENGTH ||
    text.split("\n").length > MAX_COLLAPSED_USER_MESSAGE_LINES
  );
}

const CollapsibleUserMessageBody = memo(function CollapsibleUserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasVisibleBody = props.text.trim().length > 0 || props.terminalContexts.length > 0;
  const canCollapse = hasVisibleBody && shouldCollapseUserMessage(props.text);
  const isCollapsed = canCollapse && !expanded;

  return (
    <div>
      {hasVisibleBody ? (
        <div
          className={cn("relative", isCollapsed && "max-h-44 overflow-hidden")}
          data-user-message-body="true"
          data-user-message-collapsed={isCollapsed ? "true" : "false"}
          data-user-message-collapsible={canCollapse ? "true" : "false"}
          data-user-message-fade={isCollapsed ? "true" : "false"}
          style={
            isCollapsed
              ? {
                  WebkitMaskImage: COLLAPSED_USER_MESSAGE_FADE_MASK,
                  maskImage: COLLAPSED_USER_MESSAGE_FADE_MASK,
                }
              : undefined
          }
        >
          <UserMessageBody
            text={props.text}
            terminalContexts={props.terminalContexts}
            skills={props.skills}
          />
        </div>
      ) : null}
      {canCollapse ? (
        <div className="mt-1.5 flex items-center justify-end gap-2" data-user-message-footer="true">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            data-scroll-anchor-ignore
            onClick={() => setExpanded((value) => !value)}
            className="-ml-1 h-6 rounded-md px-1.5 text-xs text-muted-foreground/72 hover:bg-muted/55 hover:text-foreground/85"
          >
            {expanded ? "收起" : "显示完整消息"}
          </Button>
        </div>
      ) : null}
    </div>
  );
});

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              <SkillInlineText
                text={props.text.slice(cursor, matchIndex)}
                skills={props.skills}
                renderUnknownSkills
              />
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              <SkillInlineText
                text={props.text.slice(cursor)}
                skills={props.skills}
                renderUnknownSkills
              />
            </span>,
          );
        }

        return (
          <div className="chat-text whitespace-pre-wrap wrap-break-word text-[14px] leading-[1.78] text-foreground/95">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(
        <span key="user-message-terminal-context-inline-text">
          <SkillInlineText text={props.text} skills={props.skills} renderUnknownSkills />
        </span>,
      );
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="chat-text whitespace-pre-wrap wrap-break-word text-[14px] leading-[1.78] text-foreground/95">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div className="chat-text whitespace-pre-wrap wrap-break-word text-[14px] leading-[1.78] text-foreground/95">
      <SkillInlineText text={props.text} skills={props.skills} renderUnknownSkills />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// so React can skip re-rendering unchanged transcript rows.
// ---------------------------------------------------------------------------

/** Returns a structurally-shared copy of `rows`: for each row whose content
 *  hasn't changed since last call, the previous object reference is reused. */
function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function formatLiveMessageMetaNow(
  createdAt: string,
  durationStart: string | null | undefined,
  timestampFormat: TimestampFormat,
): string {
  const elapsed = durationStart ? formatElapsed(durationStart, new Date().toISOString()) : null;
  return formatMessageMeta(createdAt, elapsed, timestampFormat);
}

function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat);
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-rose-500/70",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-muted-foreground/55",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-muted-foreground/55",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-muted-foreground/55",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles" | "output">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if (workEntry.output) return workEntry.output;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

function commandWorkEntryCommand(workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">) {
  return workEntry.command?.trim() || workEntry.rawCommand?.trim() || null;
}

function normalizeCommandDisplayText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\r\n/g, "\n");
}

function commandWorkEntryOutput(workEntry: TimelineWorkEntry): string {
  const detail = normalizeCommandDisplayText(workEntry.output);
  if (!detail) {
    return "";
  }
  const command = normalizeCommandDisplayText(workEntry.command);
  const rawCommand = normalizeCommandDisplayText(workEntry.rawCommand);
  if (detail === command || detail === rawCommand) {
    return "";
  }
  if (rawCommand && (detail.includes(rawCommand) || rawCommand.includes(detail))) {
    return "";
  }
  return detail;
}

function commandWorkEntryCopyText(workEntry: TimelineWorkEntry): string {
  const command = commandWorkEntryCommand(workEntry);
  const output = commandWorkEntryOutput(workEntry);
  if (command && output) {
    return `$ ${command}\n\n${output}`;
  }
  return command || output || "";
}

function commandWorkEntryStatus(workEntry: TimelineWorkEntry): {
  label: string;
  className: string;
  icon: LucideIcon;
} {
  if (workEntry.status === "running") {
    return {
      label: "运行中",
      className: "text-muted-foreground/62",
      icon: TerminalSquareIcon,
    };
  }
  if (workEntry.tone === "error" || workEntry.status === "failed") {
    return {
      label: "失败",
      className: "text-rose-500/82",
      icon: CircleAlertIcon,
    };
  }
  return {
    label: "成功",
    className: "text-emerald-500/82",
    icon: CheckIcon,
  };
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.requestKind === "command") return TerminalSquareIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;
  if (workEntry.toolFamily === "browser") return AppWindowIcon;
  if (workEntry.toolFamily === "external_browser") return ChromeIcon;
  if (workEntry.toolFamily === "computer") {
    if (workEntry.toolTitle?.includes("点击")) return MousePointerClickIcon;
    return MonitorIcon;
  }
  if (workEntry.toolFamily === "command") return TerminalSquareIcon;
  if (workEntry.toolFamily === "file") {
    return workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0
      ? SquarePenIcon
      : EyeIcon;
  }
  if (workEntry.toolFamily === "search") return GlobeIcon;
  if (workEntry.toolFamily === "mcp") return WrenchIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalSquareIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  const runningStatusLabel = resolveRunningWorkEntryStatusLabel(workEntry);
  if (runningStatusLabel) return runningStatusLabel;
  if (isCommandWorkEntry(workEntry)) return "已运行";
  if (workEntry.requestKind === "file-read") return "已读取";
  if (workEntry.requestKind === "file-change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return "已编辑";
  }
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

function shouldAnimateWorkEntryText(workEntry: TimelineWorkEntry, displayText: string): boolean {
  const normalizedDisplayText = displayText.trim();
  if (normalizedDisplayText.length === 0) {
    return false;
  }
  if (workEntry.tone === "thinking") {
    return true;
  }
  if (workEntry.status === "running") {
    return true;
  }
  return /^(?:working|running|thinking|\u6b63\u5728)/i.test(normalizedDisplayText);
}

function countPatchLines(
  patch: ReturnType<typeof parseUnifiedDiff>[number],
  type: UnifiedDiffLine["type"],
): number {
  return patch.hunks.reduce(
    (count, hunk) => count + hunk.lines.filter((line) => line.type === type).length,
    0,
  );
}

function normalizeComparablePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^[a-z]:/i, "")
    .replace(/^\/+/, "");
}

function findPatchForChangedFile(
  filePath: string,
  patches: ReadonlyArray<ReturnType<typeof parseUnifiedDiff>[number]>,
): ReturnType<typeof parseUnifiedDiff>[number] | null {
  const comparableFilePath = normalizeComparablePath(filePath);
  const exactMatch = patches.find((patch) => {
    const displayPath = getPatchDisplayPath(patch);
    if (!displayPath) {
      return false;
    }
    const comparablePatchPath = normalizeComparablePath(displayPath);
    return (
      comparablePatchPath === comparableFilePath ||
      comparableFilePath.endsWith(`/${comparablePatchPath}`) ||
      comparablePatchPath.endsWith(`/${comparableFilePath}`)
    );
  });
  if (exactMatch) {
    return exactMatch;
  }

  const fileBasename = basenameOfChangedFile(comparableFilePath);
  if (!fileBasename) {
    return null;
  }
  const basenameMatches = patches.filter((patch) => {
    const displayPath = getPatchDisplayPath(patch);
    return displayPath ? basenameOfChangedFile(displayPath) === fileBasename : false;
  });
  return basenameMatches.length === 1 ? basenameMatches[0]! : null;
}

function buildFileChangeSummaries(
  workEntry: TimelineWorkEntry,
  workspaceRoot: string | undefined,
  turnDiffSummary: TurnDiffSummary | undefined,
): InlineDiffFileSummary[] {
  const patches = workEntry.detail ? parseRenderableUnifiedDiff(workEntry.detail) : [];
  const patchPaths = new Set<string>();
  const summaryPaths = new Set<string>();
  const summaries: InlineDiffFileSummary[] = [];

  for (const filePath of workEntry.changedFiles ?? []) {
    const patch = findPatchForChangedFile(filePath, patches);
    const summaryFile = findTurnDiffSummaryFile(filePath, turnDiffSummary);
    const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
    const listLabel = formatChangedFileListLabel(filePath);
    if (patch) {
      const patchPath = getPatchDisplayPath(patch);
      if (patchPath) {
        patchPaths.add(patchPath);
      }
    }
    summaryPaths.add(normalizeComparablePath(filePath));
    summaries.push({
      path: filePath,
      displayPath,
      listLabel,
      additions: patch ? countPatchLines(patch, "add") : (summaryFile?.additions ?? 0),
      deletions: patch ? countPatchLines(patch, "remove") : (summaryFile?.deletions ?? 0),
      hasStats: true,
      kind: resolvePatchFileChangeKind(patch) ?? summaryFile?.kind,
      patch,
    });
  }

  for (const patch of patches) {
    const patchPath = getPatchDisplayPath(patch);
    if (!patchPath || patchPaths.has(patchPath)) {
      continue;
    }
    summaryPaths.add(normalizeComparablePath(patchPath));
    summaries.push({
      path: patchPath,
      displayPath: formatWorkspaceRelativePath(patchPath, workspaceRoot),
      listLabel: formatChangedFileListLabel(patchPath),
      additions: countPatchLines(patch, "add"),
      deletions: countPatchLines(patch, "remove"),
      hasStats: true,
      kind: resolvePatchFileChangeKind(patch),
      patch,
    });
  }

  for (const file of turnDiffSummary?.files ?? []) {
    const comparablePath = normalizeComparablePath(file.path);
    if (summaryPaths.has(comparablePath)) {
      continue;
    }
    summaries.push({
      path: file.path,
      displayPath: formatWorkspaceRelativePath(file.path, workspaceRoot),
      listLabel: formatChangedFileListLabel(file.path),
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      hasStats: true,
      kind: file.kind,
      patch: null,
    });
  }

  return summaries;
}

function findTurnDiffSummaryFile(
  filePath: string,
  turnDiffSummary: TurnDiffSummary | undefined,
): TurnDiffSummary["files"][number] | null {
  if (!turnDiffSummary) {
    return null;
  }
  const comparableFilePath = normalizeComparablePath(filePath);
  return (
    turnDiffSummary.files.find((file) => {
      const comparableSummaryPath = normalizeComparablePath(file.path);
      return (
        comparableSummaryPath === comparableFilePath ||
        comparableFilePath.endsWith(`/${comparableSummaryPath}`) ||
        comparableSummaryPath.endsWith(`/${comparableFilePath}`)
      );
    }) ?? null
  );
}

function findTurnDiffSummaryForChangedFiles(
  filePaths: ReadonlyArray<string>,
  summaries: ReadonlyArray<TurnDiffSummary>,
): TurnDiffSummary | undefined {
  const comparablePaths = filePaths.map(normalizeComparablePath);
  const basenames = new Set(comparablePaths.map(basenameOfChangedFile).filter(Boolean));
  return summaries.find((summary) =>
    summary.files.some((file) => {
      const comparableSummaryPath = normalizeComparablePath(file.path);
      if (
        comparablePaths.some(
          (path) =>
            comparableSummaryPath === path ||
            path.endsWith(`/${comparableSummaryPath}`) ||
            comparableSummaryPath.endsWith(`/${path}`),
        )
      ) {
        return true;
      }
      return basenames.has(basenameOfChangedFile(comparableSummaryPath));
    }),
  );
}

function resolvePatchFileChangeKind(
  patch: ReturnType<typeof parseUnifiedDiff>[number] | null,
): string | undefined {
  if (!patch) {
    return undefined;
  }
  if (patch.oldPath === null && patch.newPath) {
    return "added";
  }
  if (patch.newPath === null && patch.oldPath) {
    return "deleted";
  }
  if (patch.oldPath && patch.newPath && patch.oldPath !== patch.newPath) {
    return "renamed";
  }
  return "modified";
}

function fileChangeVerb(workEntry: TimelineWorkEntry, files: ReadonlyArray<InlineDiffFileSummary>) {
  const isRunning = workEntry.status === "running";
  return fileChangeVerbLabel(
    resolveAggregateFileChangeAction(files),
    isRunning ? "running" : "completed",
  );
}

const FileChangeWorkEntryRow = memo(function FileChangeWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  turnDiffSummary: TurnDiffSummary | undefined;
}) {
  const ctx = use(TimelineRowCtx);
  const { workEntry, workspaceRoot, turnDiffSummary } = props;
  const [isExpanded, setIsExpanded] = useState(false);
  const [diffFilePath, setDiffFilePath] = useState<string | null>(null);
  const [loadedTurnPatch, setLoadedTurnPatch] = useState<string | null>(null);
  const [loadingDiffFilePath, setLoadingDiffFilePath] = useState<string | null>(null);
  const resolvedTurnDiffSummary = useMemo(
    () =>
      turnDiffSummary ??
      findTurnDiffSummaryForChangedFiles(workEntry.changedFiles ?? [], ctx.turnDiffSummaries),
    [ctx.turnDiffSummaries, turnDiffSummary, workEntry.changedFiles],
  );
  const files = useMemo(() => {
    const detail =
      loadedTurnPatch !== null
        ? loadedTurnPatch
        : workEntry.detail && workEntry.detail.trim().length > 0
          ? workEntry.detail
          : undefined;
    return buildFileChangeSummaries(
      { ...workEntry, ...(detail ? { detail } : {}) },
      workspaceRoot,
      resolvedTurnDiffSummary,
    );
  }, [loadedTurnPatch, resolvedTurnDiffSummary, workEntry, workspaceRoot]);
  const visibleFiles = useMemo(() => {
    const meaningfulFiles = files.filter(
      (file) => file.patch !== null || file.additions > 0 || file.deletions > 0,
    );
    return meaningfulFiles.length > 0 ? meaningfulFiles : files;
  }, [files]);
  const verb = fileChangeVerb(workEntry, visibleFiles.length > 0 ? visibleFiles : files);
  const fileCount = visibleFiles.length;
  const title = `${verb} ${fileCount} 个文件`;
  const visibleDiffFiles =
    diffFilePath === null ? [] : visibleFiles.filter((file) => file.path === diffFilePath);
  const workEntryTurnId = (workEntry as { sourceTurnId?: TurnId | null }).sourceTurnId ?? null;
  const diffTurnId = resolvedTurnDiffSummary?.turnId ?? workEntryTurnId;
  const checkpointTurnCount =
    resolvedTurnDiffSummary?.checkpointTurnCount ??
    (diffTurnId ? ctx.inferredCheckpointTurnCountByTurnId[diffTurnId] : undefined);
  const hasParsedFilePatch = files.some((file) => file.patch !== null);
  const canLoadTurnDiff =
    !hasParsedFilePatch && loadedTurnPatch === null && typeof checkpointTurnCount === "number";

  useEffect(() => {
    if (!isExpanded) {
      setDiffFilePath(null);
      return;
    }
    if (diffFilePath !== null && !visibleFiles.some((file) => file.path === diffFilePath)) {
      setDiffFilePath(null);
    }
  }, [diffFilePath, isExpanded, visibleFiles]);

  const loadTurnDiffPatch = useCallback(async () => {
    if (!canLoadTurnDiff || !diffTurnId) {
      return;
    }
    if (typeof checkpointTurnCount !== "number") {
      return;
    }
    const api = readEnvironmentApi(ctx.activeThreadEnvironmentId);
    if (!api) {
      return;
    }
    try {
      const fromTurnCount = Math.max(0, checkpointTurnCount - 1);
      const result =
        fromTurnCount === 0
          ? await api.orchestration.getFullThreadDiff({
              threadId: ctx.threadId,
              toTurnCount: checkpointTurnCount,
              ignoreWhitespace: false,
            })
          : await api.orchestration.getTurnDiff({
              threadId: ctx.threadId,
              fromTurnCount,
              toTurnCount: checkpointTurnCount,
              ignoreWhitespace: false,
            });
      setLoadedTurnPatch(result.diff);
    } catch {
      setLoadedTurnPatch("");
    }
  }, [
    canLoadTurnDiff,
    checkpointTurnCount,
    ctx.activeThreadEnvironmentId,
    ctx.threadId,
    diffTurnId,
  ]);

  const toggleFileDiff = useCallback(
    async (file: InlineDiffFileSummary) => {
      if (diffFilePath === file.path) {
        setDiffFilePath(null);
        return;
      }
      setDiffFilePath(file.path);
      if (!file.patch && canLoadTurnDiff) {
        setLoadingDiffFilePath(file.path);
        await loadTurnDiffPatch();
        setLoadingDiffFilePath(null);
      }
    },
    [canLoadTurnDiff, diffFilePath, loadTurnDiffPatch],
  );

  if (visibleFiles.length === 0) {
    return null;
  }

  return (
    <div className="chat-text rounded-md px-1 py-0.5">
      <button
        type="button"
        className="group/file-change flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] leading-5 text-muted-foreground/68 transition-colors hover:text-foreground/80"
        aria-expanded={isExpanded}
        title={title}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <SquarePenIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
        <span className="shrink-0">{verb}</span>
        <span className="shrink-0">{fileCount} 个文件</span>
        {isExpanded ? (
          <ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground/52 transition-colors group-hover/file-change:text-muted-foreground/75" />
        ) : (
          <ChevronRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground/42 transition-colors group-hover/file-change:text-muted-foreground/70" />
        )}
      </button>
      {isExpanded ? (
        <div className="mt-0.5 space-y-0.5 pl-6">
          {visibleFiles.map((file) => {
            const fileHasDiff = file.patch !== null;
            const isDiffVisible = diffFilePath === file.path;
            const visibleDiffForFile = isDiffVisible ? visibleDiffFiles : [];
            const hasVisiblePatch = visibleDiffForFile.some((diffFile) => diffFile.patch !== null);
            const showDiffPlaceholder = isDiffVisible && !hasVisiblePatch;
            const placeholderState =
              loadingDiffFilePath === file.path || (canLoadTurnDiff && loadedTurnPatch === null)
                ? "loading"
                : "empty";

            return (
              <div key={`${workEntry.id}:${file.path}`} className="space-y-0.5">
                <div
                  className="group/file-row flex max-w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-[13px] leading-5 text-foreground/86 transition-colors hover:text-foreground"
                  title={file.displayPath}
                >
                  <span className="shrink-0 text-muted-foreground/74">
                    {fileChangeVerbLabel(
                      resolveFileChangeActionFromKind(file.kind) ?? "edit",
                      "completed",
                    )}
                  </span>
                  <ChangedFileOpenButton
                    filePath={file.path}
                    displayPath={file.listLabel}
                    title={file.displayPath}
                    className="min-w-0 max-w-[min(42ch,60vw)] flex-none"
                    onOpenFile={ctx.onOpenMarkdownFile}
                  />
                  <AnimatedDiffStatLabel additions={file.additions} deletions={file.deletions} />
                  <button
                    type="button"
                    className={cn(
                      "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/46 opacity-0 transition-[opacity,color] hover:text-muted-foreground/82 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/file-row:opacity-100",
                      isDiffVisible && "opacity-100 text-muted-foreground/70",
                    )}
                    aria-label={isDiffVisible ? "收起文件 diff" : "展开文件 diff"}
                    aria-expanded={isDiffVisible}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleFileDiff(file);
                    }}
                  >
                    {loadingDiffFilePath === file.path ? (
                      <span className="size-1.5 rounded-full bg-current opacity-70" />
                    ) : isDiffVisible ? (
                      <ChevronDownIcon className="size-3.5" />
                    ) : (
                      <ChevronRightIcon className="size-3.5" />
                    )}
                  </button>
                </div>
                {hasVisiblePatch ? (
                  <InlineChangedFilesDiff files={visibleDiffForFile} />
                ) : showDiffPlaceholder ? (
                  <InlineDiffPlaceholder fileName={file.listLabel} state={placeholderState} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  turnDiffSummary?: TurnDiffSummary | undefined;
}) {
  const ctx = use(TimelineRowCtx);
  const { workEntry, workspaceRoot, turnDiffSummary } = props;
  if (workEntry.userInputSummary) {
    return <UserInputSummaryTimelineRow workEntry={workEntry} compact />;
  }
  if (isFileChangeWorkEntry(workEntry, turnDiffSummary)) {
    return (
      <FileChangeWorkEntryRow
        workEntry={workEntry}
        workspaceRoot={workspaceRoot}
        turnDiffSummary={turnDiffSummary}
      />
    );
  }
  if (isCommandWorkEntry(workEntry)) {
    return <CommandWorkEntryRow workEntry={workEntry} />;
  }
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const rawPreview = workEntryPreview(workEntry, workspaceRoot);
  const preview =
    rawPreview &&
    normalizeCompactToolLabel(rawPreview).toLowerCase() ===
      normalizeCompactToolLabel(heading).toLowerCase()
      ? null
      : rawPreview;

  const hasDetail = Boolean(workEntry.detail && workEntry.detail.trim().length > 0);
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);

  const rawCommand = isDetailExpanded ? null : workEntryRawCommand(workEntry);
  const previewSeparator = /^[已正]/.test(heading) ? " " : " - ";
  const defaultDisplayText = preview ? `${heading}${previewSeparator}${preview}` : heading;
  const expandedDisplayText = heading === "已运行" ? "已运行命令" : heading;
  const displayText = isDetailExpanded ? expandedDisplayText : defaultDisplayText;

  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;
  const animateText = shouldAnimateWorkEntryText(workEntry, displayText);

  return (
    <div className="chat-text rounded-md px-1 py-0.5">
      <div
        className={cn(
          "flex items-center gap-2 transition-[opacity,translate] duration-200 rounded-md px-1 py-0.5",
          hasDetail && "cursor-pointer hover:bg-muted/15 select-none",
        )}
        onClick={hasDetail ? () => setIsDetailExpanded((v) => !v) : undefined}
      >
        <span
          className={cn("flex size-4 shrink-0 items-center justify-center", iconConfig.className)}
        >
          <EntryIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden flex items-center justify-between gap-1.5">
          <div className="min-w-0 flex-1 overflow-hidden">
            {isDetailExpanded ? (
              <p className={cn("truncate text-[13px] leading-5", workToneClass(workEntry.tone))}>
                <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                  {displayText}
                </span>
              </p>
            ) : rawCommand ? (
              <div className="max-w-full">
                <p
                  className={cn(
                    "truncate text-[13px] leading-5",
                    workToneClass(workEntry.tone),
                    preview ? "text-muted-foreground/70" : "",
                  )}
                  title={displayText}
                >
                  {animateText ? (
                    <RunningStatusShimmer label={displayText} />
                  ) : (
                    <>
                      <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                        {heading}
                      </span>
                      {preview && (
                        <Tooltip>
                          <TooltipTrigger
                            closeDelay={0}
                            delay={75}
                            render={
                              <span className="max-w-full cursor-default text-muted-foreground/55 transition-colors hover:text-muted-foreground/75 focus-visible:text-muted-foreground/75">
                                {previewSeparator}
                                {preview}
                              </span>
                            }
                          />
                          <TooltipPopup
                            align="start"
                            className="max-w-[min(56rem,calc(100vw-2rem))] px-0 py-0"
                            side="top"
                          >
                            <div className="max-w-[min(56rem,calc(100vw-2rem))] overflow-x-auto px-1.5 py-1 font-mono text-[12px] leading-4 whitespace-nowrap">
                              {rawCommand}
                            </div>
                          </TooltipPopup>
                        </Tooltip>
                      )}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  className="block min-w-0 w-full text-left"
                  title={displayText}
                  aria-label={displayText}
                >
                  <p
                    className={cn(
                      "truncate text-[13px] leading-5",
                      workToneClass(workEntry.tone),
                      preview ? "text-muted-foreground/70" : "",
                    )}
                  >
                    {animateText ? (
                      <RunningStatusShimmer label={displayText} />
                    ) : (
                      <>
                        <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                          {heading}
                        </span>
                        {preview && (
                          <span className="text-muted-foreground/55">
                            {previewSeparator}
                            {preview}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </TooltipTrigger>
                <TooltipPopup className="max-w-[min(720px,calc(100vw-2rem))]">
                  <p className="whitespace-pre-wrap wrap-break-word text-[13px] leading-5">
                    {displayText}
                  </p>
                </TooltipPopup>
              </Tooltip>
            )}
          </div>
          {hasDetail ? (
            isDetailExpanded ? (
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/52" />
            ) : (
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/42" />
            )
          ) : null}
        </div>
      </div>
      {hasChangedFiles && !previewIsChangedFiles && (
        <div className="mt-1 flex flex-wrap gap-1 pl-6">
          {workEntry.changedFiles?.slice(0, 4).map((filePath) => {
            const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
            return (
              <ChangedFileOpenButton
                key={`${workEntry.id}:${filePath}`}
                filePath={filePath}
                displayPath={displayPath}
                className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 text-[11px]"
                onOpenFile={ctx.onOpenMarkdownFile}
                stopPropagation
              />
            );
          })}
          {(workEntry.changedFiles?.length ?? 0) > 4 && (
            <span className="px-1 text-[11px] text-muted-foreground/55">
              +{(workEntry.changedFiles?.length ?? 0) - 4}
            </span>
          )}
        </div>
      )}
      {/* 展开的工具详情 */}
      {hasDetail && isDetailExpanded && (
        <div className="mt-2 ml-6 flex max-w-[min(100%,46rem)] flex-col gap-2 rounded-lg bg-muted/55 p-3 text-foreground/85 dark:bg-muted/20">
          {/* 首行：标题与复制按钮 */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-normal text-muted-foreground/68 uppercase">
              {capitalizePhrase(workEntry.toolTitle || workEntry.label || "Tool")}
            </span>
            <MessageCopyButton
              text={workEntry.detail || ""}
              size="icon-xs"
              className="h-6 w-6 border-transparent bg-transparent text-muted-foreground/60 shadow-none hover:bg-muted/20 hover:text-foreground"
            />
          </div>

          {isCommandWorkEntry(workEntry) && (workEntry.command || workEntry.rawCommand) ? (
            <div className="flex items-center rounded-md bg-background/52 px-2 py-1.5 font-mono text-[12.75px] font-medium leading-5 text-foreground/88 whitespace-pre-wrap break-all">
              <span className="mr-1.5 select-none font-normal text-muted-foreground/62">$</span>
              {workEntry.command || workEntry.rawCommand}
            </div>
          ) : null}

          <pre
            className={cn(
              "max-h-80 overflow-x-auto overflow-y-auto rounded-md bg-background/45 p-2.5 pr-1 text-[12.75px] leading-[1.68] text-foreground/82 whitespace-pre-wrap break-all select-text",
              isCommandWorkEntry(workEntry) ? "font-mono" : "font-sans",
            )}
          >
            {workEntry.detail}
          </pre>

          {/* 底部状态 */}
          <div className="flex items-center justify-end text-[11px] font-medium">
            {workEntry.tone === "error" ? (
              <span className="text-rose-500/80 flex items-center gap-1">
                <CircleAlertIcon className="size-3" />
                失败
              </span>
            ) : (
              <span className="text-emerald-500/80 flex items-center gap-1">
                <CheckIcon className="size-3" />
                成功
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

const CommandWorkEntryRow = memo(function CommandWorkEntryRow({
  workEntry,
  initiallyExpanded = false,
}: {
  workEntry: TimelineWorkEntry;
  initiallyExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const command = commandWorkEntryCommand(workEntry);
  const output = commandWorkEntryOutput(workEntry);
  const status = commandWorkEntryStatus(workEntry);
  const StatusIcon = status.icon;
  const copyText = commandWorkEntryCopyText(workEntry);
  const collapsedSummaryText =
    workEntry.status === "running"
      ? command
        ? `正在运行 ${command}`
        : "正在运行命令"
      : command
        ? `已运行 ${command}`
        : "已运行命令";
  const summaryText = isExpanded
    ? workEntry.status === "running"
      ? "正在运行命令"
      : "已运行命令"
    : collapsedSummaryText;

  return (
    <div className="chat-text rounded-md px-1 py-0.5">
      <button
        type="button"
        className="group/command-summary flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] leading-5 text-muted-foreground/62 transition-colors hover:bg-muted/15 hover:text-foreground/78"
        aria-expanded={isExpanded}
        title={summaryText}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <TerminalSquareIcon className="size-3.5 shrink-0 text-muted-foreground/58" />
        {workEntry.status === "running" ? (
          <RunningStatusShimmer className="-my-0.5 min-w-0" label={summaryText} />
        ) : (
          <span className="min-w-0 truncate">{summaryText}</span>
        )}
        {isExpanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/52 transition-colors group-hover/command-summary:text-muted-foreground/75" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/42 transition-colors group-hover/command-summary:text-muted-foreground/70" />
        )}
      </button>

      {isExpanded ? (
        <div
          className="group/command-panel relative mt-1 w-full max-w-[min(100%,46rem)] overflow-hidden rounded-lg bg-[#eeeeee] text-neutral-950 dark:bg-neutral-900 dark:text-neutral-50"
          data-command-work-panel="true"
        >
          <div className="flex h-8 items-center justify-between gap-2 px-2.5 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
            <span className="shrink-0 font-normal">bash</span>
            <MessageCopyButton
              text={copyText}
              size="icon-xs"
              variant="ghost"
              ariaLabel="复制命令和输出"
              tooltipLabel="复制命令和输出"
              className="h-6 w-6 border-transparent bg-transparent text-neutral-500 opacity-0 shadow-none transition-opacity hover:bg-black/5 hover:text-neutral-900 group-hover/command-panel:opacity-100 focus-visible:opacity-100 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-50"
            />
          </div>
          <div className="px-2.5 pb-9">
            <div
              className="relative max-h-[220px] overflow-auto overscroll-contain rounded-md px-0.5 pb-10 font-mono text-[12.75px] leading-[1.68] text-neutral-950 [scrollbar-gutter:stable] dark:text-neutral-50"
              data-command-output-scroll="true"
            >
              {command ? (
                <div className="group/command-copy relative flex min-w-0 gap-2 pr-7">
                  <span className="shrink-0 select-none text-neutral-500 dark:text-neutral-400">
                    $
                  </span>
                  <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words">{command}</pre>
                  <MessageCopyButton
                    text={command}
                    size="icon-xs"
                    variant="ghost"
                    ariaLabel="复制命令"
                    tooltipLabel="复制命令"
                    className="absolute right-0 top-0 h-6 w-6 border-transparent bg-transparent text-neutral-500 opacity-0 shadow-none transition-opacity hover:bg-black/5 hover:text-neutral-900 group-hover/command-copy:opacity-100 focus-visible:opacity-100 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-50"
                  />
                </div>
              ) : null}
              {output ? (
                <div className="group/output-copy relative mt-2 pr-7">
                  <pre className="whitespace-pre-wrap break-words pb-1 text-neutral-700 dark:text-neutral-200">
                    {output}
                  </pre>
                  <MessageCopyButton
                    text={output}
                    size="icon-xs"
                    variant="ghost"
                    ariaLabel="复制输出"
                    tooltipLabel="复制输出"
                    className="absolute right-0 top-0 h-6 w-6 border-transparent bg-transparent text-neutral-500 opacity-0 shadow-none transition-opacity hover:bg-black/5 hover:text-neutral-900 group-hover/output-copy:opacity-100 focus-visible:opacity-100 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-50"
                  />
                </div>
              ) : null}
              {!output && workEntry.status === "running" ? (
                <div className="mt-2 text-neutral-500 dark:text-neutral-400">等待命令输出...</div>
              ) : null}
              {!output && workEntry.status !== "running" ? (
                <div className="mt-2 text-neutral-500 dark:text-neutral-400">无输出</div>
              ) : null}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-10 items-end justify-end bg-linear-to-t from-[#eeeeee] via-[#eeeeee]/92 to-transparent px-2.5 pb-2 dark:from-neutral-900 dark:via-neutral-900/92">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[12px] leading-4",
                status.className,
              )}
            >
              <StatusIcon className="size-3" />
              {status.label}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
});

const UserInputSummaryTimelineRow = memo(function UserInputSummaryTimelineRow({
  workEntry,
  compact = false,
}: {
  workEntry: TimelineWorkEntry;
  compact?: boolean;
}) {
  const summary = workEntry.userInputSummary;
  if (!summary) {
    return null;
  }
  const resolvedCount = summary.questions.length;
  const title =
    summary.status === "resolved"
      ? `已询问 ${resolvedCount} 个问题`
      : resolvedCount > 1
        ? `正在询问 ${resolvedCount} 个问题`
        : "正在询问 问题";

  return (
    <div
      className={cn("chat-text pb-3 pl-1 pt-2", compact && "pb-1 pt-0")}
      data-user-input-summary="true"
    >
      <div className="max-w-full rounded-md px-0.5 py-0.5">
        <div className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground/62">
          <span className="min-w-0 truncate">{title}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/45" />
        </div>
        <div className="mt-2 space-y-3 text-[13px] leading-5">
          {summary.questions.map((question) => {
            const answer = summary.answers?.[question.id];
            const answerText = Array.isArray(answer) ? answer.join("、") : answer;
            return (
              <div key={`${workEntry.id}:${question.id}`} className="min-w-0">
                <p className="break-words text-foreground/72">{question.question}</p>
                {answerText ? (
                  <p className="mt-1 break-words text-muted-foreground/48">{answerText}</p>
                ) : summary.status === "requested" ? (
                  <p className="mt-1 text-muted-foreground/42">等待回答</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
