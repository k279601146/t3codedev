import * as Equal from "effect/Equal";
import { type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import {
  type ChatMessage,
  type ProposedPlan,
  type TurnDiffFileChange,
  type TurnDiffSummary,
} from "../../types";
import { type MessageId, type TurnId } from "@t3tools/contracts";
import { normalizeProviderErrorMessage } from "@t3tools/shared/providerErrors";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
      turnDiffSummary?: TurnDiffSummary | undefined;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showAssistantMeta: boolean;
      showCompletionDivider: boolean;
      completionSummary: string | null;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      showSteerMarkerBefore?: boolean | undefined;
      showUrlPreviewCard: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
      canEditUserMessage?: boolean | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      kind: "image-generation";
      id: string;
      createdAt: string;
      items: ReadonlyArray<ImageGenerationRowItem>;
    }
  | { kind: "working"; id: string; createdAt: string | null };

export interface ImageGenerationRowItem {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "failed";
  label: string | null;
  imagePath: string | null;
  errorMessage?: string | undefined;
  connectionNotice?: string | undefined;
}

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export interface StableMaterializedTimelineRowsState<TRow extends { id: string }> {
  byId: Map<string, TRow>;
  result: TRow[];
}

export interface TurnProcessCollapseState {
  ownerAssistantMessageIdByRowId: Map<string, string>;
  summaryAssistantMessageIds: Set<string>;
  elapsedByAssistantMessageId: Map<string, string>;
  processStartedAtByAssistantMessageId: Map<string, string>;
  processSuspendedDurationMsByAssistantMessageId: Map<string, number>;
  processOpenSuspensionStartedAtByAssistantMessageId: Map<string, string>;
  terminalProcessAssistantMessageIds: Set<string>;
  summaryButtonHostByRowId: Map<string, string>;
}

type TurnProcessSpan = {
  firstProcessAtMs: number | null;
  firstProcessAtIso: string | null;
  lastEventAtMs: number | null;
  memberRowIds: string[];
  hasProcessRow: boolean;
  hasUnfinishedProcessRow: boolean;
  suspendedDurationMs: number;
  openSuspensionStartedAtIso: string | null;
  lastResultRow: MessagesTimelineRow | null;
  hostRowId: string | null;
  openSegmentHostRowId: string | null;
};

export function isCommandWorkEntry(
  entry: Pick<WorkLogEntry, "requestKind" | "itemType" | "command">,
): boolean {
  return (
    entry.requestKind === "command" || entry.itemType === "command_execution" || !!entry.command
  );
}

function isRuntimeWarningLikeEntry(entry: Pick<WorkLogEntry, "label">): boolean {
  const normalizedLabel = entry.label.trim().toLowerCase();
  return normalizedLabel === "runtime warning" || normalizedLabel === "runtime error";
}

function isRuntimeWarningEntry(entry: Pick<WorkLogEntry, "label">): boolean {
  return entry.label.trim().toLowerCase() === "runtime warning";
}

const PROVIDER_RECONNECT_ATTEMPT_PATTERN = /\breconnecting(?:\.\.\.|…)?\s*\d+\s*\/\s*\d+/i;

function shouldRenderRuntimeWarningEntry(
  entry: Pick<WorkLogEntry, "label" | "detail" | "output">,
): boolean {
  if (!isRuntimeWarningEntry(entry)) {
    return true;
  }
  const detail = (entry.detail || entry.output || "").trim();
  if (!PROVIDER_RECONNECT_ATTEMPT_PATTERN.test(detail)) {
    return false;
  }
  return normalizeProviderErrorMessage(detail)?.isActionable === true;
}

function workEntrySourceTurnId(entry: WorkLogEntry): TurnId | null {
  const sourceTurnId = (entry as { sourceTurnId?: TurnId | null }).sourceTurnId;
  return sourceTurnId ?? null;
}

