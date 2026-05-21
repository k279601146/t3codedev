import * as Equal from "effect/Equal";
import { type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { type MessageId, type TurnId } from "@t3tools/contracts";

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
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showCompletionDivider: boolean;
      completionSummary: string | null;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
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
  status: "running" | "completed";
  label: string | null;
  imagePath: string | null;
}

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
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
const IMAGE_PROXY_HOST_PATTERN = /\b(?:images?\/proxy|\/v\d+\/images?|cdn\.openai|oaiusercontent|generations)/i;

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

function pickGeneratedImagePath(entry: WorkLogEntry): string | null {
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

function toImageGenerationRowItem(id: string, entry: WorkLogEntry): ImageGenerationRowItem {
  const status = entry.status === "running" ? "running" : "completed";
  const imagePath = pickGeneratedImagePath(entry);
  const labelSource = entry.toolTitle ?? entry.label ?? null;
  const label = labelSource ? normalizeCompactToolLabel(labelSource) : null;
  return {
    id,
    createdAt: entry.createdAt,
    status,
    label,
    imagePath,
  };
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
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);

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
          toImageGenerationRowItem(timelineEntry.id, timelineEntry.entry),
        ];
        let cursor = index + 1;
        while (cursor < input.timelineEntries.length) {
          const nextEntry = input.timelineEntries[cursor];
          if (!nextEntry || nextEntry.kind !== "work") break;
          if (!isImageGenerationWorkEntry(nextEntry.entry)) break;
          items.push(toImageGenerationRowItem(nextEntry.id, nextEntry.entry));
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

      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        if (isImageGenerationWorkEntry(nextEntry.entry)) break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
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

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      input.activeTurnInProgress === true &&
      input.activeTurnId != null &&
      timelineEntry.message.turnId === input.activeTurnId;

    const showCompletionDivider =
      timelineEntry.message.role === "assistant" &&
      input.completionDividerBeforeEntryId === timelineEntry.id;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider,
      completionSummary: showCompletionDivider ? (input.completionSummary ?? null) : null,
      showAssistantCopyButton:
        timelineEntry.message.role === "assistant" &&
        terminalAssistantMessageIds.has(timelineEntry.message.id),
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (input.isWorking) {
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

    case "work":
      return Equal.equals(a.groupedEntries, (b as typeof a).groupedEntries);

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showCompletionDivider === bm.showCompletionDivider &&
        a.completionSummary === bm.completionSummary &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
