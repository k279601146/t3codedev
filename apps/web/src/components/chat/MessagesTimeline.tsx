import {
  type EnvironmentId,
  type MessageId,
  type ServerProviderSkill,
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
  type ReactNode,
} from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { type TurnDiffSummary } from "../../types";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FileIcon,
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
  TerminalSquareIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  isCommandWorkEntry,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  resolveRunningWorkEntryStatusLabel,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ShimmerScanText } from "../ui/shimmer-scan-text";
import { ImageGenerationShimmer } from "../ui/image-generation-shimmer";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
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
import { rewriteMarkdownFileUriHref } from "../../markdown-links";

// ---------------------------------------------------------------------------
// Context — shared state consumed by every row component via useContext.
// Propagates through LegendList's memo boundaries for shared callbacks and
// non-row-scoped state. `nowIso` is intentionally excluded — self-ticking
// components (WorkingTimer, LiveElapsed) handle it.
// ---------------------------------------------------------------------------

interface TimelineRowSharedState {
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertUserMessage: (messageId: MessageId) => void;
  goalMessageIds: ReadonlySet<MessageId>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  /** Turn-process collapse: per assistant-message id, is the upstream
   *  process (work / image-gen / proposed-plan rows) collapsed? */
  collapsedAssistantMessageIds: ReadonlySet<string>;
  /** Assistant messages that summarize a span (own a "已处理 X ›" toggle). */
  summaryAssistantMessageIds: ReadonlySet<string>;
  /** Per-summary owner: human-readable elapsed label for the process span. */
  elapsedByAssistantMessageId: ReadonlyMap<string, string>;
  /** Member-row → owner: when a row appears in this map it is part of a
   *  collapsible span and animates open/closed under the summary toggle. */
  ownerAssistantMessageIdByRowId: ReadonlyMap<string, string>;
  /** Row-id → assistant-message-id of the toggle to render *above* it.
   *  The button sits on the FIRST member row so it visually wraps every
   *  intermediate row + the final assistant summary that follows. */
  summaryButtonHostByRowId: ReadonlyMap<string, string>;
  toggleAssistantTurnCollapsed: (assistantMessageId: string) => void;
  /** Resolves the LegendList scroll container — used by the summary
   *  toggle to keep the button visually pinned across expand/collapse. */
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

// Use PingFang SC explicitly for chat content so the increased font size keeps the
// preferred Chinese-first typeface across all platforms.
const CHAT_FONT_STACK =
  "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif";
const USER_MESSAGE_FONT_STYLE: React.CSSProperties = { fontFamily: CHAT_FONT_STACK };

// ---------------------------------------------------------------------------
// Props (public API)
// ---------------------------------------------------------------------------

interface MessagesTimelineProps {
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnId?: TurnId | null;
  activeTurnStartedAt: string | null;
  listRef: React.RefObject<LegendListRef | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  routeThreadKey: string;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
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
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  activeTurnId,
  activeTurnStartedAt,
  listRef,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  turnDiffSummaryByAssistantMessageId,
  routeThreadKey,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
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
}: MessagesTimelineProps) {
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      completionDividerBeforeEntryId,
      isWorking,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const stableRows = useStableRows(rawRows);

  // ---- Per-question collapse ---------------------------------------------
  // We collapse by user-question, not by backend turn. A single question
  // may produce multiple assistant messages and process bursts (e.g. image
  // generation + retries). The whole span between two user messages
  // collapses under one "已处理 X ›" header that anchors to the FIRST
  // member row (so the button sits at the top of the section and visually
  // wraps all process rows + intermediate assistant messages below it).
  // The last assistant message in the span stays fully visible — that's
  // the final summary text the user wants to keep reading.

  const {
    ownerAssistantMessageIdByRowId,
    summaryAssistantMessageIds,
    elapsedByAssistantMessageId,
    summaryButtonHostByRowId,
  } = useMemo(() => {
    const owner = new Map<string, string>();
    const summaries = new Set<string>();
    const elapsedMap = new Map<string, string>();
    /** rowId of a member row that should render the "已处理 X ›" header
     *  immediately ABOVE itself. Maps from host row id → assistant
     *  message id used as the toggle's state key. */
    const hostByRowId = new Map<string, string>();

    type Span = {
      userKey: string;
      lastAssistantId: string | null;
      lastAssistantCompletedAt: string | null;
      firstProcessAt: string | null;
      /** All process rows + all intermediate assistant messages within
       *  this span. They collapse together under the summary toggle. */
      memberRowIds: string[];
      /** Track the row id of the most recently appended assistant message
       *  so we can demote it from "final summary" to "intermediate" when
       *  another assistant message arrives later in the span. */
      lastAssistantRowId: string | null;
      hasProcessRow: boolean;
    };
    const spans = new Map<string, Span>();
    const ensureSpan = (key: string): Span => {
      let span = spans.get(key);
      if (!span) {
        span = {
          userKey: key,
          lastAssistantId: null,
          lastAssistantCompletedAt: null,
          firstProcessAt: null,
          memberRowIds: [],
          lastAssistantRowId: null,
          hasProcessRow: false,
        };
        spans.set(key, span);
      }
      return span;
    };

    let currentSpanKey: string | null = null;
    let spanCounter = 0;

    for (const row of stableRows) {
      if (row.kind === "message" && row.message.role === "user") {
        spanCounter += 1;
        currentSpanKey = `q:${row.message.id}:${spanCounter}`;
        continue;
      }
      if (!currentSpanKey) {
        currentSpanKey = `q:__preamble__`;
      }
      const span = ensureSpan(currentSpanKey);

      if (row.kind === "message" && row.message.role === "assistant") {
        // Every assistant message in the span is provisionally a member —
        // we'll exclude the *final* one (the summary text) at the end so
        // it stays visible. This guarantees the very first assistant
        // message also gets wrapped under the "已处理 X ›" toggle.
        span.memberRowIds.push(row.id);
        span.lastAssistantId = row.message.id;
        span.lastAssistantRowId = row.id;
        span.lastAssistantCompletedAt =
          !row.message.streaming && row.message.completedAt ? row.message.completedAt : null;
        continue;
      }
      if (row.kind === "work" || row.kind === "image-generation" || row.kind === "proposed-plan") {
        if (!span.firstProcessAt) span.firstProcessAt = row.createdAt;
        span.memberRowIds.push(row.id);
        span.hasProcessRow = true;
      }
    }

    for (const span of spans.values()) {
      if (!span.lastAssistantId) continue;
      if (!span.hasProcessRow) continue;
      // Drop the final assistant message from the member set so it stays
      // visible as the section's summary text.
      const memberRowIds = span.memberRowIds.filter((id) => id !== span.lastAssistantRowId);
      if (memberRowIds.length === 0) continue;
      summaries.add(span.lastAssistantId);
      for (const rowId of memberRowIds) {
        owner.set(rowId, span.lastAssistantId);
      }
      const firstMemberRowId = memberRowIds[0];
      if (firstMemberRowId) {
        hostByRowId.set(firstMemberRowId, span.lastAssistantId);
      }
      if (span.firstProcessAt && span.lastAssistantCompletedAt) {
        const elapsed = formatElapsed(span.firstProcessAt, span.lastAssistantCompletedAt);
        if (elapsed) elapsedMap.set(span.lastAssistantId, elapsed);
      }
    }

    return {
      ownerAssistantMessageIdByRowId: owner,
      summaryAssistantMessageIds: summaries,
      elapsedByAssistantMessageId: elapsedMap,
      summaryButtonHostByRowId: hostByRowId,
    };
  }, [stableRows]);

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

  /** Don't filter — we let collapsed member rows stay in the row list and
   *  animate their height to zero in CSS. Removing them entirely would
   *  cause LegendList to recycle/re-measure rows abruptly, which is what
   *  felt jumpy. */
  const rows = stableRows;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const getScrollContainer = useCallback(() => {
    if (scrollContainerRef.current) {
      return scrollContainerRef.current;
    }
    if (containerRef.current) {
      const el = containerRef.current.querySelector(".overflow-y-auto") as HTMLDivElement | null;
      if (el) {
        scrollContainerRef.current = el;
      }
      return el;
    }
    return null;
  }, []);

  const handleScroll = useCallback(() => {
    const target = getScrollContainer();
    if (!target) return;
    const isAtEnd = target.scrollHeight - target.scrollTop - target.clientHeight < 10;
    onIsAtEndChange(isAtEnd);
  }, [onIsAtEndChange, getScrollContainer]);

  const previousRowCountRef = useRef(rows.length);
  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;

    if (previousRowCount > 0 || rows.length === 0) {
      return;
    }

    onIsAtEndChange(true);
    const frameId = window.requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd?.({ animated: false });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [listRef, onIsAtEndChange, rows.length]);

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
      void listRef.current?.scrollToEnd?.({ animated: false });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTurnInProgress, lastRow, listRef, onIsAtEndChange, getScrollContainer]);

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onRevertUserMessage,
      goalMessageIds,
      onImageExpand,
      onOpenTurnDiff,
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
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onRevertUserMessage,
      goalMessageIds,
      onImageExpand,
      onOpenTurnDiff,
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

  // Stable renderItem — no closure deps. Row components read shared state
  // from TimelineRowCtx, which propagates through LegendList's memo.
  const renderItem = useCallback(
    ({ item }: { item: MessagesTimelineRow }) => (
      <div className="mx-auto w-full min-w-0 max-w-3xl overflow-x-clip" data-timeline-root="true">
        <TimelineRowContent row={item} />
      </div>
    ),
    [],
  );

  if (rows.length === 0 && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <TimelineRowCtx.Provider value={sharedState}>
      <TimelineRowActivityCtx.Provider value={activityState}>
        <div ref={containerRef} className="h-full min-h-0 w-full min-w-0 flex-1">
          <LegendList<MessagesTimelineRow>
            ref={listRef}
            data={rows}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            estimatedItemSize={90}
            initialScrollAtEnd
            maintainScrollAtEnd
            maintainScrollAtEndThreshold={0.1}
            maintainVisibleContentPosition
            onScroll={handleScroll}
            className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 [scrollbar-gutter:stable] [touch-action:pan-y] sm:px-5"
            ListHeaderComponent={TIMELINE_LIST_HEADER}
            ListFooterComponent={TIMELINE_LIST_FOOTER}
          />
        </div>
      </TimelineRowActivityCtx.Provider>
    </TimelineRowCtx.Provider>
  );
});

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
        "pb-4",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" ? <WorkGroupSection groupedEntries={row.groupedEntries} /> : null}
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