function resolveWorkRowTurnDiffSummary(
  groupedEntries: ReadonlyArray<WorkLogEntry>,
  nextTimelineEntry: TimelineEntry | undefined,
  workRowCreatedAt: string,
  turnDiffSummaryByTurnId: ReadonlyMap<TurnId, TurnDiffSummary>,
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>,
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
): TurnDiffSummary | undefined {
  const sourceTurnId = groupedEntries.map(workEntrySourceTurnId).find(Boolean) ?? null;
  if (sourceTurnId !== null) {
    const sourceTurnSummary = turnDiffSummaryByTurnId.get(sourceTurnId);
    if (sourceTurnSummary) {
      return sourceTurnSummary;
    }
  }

  if (nextTimelineEntry?.kind !== "message" || nextTimelineEntry.message.role !== "assistant") {
    return turnDiffSummaries
      .filter((summary) => summary.completedAt >= workRowCreatedAt)
      .toSorted((left, right) => left.completedAt.localeCompare(right.completedAt))[0];
  }

  const assistantSummary =
    turnDiffSummaryByAssistantMessageId.get(nextTimelineEntry.message.id) ??
    (nextTimelineEntry.message.turnId
      ? turnDiffSummaryByTurnId.get(nextTimelineEntry.message.turnId)
      : undefined);
  if (assistantSummary) {
    return assistantSummary;
  }

  const nextAssistantCreatedAt = nextTimelineEntry.message.createdAt;
  return turnDiffSummaries
    .filter(
      (summary) =>
        summary.completedAt >= workRowCreatedAt && summary.completedAt >= nextAssistantCreatedAt,
    )
    .toSorted((left, right) => left.completedAt.localeCompare(right.completedAt))[0];
}

function shouldKeepSeparateFromAdjacentCommand(current: WorkLogEntry, next: WorkLogEntry): boolean {
  return (
    (isCommandWorkEntry(current) && isRuntimeWarningLikeEntry(next)) ||
    (isRuntimeWarningLikeEntry(current) && isCommandWorkEntry(next))
  );
}

export function resolveRunningWorkEntryStatusLabel(
  workEntry: Pick<
    WorkLogEntry,
    "status" | "requestKind" | "itemType" | "command" | "tone" | "changedFiles"
  >,
): string | null {
  if (workEntry.status !== "running") {
    return null;
  }
  if (isCommandWorkEntry(workEntry)) return "正在运行";
  if (workEntry.tone === "thinking") return "正在思考";
  if (workEntry.requestKind === "file-change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return "正在编辑";
  }
  if (workEntry.itemType === "image_view") return "正在生成图片";
  return null;
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

const IMAGE_FILE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(?:\?[^\s]*)?$/i;
const IMAGE_URL_PATTERN = /\bhttps?:\/\/\S+/i;
const DATA_URL_IMAGE_PATTERN = /\bdata:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/i;
const BASE64_FIELD_PATTERN = /"b64_json"\s*:\s*"([A-Za-z0-9+/=_-]+)"/i;
const IMAGE_BASE64_PATTERN = /^[A-Za-z0-9+/=_-]{512,}$/;
const IMAGE_PROXY_HOST_PATTERN =
  /\b(?:images?\/proxy|\/v\d+\/images?|cdn\.openai|oaiusercontent|generations)/i;

/**
 * Tool titles / labels that exclusively belong to image-generation tools.
 *
 * Tightened on purpose: a previous version matched any string containing
 * `image_gen` which caused regular shell commands (e.g. inspecting a file
 * named `image_gen_helper.ts`) to be promoted to the image-generation row
 * and render a Skeleton-Shimmer placeholder. Match only well-known tool
 * names with strict word boundaries.
 */
const IMAGE_GENERATION_TOOL_NAME_PATTERN =
  /^(?:image[_\s-]?generation|generate[_\s-]?image|create[_\s-]?image|dall[_\s-]?e(?:[_\s-]?\d+)?|midjourney|stable[_\s-]?diffusion|flux|imagen|gpt[_\s-]?image|sdxl)(?:[_\s-]?call)?$/i;

export function isImageGenerationWorkEntry(entry: WorkLogEntry): boolean {
  // Strongest signal: provider tagged this lifecycle item as an image view.
  if (entry.itemType === "image_view") {
    return true;
  }

  // Treat command/file-change/file-read tools as ordinary work entries even
  // when their label or detail mentions "image_gen" in passing — those are
  // nearly always shell commands like `grep image_gen ...` that should keep
  // rendering inside the collapsible work-group log, NOT a media card.
  if (
    entry.itemType === "command_execution" ||
    entry.itemType === "file_change" ||
    entry.itemType === "web_search" ||
    entry.requestKind === "command" ||
    entry.requestKind === "file-read" ||
    entry.requestKind === "file-change" ||
    typeof entry.command === "string" ||
    typeof entry.rawCommand === "string"
  ) {
    return false;
  }

  // Fall back to a strict tool-title match for adapters that surface image
  // generation as a generic mcp/dynamic tool call. Use word-boundary regex
  // so unrelated tool titles like "search_image_gen_history" don't match.
  const candidates = [entry.toolTitle, entry.label].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return candidates.some((value) =>
    IMAGE_GENERATION_TOOL_NAME_PATTERN.test(value.trim().toLowerCase()),
  );
}

export function pickGeneratedImagePath(entry: WorkLogEntry): string | null {
  const artifact = entry.generatedImage;
  const result = artifact?.result?.trim();

  if (result) {
    const dataUrlMatch = result.match(DATA_URL_IMAGE_PATTERN);
    if (dataUrlMatch) return dataUrlMatch[0];

    const b64Match = result.match(BASE64_FIELD_PATTERN);
    if (b64Match?.[1]) {
      return `data:image/png;base64,${b64Match[1]}`;
    }

    const unquotedResult = result.replace(/^[`'"\u201c\u201d]+|[`'"\u201c\u201d]+$/g, "").trim();
    if (IMAGE_BASE64_PATTERN.test(unquotedResult)) {
      return `data:image/png;base64,${unquotedResult}`;
    }
  }

  if (artifact?.savedPath && IMAGE_FILE_EXTENSION_PATTERN.test(artifact.savedPath)) {
    return artifact.savedPath;
  }

  const fromChanged = entry.changedFiles?.find((path) => IMAGE_FILE_EXTENSION_PATTERN.test(path));
  if (fromChanged) return fromChanged;

  const detail = entry.detail?.trim();
  if (!detail) return null;

  // 1. data: URL embedded directly in the tool output.
  const dataUrlMatch = detail.match(DATA_URL_IMAGE_PATTERN);
  if (dataUrlMatch) return dataUrlMatch[0];

  // 2. Standalone https URL — common for image-proxy adapters that return a
  //    short permalink. Accept if it looks like a media URL or known proxy.
  const urlMatch = detail.match(IMAGE_URL_PATTERN);
  if (urlMatch) {
    const url = urlMatch[0].replace(/[)\]\s.,;:'"]+$/, "");
    if (IMAGE_FILE_EXTENSION_PATTERN.test(url) || IMAGE_PROXY_HOST_PATTERN.test(url)) {
      return url;
    }
  }

  // 3. Raw base64 payload returned as JSON ({ "b64_json": "..." }).
  const b64Match = detail.match(BASE64_FIELD_PATTERN);
  if (b64Match?.[1]) {
    return `data:image/png;base64,${b64Match[1]}`;
  }

  // 4. Plain image filename in `detail` (legacy adapters).
  if (IMAGE_FILE_EXTENSION_PATTERN.test(detail)) {
    return detail;
  }

  return null;
}

function findLaterRuntimeIssueForImage(
  entries: ReadonlyArray<TimelineEntry>,
  startIndex: number,
): string | null {
  const imageEntry = entries[startIndex];
  if (!imageEntry || imageEntry.kind !== "work") {
    return null;
  }
  const imageCreatedAt = imageEntry.createdAt;
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.kind !== "work") {
      continue;
    }
    if (entry.createdAt < imageCreatedAt) {
      continue;
    }
    const label = entry.entry.label.trim().toLowerCase();
    const detail = entry.entry.detail?.trim();
    const isRuntimeIssue =
      label === "runtime warning" ||
      label === "runtime error" ||
      entry.entry.tone === "error" ||
      detail?.toLowerCase().includes("stream disconnected before completion") === true;
    if (!isRuntimeIssue) {
      continue;
    }
    return detail || entry.entry.label;
  }
  return null;
}

function toImageGenerationRowItem(
  id: string,
  entry: WorkLogEntry,
  runtimeIssue: string | null,
): ImageGenerationRowItem {
  const imagePath = pickGeneratedImagePath(entry);
  const imageStatus = entry.generatedImage?.status?.trim().toLowerCase();
  const imageFailed =
    imageStatus === "failed" ||
    imageStatus === "error" ||
    imageStatus === "cancelled" ||
    imageStatus === "canceled";
  const status =
    imageFailed && !imagePath
      ? "failed"
      : entry.status === "running" && !imagePath
      ? "running"
      : entry.status === "failed" && !imagePath
        ? "failed"
        : "completed";
  const runningLabel = resolveRunningWorkEntryStatusLabel(entry);
  const labelSource = entry.toolTitle ?? entry.label ?? null;
  const label =
    status === "failed"
      ? "图片生成失败"
      : (runningLabel ?? (labelSource ? normalizeCompactToolLabel(labelSource) : null));
  return {
    id,
    createdAt: entry.createdAt,
    status,
    label,
    imagePath,
    ...(status === "failed"
      ? { errorMessage: resolveImageGenerationFailureMessage(runtimeIssue ?? entry.detail) }
      : {}),
    ...(status === "running" && runtimeIssue
      ? { connectionNotice: "连接暂时不可用，正在继续等待图片结果" }
      : {}),
  };
}

function resolveImageGenerationFailureMessage(detail: string | null | undefined): string {
  const normalizedDetail = detail?.trim();
  if (!normalizedDetail) {
    return "图片生成失败，请稍后重试";
  }
  if (
    /image generation failed|\/v1\/images|images\/generations|images\/edits|http 404|not found|model.*not.*found|模型.*不可用|图片模型/u.test(
      normalizedDetail.toLowerCase(),
    )
  ) {
    return "图片模型暂时不可用，请稍后重试";
  }
  return normalizedDetail;
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

export interface StableAssistantMessageTextCache {
  get(messageId: string): string | undefined;
  set(messageId: string, text: string): void;
}

export function resolveStableAssistantMessageTextFromCache({
  messageId,
  text,
  cache,
}: {
  messageId: string;
  text: string | null | undefined;
  cache: StableAssistantMessageTextCache;
}): string {
  const normalizedText = text?.trim().length ? text : "";
  if (normalizedText) {
    cache.set(messageId, normalizedText);
    return normalizedText;
  }
  return cache.get(messageId) ?? "";
}

export type FileChangeAction = "create" | "delete" | "rename" | "edit" | "change";
export type FileChangeTense = "running" | "completed" | "bare";

const FILE_CHANGE_KIND_TO_ACTION: Record<string, FileChangeAction | undefined> = {
  added: "create",
  created: "create",
  new: "create",
  deleted: "delete",
  removed: "delete",
  renamed: "rename",
  moved: "rename",
  modified: "edit",
  changed: "edit",
  updated: "edit",
};

const FILE_CHANGE_VERB_LABELS: Record<FileChangeAction, Record<FileChangeTense, string>> = {
  create: {
    running: "正在创建",
    completed: "已创建",
    bare: "创建",
  },
  delete: {
    running: "正在删除",
    completed: "已删除",
    bare: "删除",
  },
  rename: {
    running: "正在重命名",
    completed: "已重命名",
    bare: "重命名",
  },
  edit: {
    running: "正在编辑",
    completed: "已编辑",
    bare: "编辑",
  },
  change: {
    running: "正在更新",
    completed: "已更新",
    bare: "更新",
  },
};

function normalizeFileChangeKind(kind: string | undefined): string {
  return kind?.trim().toLowerCase().replace(/_/g, "-") ?? "";
}

export function resolveFileChangeActionFromKind(kind: string | undefined): FileChangeAction | null {
  const normalized = normalizeFileChangeKind(kind);
  if (!normalized) {
    return null;
  }
  return FILE_CHANGE_KIND_TO_ACTION[normalized] ?? null;
}

export function resolveAggregateFileChangeAction(
  files: ReadonlyArray<Pick<TurnDiffFileChange, "kind">>,
): FileChangeAction {
  const actions = files
    .map((file) => resolveFileChangeActionFromKind(file.kind))
    .filter((action): action is FileChangeAction => action !== null);
  if (actions.length === 0) {
    return "change";
  }
  const firstAction = actions[0];
  if (firstAction && actions.every((action) => action === firstAction)) {
    return firstAction;
  }
  return "change";
}

export function fileChangeVerbLabel(action: FileChangeAction, tense: FileChangeTense): string {
  return FILE_CHANGE_VERB_LABELS[action][tense];
}

function resolveResultCompletedAt(row: MessagesTimelineRow): string | null {
  if (row.kind === "message" && row.message.role === "assistant") {
    return !row.message.streaming && row.message.completedAt ? row.message.completedAt : null;
  }
  if (row.kind === "proposed-plan") {
    return row.proposedPlan.updatedAt || row.proposedPlan.createdAt;
  }
  if (row.kind === "image-generation") {
    const completedItems = row.items.filter((item) => item.status !== "running");
    if (completedItems.length !== row.items.length || completedItems.length === 0) {
      return null;
    }
    return completedItems.reduce(
      (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
      completedItems[0]!.createdAt,
    );
  }
  return null;
}

function isVisibleResultRow(row: MessagesTimelineRow): boolean {
  return (
    (row.kind === "message" && row.message.role === "assistant") ||
    row.kind === "proposed-plan" ||
    row.kind === "image-generation"
  );
}

function resolveResultOwnerId(row: MessagesTimelineRow): string | null {
  if (row.kind === "message" && row.message.role === "assistant") {
    return row.message.id;
  }
  if (row.kind === "proposed-plan" || row.kind === "image-generation") {
    return row.id;
  }
  return null;
}

export function deriveTurnProcessCollapseState(
  rows: ReadonlyArray<MessagesTimelineRow>,
  options: { latestProcessIsTerminal?: boolean } = {},
): TurnProcessCollapseState {
  const owner = new Map<string, string>();
  const summaries = new Set<string>();
  const elapsedMap = new Map<string, string>();
  const startedAtMap = new Map<string, string>();
  const suspendedDurationMsMap = new Map<string, number>();
  const openSuspensionStartedAtMap = new Map<string, string>();
  const terminalProcessIds = new Set<string>();
  const hostByRowId = new Map<string, string>();

  const createTurnProcessSpan = (): TurnProcessSpan => ({
    firstProcessAtMs: null,
    firstProcessAtIso: null,
    lastEventAtMs: null,
    memberRowIds: [],
    hasProcessRow: false,
    hasUnfinishedProcessRow: false,
    suspendedDurationMs: 0,
    openSuspensionStartedAtIso: null,
    lastResultRow: null,
    hostRowId: null,
    openSegmentHostRowId: null,
  });

  const spans: TurnProcessSpan[] = [];
  const flushTurnProcessSpan = (span: TurnProcessSpan) => {
    if (!span.hasProcessRow) {
      return;
    }
    spans.push(span);
  };

  let currentSpan = createTurnProcessSpan();
  for (const row of rows) {
    if (row.kind === "message" && row.message.role === "user") {
      flushTurnProcessSpan(currentSpan);
      currentSpan = createTurnProcessSpan();
      continue;
    }

    if (row.kind === "work") {
      addProcessRowTiming(currentSpan, row);
      currentSpan.memberRowIds.push(row.id);
      currentSpan.hasProcessRow = true;
      currentSpan.hasUnfinishedProcessRow =
        currentSpan.hasUnfinishedProcessRow || hasUnfinishedWorkEntries(row.groupedEntries);
      if (!currentSpan.openSegmentHostRowId) {
        currentSpan.openSegmentHostRowId = row.id;
        currentSpan.hostRowId = row.id;
      }
      continue;
    }

    if (row.kind === "message" && row.message.role === "assistant") {
      if (currentSpan.hasProcessRow) {
        currentSpan.memberRowIds.push(row.id);
      }
      addMessageRowTiming(currentSpan, row);
    }

    if (isVisibleResultRow(row)) {
      if (currentSpan.hasProcessRow) {
        currentSpan.lastResultRow = row;
        addResultRowTiming(currentSpan, row);
        currentSpan.openSegmentHostRowId = null;
      }
    }
  }
  flushTurnProcessSpan(currentSpan);

  spans.forEach((span, index) => {
    const ownerId = span.lastResultRow
      ? resolveResultOwnerId(span.lastResultRow)
      : span.hostRowId;
    if (!ownerId || span.memberRowIds.length === 0) {
      return;
    }

    summaries.add(ownerId);
    for (const rowId of span.memberRowIds) {
      owner.set(rowId, ownerId);
    }
    hostByRowId.set(span.lastResultRow?.id ?? span.hostRowId ?? span.memberRowIds[0]!, ownerId);
    if (span.firstProcessAtIso) {
      startedAtMap.set(ownerId, span.firstProcessAtIso);
    }
    if (span.suspendedDurationMs > 0) {
      suspendedDurationMsMap.set(ownerId, span.suspendedDurationMs);
    }
    if (span.openSuspensionStartedAtIso) {
      openSuspensionStartedAtMap.set(ownerId, span.openSuspensionStartedAtIso);
    }

    const isLatestSpan = index === spans.length - 1;
    const resultCompletedAt = span.lastResultRow
      ? resolveResultCompletedAt(span.lastResultRow)
      : null;
    const isTerminal =
      !span.hasUnfinishedProcessRow &&
      (resultCompletedAt !== null || !isLatestSpan || options.latestProcessIsTerminal === true);
    if (!isTerminal) {
      return;
    }
    terminalProcessIds.add(ownerId);
    if (span.firstProcessAtMs !== null && span.lastEventAtMs !== null) {
      elapsedMap.set(
        ownerId,
        formatProcessElapsedDuration(
          span.firstProcessAtMs,
          span.lastEventAtMs,
          span.suspendedDurationMs,
        ),
      );
    }
  });

  return {
    ownerAssistantMessageIdByRowId: owner,
    summaryAssistantMessageIds: summaries,
    elapsedByAssistantMessageId: elapsedMap,
    processStartedAtByAssistantMessageId: startedAtMap,
    processSuspendedDurationMsByAssistantMessageId: suspendedDurationMsMap,
    processOpenSuspensionStartedAtByAssistantMessageId: openSuspensionStartedAtMap,
    terminalProcessAssistantMessageIds: terminalProcessIds,
    summaryButtonHostByRowId: hostByRowId,
  };
}

export function formatProcessElapsedDuration(
  startMs: number,
  endMs: number,
  suspendedDurationMs: number,
): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return "0s";
  }
  const normalizedSuspendedDurationMs = Number.isFinite(suspendedDurationMs)
    ? Math.max(0, suspendedDurationMs)
    : 0;
  const elapsedMs = Math.max(0, endMs - startMs - normalizedSuspendedDurationMs);
  return `${Math.floor(elapsedMs / 1_000)}s`;
}

function addProcessTimestamp(span: TurnProcessSpan, iso: string | null | undefined) {
  if (!iso) {
    return;
  }
  const timestampMs = Date.parse(iso);
  if (Number.isNaN(timestampMs)) {
    return;
  }
  if (span.firstProcessAtMs === null || timestampMs < span.firstProcessAtMs) {
    span.firstProcessAtMs = timestampMs;
    span.firstProcessAtIso = iso;
  }
  if (span.lastEventAtMs === null || timestampMs > span.lastEventAtMs) {
    span.lastEventAtMs = timestampMs;
  }
}

function addLastEventTimestamp(span: TurnProcessSpan, iso: string | null | undefined) {
  if (!iso) {
    return;
  }
  const timestampMs = Date.parse(iso);
  if (Number.isNaN(timestampMs)) {
    return;
  }
  if (span.lastEventAtMs === null || timestampMs > span.lastEventAtMs) {
    span.lastEventAtMs = timestampMs;
  }
}

function addProcessSuspension(span: TurnProcessSpan, entry: WorkLogEntry) {
  const summary = entry.userInputSummary;
  if (!summary) {
    return;
  }
  addProcessTimestamp(span, summary.requestedAt);
  if (summary.status === "resolved" && summary.resolvedAt) {
    addProcessTimestamp(span, summary.resolvedAt);
    const startedAt = Date.parse(summary.requestedAt);
    const endedAt = Date.parse(summary.resolvedAt);
    if (!Number.isNaN(startedAt) && !Number.isNaN(endedAt) && endedAt > startedAt) {
      span.suspendedDurationMs += endedAt - startedAt;
    }
    return;
  }
  if (summary.status === "requested") {
    span.openSuspensionStartedAtIso = summary.requestedAt;
  }
}

function addProcessRowTiming(
  span: TurnProcessSpan,
  row: Extract<MessagesTimelineRow, { kind: "work" }>,
) {
  addProcessTimestamp(span, row.createdAt);
  for (const entry of row.groupedEntries) {
    addProcessTimestamp(span, entry.createdAt);
    addProcessSuspension(span, entry);
  }
}

function addMessageRowTiming(
  span: TurnProcessSpan,
  row: Extract<MessagesTimelineRow, { kind: "message" }>,
) {
  addLastEventTimestamp(span, row.message.createdAt || row.createdAt);
  addLastEventTimestamp(span, row.message.completedAt);
}

function addResultRowTiming(span: TurnProcessSpan, row: MessagesTimelineRow) {
  if (row.kind === "proposed-plan") {
    addLastEventTimestamp(span, row.proposedPlan.createdAt);
    addLastEventTimestamp(span, row.proposedPlan.updatedAt);
    return;
  }
  if (row.kind === "image-generation") {
    for (const item of row.items) {
      addLastEventTimestamp(span, item.createdAt);
    }
  }
}

function hasUnfinishedWorkEntries(entries: ReadonlyArray<WorkLogEntry>): boolean {
  return entries.some(
    (entry) => entry.status === "running" || entry.userInputSummary?.status === "requested",
  );
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  completionSummary?: string | null;
  isWorking: boolean;
  activeTurnInProgress?: boolean;
  activeTurnId?: TurnId | null;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const turnDiffSummaryByTurnId = new Map<TurnId, TurnDiffSummary>();
  const turnDiffSummariesByAssistantMessage = [
    ...input.turnDiffSummaryByAssistantMessageId.values(),
  ];
  for (const summary of turnDiffSummariesByAssistantMessage) {
    turnDiffSummaryByTurnId.set(summary.turnId, summary);
  }
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);
  const pendingSteerMarkerTurnIds = new Set<TurnId>();
  let editableUserMessageId: MessageId | null = null;
  for (let index = input.timelineEntries.length - 1; index >= 0; index -= 1) {
    const entry = input.timelineEntries[index];
    if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
      continue;
    }
    editableUserMessageId = entry.message.id;
    break;
  }

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      // Image generation entries surface as their own first-class row in the
      // chat stream — Skeleton-Shimmer while running, final image once ready.
      // Keep them out of the collapsible work-group so the script log box
      // doesn't double up on the same artifact.
      //
      // Consecutive image-generation entries collapse into a single row so a
      // multi-image request (n=4 prompts, etc.) renders the shimmers side by
      // side and each tile swaps in independently as its image arrives.
      if (isImageGenerationWorkEntry(timelineEntry.entry)) {
        const items: ImageGenerationRowItem[] = [
          toImageGenerationRowItem(
            timelineEntry.id,
            timelineEntry.entry,
            findLaterRuntimeIssueForImage(input.timelineEntries, index),
          ),
        ];
        let cursor = index + 1;
        while (cursor < input.timelineEntries.length) {
          const nextEntry = input.timelineEntries[cursor];
          if (!nextEntry || nextEntry.kind !== "work") break;
          if (!isImageGenerationWorkEntry(nextEntry.entry)) break;
          items.push(
            toImageGenerationRowItem(
              nextEntry.id,
              nextEntry.entry,
              findLaterRuntimeIssueForImage(input.timelineEntries, cursor),
            ),
          );
          cursor += 1;
        }
        nextRows.push({
          kind: "image-generation",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          items,
        });
        index = cursor - 1;
        continue;
      }

      if (
        isRuntimeWarningEntry(timelineEntry.entry) &&
        !shouldRenderRuntimeWarningEntry(timelineEntry.entry)
      ) {
        continue;
      }

      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        if (
          isRuntimeWarningEntry(nextEntry.entry) &&
          !shouldRenderRuntimeWarningEntry(nextEntry.entry)
        ) {
          cursor += 1;
          continue;
        }
        if (isImageGenerationWorkEntry(nextEntry.entry)) break;
        if (
          shouldKeepSeparateFromAdjacentCommand(
            groupedEntries[groupedEntries.length - 1]!,
            nextEntry.entry,
          )
        ) {
          break;
        }
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      const turnDiffSummary = resolveWorkRowTurnDiffSummary(
        groupedEntries,
        input.timelineEntries[cursor],
        timelineEntry.createdAt,
        turnDiffSummaryByTurnId,
        input.turnDiffSummaryByAssistantMessageId,
        turnDiffSummariesByAssistantMessage,
      );
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
        ...(turnDiffSummary ? { turnDiffSummary } : {}),
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    const shouldShowSteerMarkerBefore =
      timelineEntry.message.role === "assistant" &&
      timelineEntry.message.turnId != null &&
      pendingSteerMarkerTurnIds.has(timelineEntry.message.turnId);
    if (shouldShowSteerMarkerBefore && timelineEntry.message.turnId != null) {
      pendingSteerMarkerTurnIds.delete(timelineEntry.message.turnId);
    }

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      input.activeTurnInProgress === true &&
      input.activeTurnId != null &&
      timelineEntry.message.turnId === input.activeTurnId;

    const showCompletionDivider = input.completionDividerBeforeEntryId === timelineEntry.id;
    const isTerminalAssistantMessage =
      timelineEntry.message.role === "assistant" &&
      terminalAssistantMessageIds.has(timelineEntry.message.id);

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showAssistantMeta: timelineEntry.message.role !== "assistant" || isTerminalAssistantMessage,
      showCompletionDivider,
      completionSummary: showCompletionDivider ? (input.completionSummary ?? null) : null,
      showAssistantCopyButton: isTerminalAssistantMessage,
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      showSteerMarkerBefore: shouldShowSteerMarkerBefore ? true : undefined,
      showUrlPreviewCard:
        timelineEntry.message.role === "assistant" &&
        isTerminalAssistantMessage &&
        !timelineEntry.message.streaming &&
        !input.activeTurnInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
      canEditUserMessage:
        timelineEntry.message.role === "user" && timelineEntry.message.id === editableUserMessageId
          ? true
          : undefined,
    });
    if (
      timelineEntry.message.role === "user" &&
      timelineEntry.message.turnId !== undefined &&
      timelineEntry.message.turnId !== null
    ) {
      pendingSteerMarkerTurnIds.add(timelineEntry.message.turnId);
    }
  }

  const hasRunningWork = nextRows.some((row) => {
    if (row.kind === "image-generation") {
      return row.items.some((item) => item.status === "running");
    }
    if (row.kind === "work") {
      return row.groupedEntries.some((entry) => entry.status === "running");
    }
    return false;
  });

  if (input.isWorking && !hasRunningWork) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return nextRows;
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