/** Toggle header rendered above the first member row of a collapsed span. */
function TurnSummaryToggleHeader({ assistantMessageId }: { assistantMessageId: string }) {
  const ctx = use(TimelineRowCtx);
  const isCollapsed = ctx.collapsedAssistantMessageIds.has(assistantMessageId);
  const elapsed = ctx.elapsedByAssistantMessageId.get(assistantMessageId) ?? null;
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Keep the toggle button visually pinned at its current viewport
  // position across the expand/collapse animation. The content grows
  // (or collapses) below it instead of pushing the button out of view.
  // We retry the alignment for several frames because LegendList's
  // `maintainVisibleContentPosition` runs after its own commit and can
  // otherwise overwrite our scrollTop adjustment.
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
    <div className="pt-1 pb-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
        className="group/turn-summary inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] leading-5 text-muted-foreground/70 transition-colors hover:text-foreground/85"
        style={USER_MESSAGE_FONT_STYLE}
        data-turn-summary-toggle="true"
        data-turn-summary-collapsed={isCollapsed ? "true" : "false"}
        data-scroll-anchor-ignore
      >
        <span className="min-w-0 truncate">{elapsed ? `已处理 ${elapsed}` : "已处理"}</span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 -rotate-90 text-muted-foreground/55 transition-transform duration-200 group-hover/turn-summary:text-muted-foreground/85",
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
  const userAttachments = row.message.attachments ?? [];
  const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
  const terminalContexts = displayedUserMessage.contexts;
  const canRevertAgentWork = typeof row.revertTurnCount === "number";

  return (
    <div className="flex justify-end">
      <div className="group flex max-w-[82%] flex-col items-end">
        <div className="w-fit max-w-full rounded-[18px] border border-border/55 bg-secondary px-4 py-2.5">
          {userAttachments.length > 0 && (
            <div className="mb-2 grid max-w-[548px] grid-cols-2 gap-3">
              {userAttachments.map(
                (attachment: NonNullable<TimelineMessage["attachments"]>[number]) => (
                  <div
                    key={attachment.id}
                    className="overflow-hidden rounded-lg border border-border bg-background"
                  >
                    {attachment.type === "image" && attachment.previewUrl ? (
                      <button
                        type="button"
                        className="h-full w-full cursor-zoom-in"
                        aria-label={`Preview ${attachment.name}`}
                        onClick={() => {
                          const preview = buildExpandedImagePreview(userAttachments, attachment.id);
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
                    ) : attachment.type === "file" ? (
                      <a
                        href={attachment.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-[96px] w-full flex-col items-center justify-center gap-1 px-3 py-4 text-center"
                        aria-label={`Open ${attachment.name}`}
                      >
                        <FileIcon className="size-5 text-muted-foreground/70" />
                        <span className="line-clamp-2 break-all text-xs text-foreground">
                          {attachment.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          {attachment.mimeType || "file"}
                        </span>
                      </a>
                    ) : (
                      <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                        {attachment.name}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
          <CollapsibleUserMessageBody
            text={displayedUserMessage.visibleText}
            terminalContexts={terminalContexts}
            skills={ctx.skills}
          />
        </div>
        <div
          className="mt-1 flex min-h-6 items-center justify-end gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100"
          data-user-message-actions="true"
        >
          {displayedUserMessage.copyText && (
            <MessageCopyButton
              text={displayedUserMessage.copyText}
              size="icon-xs"
              className="border-border/55 bg-background/80 text-muted-foreground/70 shadow-none hover:border-border/75 hover:bg-background hover:text-foreground"
            />
          )}
          {ctx.goalMessageIds.has(row.message.id) ? <GoalMessageMarker /> : null}
          {canRevertAgentWork && <RevertUserMessageButton messageId={row.message.id} />}
          <span className="px-0.5 text-[11px] text-muted-foreground/50">
            {formatTimestamp(row.message.createdAt, ctx.timestampFormat)}
          </span>
        </div>
      </div>
    </div>
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

function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");

  return (
    <>
      {row.showCompletionDivider && <AssistantCompletionDivider />}
      <div className="min-w-0 px-1 py-0.5">
        <ChatMarkdown
          text={messageText}
          cwd={ctx.markdownCwd}
          isStreaming={Boolean(row.message.streaming)}
          skills={ctx.skills}
        />
        <AssistantChangedFilesSection
          turnSummary={row.assistantTurnDiffSummary}
          routeThreadKey={ctx.routeThreadKey}
          resolvedTheme={ctx.resolvedTheme}
          onOpenTurnDiff={ctx.onOpenTurnDiff}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground/40">
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
      </div>
    </>
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
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
        {activity.completionSummary ? `Response • ${activity.completionSummary}` : "Response"}
      </span>
      <span className="h-px flex-1 bg-border" />
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
        ...USER_MESSAGE_FONT_STYLE,
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
          letterSpacing: "0.05em",
          // 1. 设置渐变背景：深灰 -> 极亮白 -> 深灰
          backgroundImage: "linear-gradient(90deg, #71717a 0%, #fafafa 50%, #71717a 100%)",
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
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
}) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = summarizeWorkGroup(groupedEntries);
  const showLiveScan = groupedEntries.some((entry) => entry.status === "running");

  return (
    <div className="pt-2 pb-3 pl-1">
      <button
        type="button"
        className="group/work-summary flex max-w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[13px] leading-5 text-[#999999] transition-colors hover:text-foreground/78"
        style={USER_MESSAGE_FONT_STYLE}
        aria-expanded={isExpanded}
        data-work-group-summary="true"
        onClick={() => setIsExpanded((value) => !value)}
      >
        <TerminalSquareIcon className="size-4 shrink-0 text-[#999999]" />
        {showLiveScan ? (
          <RunningStatusShimmer className="-my-0.5" label={summary.liveLabel} />
        ) : (
          <span className="min-w-0 truncate">{summary.label}</span>
        )}
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/45 transition-transform duration-150 group-hover/work-summary:text-muted-foreground/70",
            isExpanded && "rotate-180",
          )}
        />
      </button>
      {isExpanded ? (
        <div className="mt-1 space-y-0.5 pl-4" data-work-group-details="true">
          {groupedEntries.map((workEntry) => (
            <SimpleWorkEntryRow
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              workspaceRoot={workspaceRoot}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

function summarizeWorkGroup(entries: ReadonlyArray<TimelineWorkEntry>): {
  label: string;
  liveLabel: string;
} {
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
  if (statusLabel) return statusLabel;
  return `正在处理 ${toolWorkEntryHeading(entry)}`;
}

/** Subscribes directly to the UI state store for expand/collapse state,
 *  so toggling re-renders only this component — not the entire list. */
const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary | undefined;
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  if (!turnSummary) return null;
  const checkpointFiles = turnSummary.files;
  if (checkpointFiles.length === 0) return null;

  return (
    <AssistantChangedFilesSectionInner
      turnSummary={turnSummary}
      checkpointFiles={checkpointFiles}
      routeThreadKey={routeThreadKey}
      resolvedTheme={resolvedTheme}
      onOpenTurnDiff={onOpenTurnDiff}
    />
  );
});

/** Inner component that only mounts when there are actual changed files,
 *  so the store subscription is unconditional (no hooks after early return). */
function AssistantChangedFilesSectionInner({
  turnSummary,
  checkpointFiles,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary;
  checkpointFiles: TurnDiffSummary["files"];
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const allDirectoriesExpanded = useUiStateStore(
    (store) => store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.turnId] ?? true,
  );
  const setExpanded = useUiStateStore((store) => store.setThreadChangedFilesExpanded);
  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
  const changedFileCountLabel = String(checkpointFiles.length);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <p className="text-[13px] text-foreground/86">
          <span>{changedFileCountLabel} 个文件已更改</span>
          {hasNonZeroStat(summaryStat) && (
            <>
              <span className="mx-1.5 text-muted-foreground/50"> </span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-scroll-anchor-ignore
            className="h-6 rounded-md border-transparent bg-transparent px-2 text-[12px] text-muted-foreground/70 shadow-none hover:bg-accent hover:text-foreground"
            onClick={() => setExpanded(routeThreadKey, turnSummary.turnId, !allDirectoriesExpanded)}
          >
            {allDirectoriesExpanded ? "折叠" : "展开"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6 rounded-md border-transparent bg-transparent px-2 text-[12px] text-foreground shadow-none hover:bg-accent"
            onClick={() => onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path)}
          >
            查看更改
          </Button>
        </div>
      </div>
      {allDirectoriesExpanded ? (
        <div className="px-2 py-1.5">
          <ChangedFilesTree
            key={`changed-files-tree:${turnSummary.turnId}`}
            turnId={turnSummary.turnId}
            files={checkpointFiles}
            allDirectoriesExpanded={allDirectoriesExpanded}
            resolvedTheme={resolvedTheme}
            onOpenTurnDiff={onOpenTurnDiff}
          />
        </div>
      ) : null}
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
            {expanded ? "Show less" : "Show full message"}
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
              <SkillInlineText text={props.text.slice(cursor, matchIndex)} skills={props.skills} />
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
              <SkillInlineText text={props.text.slice(cursor)} skills={props.skills} />
            </span>,
          );
        }

        return (
          <div
            className="whitespace-pre-wrap wrap-break-word text-[15px] leading-[1.78] text-foreground"
            style={USER_MESSAGE_FONT_STYLE}
          >
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
          <SkillInlineText text={props.text} skills={props.skills} />
        </span>,
      );
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div
        className="whitespace-pre-wrap wrap-break-word text-[15px] leading-[1.78] text-foreground"
        style={USER_MESSAGE_FONT_STYLE}
      >
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div
      className="whitespace-pre-wrap wrap-break-word text-[15px] leading-[1.78] text-foreground"
      style={USER_MESSAGE_FONT_STYLE}
    >
      <SkillInlineText text={props.text} skills={props.skills} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// so LegendList (and React) can skip re-rendering unchanged items.
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
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
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

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
}) {
  const { workEntry, workspaceRoot } = props;
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
    <div className="rounded-md px-1 py-0.5" style={USER_MESSAGE_FONT_STYLE}>
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
              <p className={cn("truncate text-[12px] leading-5", workToneClass(workEntry.tone))}>
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
                      "truncate text-[12px] leading-5",
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
          {hasDetail && (
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/45 transition-transform duration-150",
                isDetailExpanded && "rotate-180",
              )}
            />
          )}
        </div>
      </div>
      {hasChangedFiles && !previewIsChangedFiles && (
        <div className="mt-1 flex flex-wrap gap-1 pl-6">
          {workEntry.changedFiles?.slice(0, 4).map((filePath) => {
            const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
            return (
              <span
                key={`${workEntry.id}:${filePath}`}
                className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/75"
                title={displayPath}
              >
                {displayPath}
              </span>
            );
          })}
          {(workEntry.changedFiles?.length ?? 0) > 4 && (
            <span className="px-1 text-[11px] text-muted-foreground/55">
              +{(workEntry.changedFiles?.length ?? 0) - 4}
            </span>
          )}
        </div>
      )}
      {/* 展开的 Shell 折叠卡片 */}
      {hasDetail && isDetailExpanded && (
        <div className="mt-2 ml-6 rounded-xl border border-border/40 bg-muted/30 dark:bg-muted/15 p-3 flex flex-col gap-2 shadow-sm">
          {/* 首行：标题与复制按钮 */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-muted-foreground/60 uppercase">
              {capitalizePhrase(workEntry.toolTitle || workEntry.label || "Shell")}
            </span>
            <MessageCopyButton
              text={workEntry.detail || ""}
              size="icon-xs"
              className="h-6 w-6 border-transparent bg-transparent text-muted-foreground/60 shadow-none hover:bg-muted/20 hover:text-foreground"
            />
          </div>

          {/* 第二行：命令本身 */}
          <div className="font-mono text-[13px] font-semibold text-foreground/90 bg-background/40 px-2 py-1.5 rounded border border-border/20 whitespace-pre-wrap break-all flex items-center">
            <span className="text-emerald-500 mr-1.5 font-bold select-none">$</span>
            {workEntry.command || workEntry.rawCommand || defaultDisplayText}
          </div>

          {/* 输出内容区域 */}
          <pre className="font-mono text-[12px] leading-relaxed text-foreground/80 bg-background/25 dark:bg-background/40 rounded-lg p-2.5 border border-border/30 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto pr-1 select-text">
            {workEntry.detail}
          </pre>

          {/* 底部状态 */}
          <div className="flex justify-end items-center text-[11px] font-medium">
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