export function computeStableMaterializedTimelineRows<TRow extends { id: string }>(
  rows: TRow[],
  previous: StableMaterializedTimelineRowsState<TRow>,
  isUnchanged: (previous: TRow, next: TRow) => boolean,
): StableMaterializedTimelineRowsState<TRow> {
  const next = new Map<string, TRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "image-generation": {
      const bm = b as typeof a;
      if (a.createdAt !== bm.createdAt) return false;
      if (a.items.length !== bm.items.length) return false;
      for (let index = 0; index < a.items.length; index += 1) {
        const ai = a.items[index]!;
        const bi = bm.items[index]!;
        if (
          ai.id !== bi.id ||
          ai.createdAt !== bi.createdAt ||
          ai.status !== bi.status ||
          ai.label !== bi.label ||
          ai.imagePath !== bi.imagePath
        ) {
          return false;
        }
      }
      return true;
    }

    case "work": {
      const bm = b as typeof a;
      return (
        Equal.equals(a.groupedEntries, bm.groupedEntries) &&
        a.turnDiffSummary === bm.turnDiffSummary
      );
    }

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showAssistantMeta === bm.showAssistantMeta &&
        a.showCompletionDivider === bm.showCompletionDivider &&
        a.completionSummary === bm.completionSummary &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.showSteerMarkerBefore === bm.showSteerMarkerBefore &&
        a.showUrlPreviewCard === bm.showUrlPreviewCard &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount &&
        a.canEditUserMessage === bm.canEditUserMessage
      );
    }
  }
}
