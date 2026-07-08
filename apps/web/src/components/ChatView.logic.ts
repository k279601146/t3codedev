import {
  type EnvironmentId,
  isProviderDriverKind,
  type MessageId,
  ProjectId,
  type ModelSelection,
  type ProviderDriverKind,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import {
  type ChatMessage,
  type SessionPhase,
  type Thread,
  type ThreadSession,
  type TurnDiffSummary,
  type ProposedPlan,
} from "../types";
import { deriveTimelineEntries, type WorkLogEntry } from "../session-logic";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import * as Schema from "effect/Schema";
import { selectThreadByRef, useStore } from "../store";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import type { DraftThreadEnvMode } from "../composerDraftStore";
import type { RightPanelArtifact } from "./ThreadRightPanel";
import { isImageGenerationWorkEntry, pickGeneratedImagePath } from "./chat/MessagesTimeline.logic";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
export const MAX_HIDDEN_MOUNTED_TERMINAL_THREADS = 10;

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export type ThreadErrorPlacement = "banner" | "assistant";

export interface ThreadErrorDisplay {
  readonly message: string;
  readonly placement: ThreadErrorPlacement;
}

export type ThreadErrorInput =
  | string
  | null
  | {
      readonly message: string | null;
      readonly placement?: ThreadErrorPlacement;
    };

export function resolveThreadErrorDisplay(error: ThreadErrorInput): ThreadErrorDisplay | null {
  if (error === null) return null;
  if (typeof error === "string") {
    return { message: error, placement: "banner" };
  }
  if (error.message === null) return null;
  return {
    message: error.message,
    placement: error.placement ?? "banner",
  };
}

const IMAGE_ARTIFACT_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(?:\?[^\s]*)?$/i;

export function buildRightPanelArtifacts(input: {
  timelineMessages: ReadonlyArray<ChatMessage>;
  workLogEntries: ReadonlyArray<WorkLogEntry>;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
}): RightPanelArtifact[] {
  const artifacts: RightPanelArtifact[] = [];
  const seen = new Set<string>();

  const addArtifact = (artifact: RightPanelArtifact) => {
    if (seen.has(artifact.id)) return;
    seen.add(artifact.id);
    artifacts.push(artifact);
  };

  const toFileArtifact = (filePath: string): RightPanelArtifact => {
    const segments = filePath.split(/[\\/]/);
    const isImage = IMAGE_ARTIFACT_EXTENSION_PATTERN.test(filePath);
    return {
      id: `file:${filePath}`,
      name: segments.at(-1) || filePath,
      type: isImage ? "image" : "file",
      filePath,
      ...(isImage ? { previewUrl: filePath } : {}),
    };
  };

  for (const message of input.timelineMessages) {
    for (const attachment of message.attachments ?? []) {
      if (!attachment.previewUrl) continue;
      addArtifact({
        id: `attachment:${attachment.id}`,
        name: attachment.name,
        type: attachment.type,
        previewUrl: attachment.previewUrl,
        mimeType: attachment.mimeType,
      });
    }
  }

  for (const entry of input.workLogEntries) {
    if (isImageGenerationWorkEntry(entry)) {
      const imagePath = pickGeneratedImagePath(entry);
      if (imagePath) {
        const segments = imagePath.split(/[\\/]/);
        addArtifact({
          id: `generated-image:${imagePath}`,
          name: segments.at(-1) || entry.label || "Generated image",
          type: "image",
          previewUrl: imagePath,
          filePath:
            imagePath.startsWith("data:") || /^https?:\/\//i.test(imagePath)
              ? undefined
              : imagePath,
          mimeType: "image/png",
        });
      }
    }

    for (const filePath of entry.changedFiles ?? []) {
      addArtifact(toFileArtifact(filePath));
    }
  }

  for (const summary of input.turnDiffSummaries) {
    for (const file of summary.files) {
      addArtifact(toFileArtifact(file.path));
    }
  }

  return artifacts;
}

export interface ChatTimelineDerivedState {
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  rightPanelArtifacts: RightPanelArtifact[];
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
}

export interface ChatTimelineDerivedCacheInput {
  threadKey: string | null;
  timelineMessages: ReadonlyArray<ChatMessage>;
  proposedPlans: ReadonlyArray<ProposedPlan>;
  workLogEntries: ReadonlyArray<WorkLogEntry>;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  inferredCheckpointTurnCountByTurnId: Readonly<Record<TurnId, number | undefined>>;
  suppressHistoricalWorkLogEntries?: boolean;
}

export function deriveEditedMessageResubmissionTimelineMessages(input: {
  serverMessages: ReadonlyArray<ChatMessage>;
  optimisticMessages: ReadonlyArray<ChatMessage>;
  targetMessageId: MessageId;
  replacementMessageId: MessageId;
}): ChatMessage[] {
  const replacementServerMessage = input.serverMessages.find(
    (message) => message.id === input.replacementMessageId,
  );
  const replacementOptimisticMessage = input.optimisticMessages.find(
    (message) => message.id === input.replacementMessageId,
  );
  const replacementMessage = replacementServerMessage ?? replacementOptimisticMessage ?? null;
  const targetIndex = input.serverMessages.findIndex(
    (message) => message.id === input.targetMessageId,
  );
  const visibleMessages =
    targetIndex >= 0 ? input.serverMessages.slice(0, targetIndex) : [...input.serverMessages];

  if (
    !replacementMessage ||
    visibleMessages.some((message) => message.id === replacementMessage.id)
  ) {
    return visibleMessages;
  }

  return [...visibleMessages, replacementMessage];
}

export function createChatTimelineDerivedStateCache(): (
  input: ChatTimelineDerivedCacheInput,
) => ChatTimelineDerivedState {
  let previousInput: ChatTimelineDerivedCacheInput | null = null;
  let previousResult: ChatTimelineDerivedState | null = null;

  return (input) => {
    if (
      previousInput &&
      previousResult &&
      previousInput.threadKey === input.threadKey &&
      previousInput.timelineMessages === input.timelineMessages &&
      previousInput.proposedPlans === input.proposedPlans &&
      previousInput.workLogEntries === input.workLogEntries &&
      previousInput.turnDiffSummaries === input.turnDiffSummaries &&
      previousInput.inferredCheckpointTurnCountByTurnId ===
        input.inferredCheckpointTurnCountByTurnId &&
      previousInput.suppressHistoricalWorkLogEntries === input.suppressHistoricalWorkLogEntries
    ) {
      return previousResult;
    }

    const suppressHistoricalWorkState = input.suppressHistoricalWorkLogEntries === true;
    const visibleProposedPlans = suppressHistoricalWorkState ? [] : [...input.proposedPlans];
    const visibleWorkLogEntries = suppressHistoricalWorkState ? [] : [...input.workLogEntries];
    const visibleTurnDiffSummaries = suppressHistoricalWorkState
      ? []
      : [...input.turnDiffSummaries];
    const timelineEntries = deriveTimelineEntries(
      [...input.timelineMessages],
      visibleProposedPlans,
      visibleWorkLogEntries,
    );
    const turnDiffSummaryByAssistantMessageId = buildTurnDiffSummaryByAssistantMessageId({
      timelineEntries,
      turnDiffSummaries: visibleTurnDiffSummaries,
    });
    const result: ChatTimelineDerivedState = {
      timelineEntries,
      rightPanelArtifacts: buildRightPanelArtifacts({
        timelineMessages: input.timelineMessages,
        workLogEntries: visibleWorkLogEntries,
        turnDiffSummaries: visibleTurnDiffSummaries,
      }),
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId: buildRevertTurnCountByUserMessageId({
        timelineEntries,
        turnDiffSummaries: visibleTurnDiffSummaries,
        turnDiffSummaryByAssistantMessageId,
        inferredCheckpointTurnCountByTurnId: input.inferredCheckpointTurnCountByTurnId,
      }),
    };
    previousInput = input;
    previousResult = result;
    return result;
  };
}

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
  error: string | null,
): Thread {
  return {
    id: threadId,
    environmentId: draftThread.environmentId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    archivedAt: null,
    latestTurn: null,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function shouldShowEmptyNewThread(input: {
  routeKind: "server" | "draft";
  isConversationThread: boolean;
  activeThreadMessagesCount: number;
  displayedMessagesCount: number;
  latestTurn: Thread["latestTurn"];
  error: string | null | undefined;
  isWorking: boolean;
}): boolean {
  return (
    (input.routeKind === "draft" || input.isConversationThread) &&
    input.activeThreadMessagesCount === 0 &&
    input.displayedMessagesCount === 0 &&
    input.latestTurn === null &&
    !input.error &&
    !input.isWorking
  );
}

export function shouldWriteThreadErrorToCurrentServerThread(input: {
  serverThread:
    | {
        environmentId: EnvironmentId;
        id: ThreadId;
      }
    | null
    | undefined;
  routeThreadRef: ScopedThreadRef;
  targetThreadId: ThreadId;
}): boolean {
  return Boolean(
    input.serverThread &&
    input.targetThreadId === input.routeThreadRef.threadId &&
    input.serverThread.environmentId === input.routeThreadRef.environmentId &&
    input.serverThread.id === input.targetThreadId,
  );
}

export function reconcileMountedTerminalThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadTerminalOpen: boolean;
  maxHiddenThreadCount?: number;
}): string[] {
  const openThreadIdSet = new Set(input.openThreadIds);
  const hiddenThreadIds = input.currentThreadIds.filter(
    (threadId) => threadId !== input.activeThreadId && openThreadIdSet.has(threadId),
  );
  const maxHiddenThreadCount = Math.max(
    0,
    input.maxHiddenThreadCount ?? MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  );
  const nextThreadIds =
    hiddenThreadIds.length > maxHiddenThreadCount
      ? hiddenThreadIds.slice(-maxHiddenThreadCount)
      : hiddenThreadIds;

  if (
    input.activeThreadId &&
    input.activeThreadTerminalOpen &&
    !nextThreadIds.includes(input.activeThreadId)
  ) {
    nextThreadIds.push(input.activeThreadId);
  }

  return nextThreadIds;
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function buildTurnDiffSummaryByAssistantMessageId(input: {
  timelineEntries: ReadonlyArray<{ readonly kind: string; readonly message?: ChatMessage }>;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
}): Map<MessageId, TurnDiffSummary> {
  const byMessageId = new Map<MessageId, TurnDiffSummary>();
  const byTurnId = new Map<TurnId, TurnDiffSummary>();

  for (const summary of input.turnDiffSummaries) {
    byTurnId.set(summary.turnId, summary);
    if (summary.assistantMessageId) {
      byMessageId.set(summary.assistantMessageId, summary);
    }
  }

  const terminalAssistantMessageIdByTurnId = new Map<TurnId, MessageId>();
  for (const entry of input.timelineEntries) {
    if (entry.kind !== "message") {
      continue;
    }
    const message = entry.message;
    if (!message || message.role !== "assistant" || !message.turnId) {
      continue;
    }
    terminalAssistantMessageIdByTurnId.set(message.turnId, message.id);
  }

  for (const [turnId, messageId] of terminalAssistantMessageIdByTurnId) {
    if (byMessageId.has(messageId)) {
      continue;
    }
    const summary = byTurnId.get(turnId);
    if (summary) {
      byMessageId.set(messageId, summary);
    }
  }

  return byMessageId;
}

function resolveRevertTargetTurnCount(
  summary: TurnDiffSummary | undefined,
  inferredCheckpointTurnCountByTurnId: Readonly<Record<TurnId, number | undefined>>,
): number | null {
  if (!summary || summary.status === "missing") {
    return null;
  }

  const turnCount =
    summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
  return typeof turnCount === "number" ? Math.max(0, turnCount - 1) : null;
}

export function buildRevertTurnCountByUserMessageId(input: {
  timelineEntries: ReadonlyArray<{ readonly kind: string; readonly message?: ChatMessage }>;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  inferredCheckpointTurnCountByTurnId: Readonly<Record<TurnId, number | undefined>>;
}): Map<MessageId, number> {
  const byUserMessageId = new Map<MessageId, number>();
  const assignedSummaryTurnIds = new Set<TurnId>();
  const summaryByTurnId = new Map<TurnId, TurnDiffSummary>();
  for (const summary of input.turnDiffSummaries) {
    summaryByTurnId.set(summary.turnId, summary);
  }

  const userEntries = input.timelineEntries.flatMap((entry) =>
    entry.kind === "message" && entry.message?.role === "user" ? [entry.message] : [],
  );

  const assignSummary = (messageId: MessageId, summary: TurnDiffSummary | undefined): boolean => {
    const targetTurnCount = resolveRevertTargetTurnCount(
      summary,
      input.inferredCheckpointTurnCountByTurnId,
    );
    if (targetTurnCount === null || !summary) {
      return false;
    }
    byUserMessageId.set(messageId, targetTurnCount);
    assignedSummaryTurnIds.add(summary.turnId);
    return true;
  };

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const entry = input.timelineEntries[index];
    if (!entry || entry.kind !== "message" || entry.message?.role !== "user") {
      continue;
    }

    const userTurnSummary = entry.message.turnId
      ? summaryByTurnId.get(entry.message.turnId)
      : undefined;
    if (assignSummary(entry.message.id, userTurnSummary)) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < input.timelineEntries.length; nextIndex += 1) {
      const nextEntry = input.timelineEntries[nextIndex];
      if (!nextEntry || nextEntry.kind !== "message") {
        continue;
      }
      if (nextEntry.message?.role === "user") {
        break;
      }
      if (!nextEntry.message || nextEntry.message.role !== "assistant") {
        continue;
      }

      if (
        !assignSummary(
          entry.message.id,
          input.turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id),
        )
      ) {
        continue;
      }

      break;
    }
  }

  const actionableSummaries = input.turnDiffSummaries
    .filter(
      (summary) =>
        resolveRevertTargetTurnCount(summary, input.inferredCheckpointTurnCountByTurnId) !== null,
    )
    .toSorted((left, right) => left.completedAt.localeCompare(right.completedAt));
  for (let index = 0; index < userEntries.length; index += 1) {
    const message = userEntries[index];
    if (!message || byUserMessageId.has(message.id)) {
      continue;
    }
    const nextUserMessage = userEntries[index + 1];
    const fallbackSummary = actionableSummaries.find(
      (summary) =>
        !assignedSummaryTurnIds.has(summary.turnId) &&
        summary.completedAt >= message.createdAt &&
        (!nextUserMessage || summary.completedAt < nextUserMessage.createdAt),
    );
    assignSummary(message.id, fallbackSummary);
  }

  return byUserMessageId;
}

export function inferRevertTurnCountBeforeUserMessage(
  messages: ReadonlyArray<Pick<ChatMessage, "id" | "role">>,
  messageId: MessageId,
): number | null {
  let userMessageCountBeforeTarget = 0;
  for (const message of messages) {
    if (message.id === messageId) {
      return message.role === "user" ? userMessageCountBeforeTarget : null;
    }
    if (message.role === "user") {
      userMessageCountBeforeTarget += 1;
    }
  }
  return null;
}

export function estimateConversationTurnCountForRollback(input: {
  messages: ReadonlyArray<Pick<ChatMessage, "role">>;
  turnDiffSummaries: ReadonlyArray<Pick<TurnDiffSummary, "checkpointTurnCount">>;
}): number {
  const checkpointTurnCount = input.turnDiffSummaries.reduce(
    (maxTurnCount, summary) =>
      typeof summary.checkpointTurnCount === "number"
        ? Math.max(maxTurnCount, summary.checkpointTurnCount)
        : maxTurnCount,
    0,
  );
  const userMessageCount = input.messages.filter((message) => message.role === "user").length;
  const assistantMessageCount = input.messages.filter(
    (message) => message.role === "assistant",
  ).length;
  return Math.max(checkpointTurnCount, userMessageCount, assistantMessageCount);
}

export function deriveEditedMessageResendRollback(input: {
  messages: ReadonlyArray<Pick<ChatMessage, "id" | "role">>;
  turnDiffSummaries: ReadonlyArray<Pick<TurnDiffSummary, "checkpointTurnCount">>;
  targetMessageId: MessageId;
  mappedTargetTurnCount?: number | null | undefined;
}): { targetTurnCount: number; numTurns: number } | null {
  const targetTurnCount =
    typeof input.mappedTargetTurnCount === "number"
      ? input.mappedTargetTurnCount
      : inferRevertTurnCountBeforeUserMessage(input.messages, input.targetMessageId);
  if (typeof targetTurnCount !== "number" || targetTurnCount < 0) {
    return null;
  }

  const currentTurnCount = estimateConversationTurnCountForRollback({
    messages: input.messages,
    turnDiffSummaries: input.turnDiffSummaries,
  });
  if (currentTurnCount <= targetTurnCount) {
    return null;
  }

  return {
    targetTurnCount,
    numTurns: currentTurnCount - targetTurnCount,
  };
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function resolveSendEnvMode(input: {
  requestedEnvMode: DraftThreadEnvMode;
  isGitRepo: boolean;
}): DraftThreadEnvMode {
  return input.isGitRepo ? input.requestedEnvMode : "local";
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl?.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 || options.imageCount > 0 || sendableTerminalContexts.length > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function threadHasStarted(thread: Thread | null | undefined): boolean {
  return Boolean(
    thread && (thread.latestTurn !== null || thread.messages.length > 0 || thread.session !== null),
  );
}

// `threadProvider` is the open branded driver kind carried by the session.
// Unknown driver kinds degrade to `null` (i.e. "unlocked"), which is the safe
// rollback / fork behavior — the routing layer is the right place to surface
// "driver not installed" errors, not the lock state.
//
// `selectedProvider` takes the same open-string shape because the composer
// now tracks the picker selection as a `ProviderInstanceId` (e.g.
// `codex_personal`). Custom instance ids that don't directly match a
// registered driver resolve to `null` here, which matches the existing
// "unknown driver -> unlocked" semantics. Callers that want the lock to track
// a custom instance's underlying driver kind should resolve the instance id
// upstream and pass the correlated kind.
export function deriveLockedProvider(input: {
  thread: Thread | null | undefined;
  selectedProvider: string | null;
  threadProvider: string | null;
}): ProviderDriverKind | null {
  if (!threadHasStarted(input.thread)) {
    return null;
  }
  const sessionProvider = input.thread?.session?.provider ?? null;
  if (sessionProvider) {
    return sessionProvider;
  }
  const narrowedThreadProvider =
    input.threadProvider && isProviderDriverKind(input.threadProvider)
      ? input.threadProvider
      : null;
  const narrowedSelectedProvider =
    input.selectedProvider && isProviderDriverKind(input.selectedProvider)
      ? input.selectedProvider
      : null;
  return narrowedThreadProvider ?? narrowedSelectedProvider ?? null;
}

export async function waitForStartedServerThread(
  threadRef: ScopedThreadRef,
  timeoutMs = 1_000,
): Promise<boolean> {
  const getThread = () => selectThreadByRef(useStore.getState(), threadRef);
  const thread = getThread();

  if (threadHasStarted(thread)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = useStore.subscribe((state) => {
      if (!threadHasStarted(selectThreadByRef(state, threadRef))) {
        return;
      }
      finish(true);
    });

    if (threadHasStarted(getThread())) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export async function waitForThreadMessageRemoval(
  threadRef: ScopedThreadRef,
  messageId: MessageId,
  timeoutMs = 10_000,
): Promise<boolean> {
  const messageExists = () =>
    selectThreadByRef(useStore.getState(), threadRef)?.messages.some(
      (message) => message.id === messageId,
    ) === true;

  if (!messageExists()) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = useStore.subscribe((state) => {
      const stillExists =
        selectThreadByRef(state, threadRef)?.messages.some(
          (message) => message.id === messageId,
        ) === true;
      if (stillExists) {
        return;
      }
      finish(true);
    });

    if (!messageExists()) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export async function waitForThreadRevertedAfter(
  threadRef: ScopedThreadRef,
  baseline: {
    previousUpdatedAt: string;
    targetMessageId?: MessageId | undefined;
    targetTurnCount?: number | undefined;
  },
  timeoutMs = 30_000,
): Promise<boolean> {
  const didThreadAdvance = (thread: Thread) => {
    if (!thread.updatedAt) {
      return false;
    }
    return (
      thread.updatedAt !== baseline.previousUpdatedAt &&
      thread.updatedAt.localeCompare(baseline.previousUpdatedAt) >= 0
    );
  };

  const hasReverted = (thread: Thread | null | undefined) => {
    if (!thread) {
      return false;
    }
    if (baseline.targetTurnCount !== undefined) {
      return (
        didThreadAdvance(thread) &&
        estimateConversationTurnCountForRollback({
          messages: thread.messages,
          turnDiffSummaries: thread.turnDiffSummaries,
        }) <= baseline.targetTurnCount
      );
    }
    if (baseline.targetMessageId !== undefined) {
      return !thread.messages.some((message) => message.id === baseline.targetMessageId);
    }
    return didThreadAdvance(thread);
  };

  const getThread = () => selectThreadByRef(useStore.getState(), threadRef);
  if (hasReverted(getThread())) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = useStore.subscribe((state) => {
      if (!hasReverted(selectThreadByRef(state, threadRef))) {
        return;
      }
      finish(true);
    });

    if (hasReverted(getThread())) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionOrchestrationStatus: ThreadSession["orchestrationStatus"] | null;
  sessionUpdatedAt: string | null;
  threadError: string | null | undefined;
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: { preparingWorktree?: boolean },
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionOrchestrationStatus: session?.orchestrationStatus ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
    threadError: activeThread?.error,
  };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (
    input.hasPendingApproval ||
    input.hasPendingUserInput ||
    (Boolean(input.threadError) && input.threadError !== input.localDispatch.threadError)
  ) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);
  const orchestrationStatus = session?.orchestrationStatus ?? null;
  const orchestrationEnded =
    orchestrationStatus === "error" ||
    orchestrationStatus === "interrupted" ||
    orchestrationStatus === "stopped";

  if (!latestTurnChanged && !latestTurn && session !== null && !orchestrationEnded) {
    return false;
  }

  // 编辑最后一条用户消息会先回退旧 turn，再启动新 turn。回退事件会把
  // latestTurn 清空；这只是重试的中间态，不应结束本地发送态，否则对话页
  // 会短暂满足“空的新会话”条件并跳回首页。
  if (latestTurnChanged && latestTurn === null && input.localDispatch.latestTurnTurnId !== null) {
    if (!orchestrationEnded) {
      return false;
    }
  }

  if (
    !latestTurnChanged &&
    input.localDispatch.latestTurnTurnId === null &&
    latestTurn === null &&
    session !== null &&
    input.localDispatch.sessionUpdatedAt !== (session.updatedAt ?? null) &&
    !orchestrationEnded
  ) {
    return false;
  }

  if (input.phase === "running") {
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn?.startedAt === null || latestTurn === null) {
      return false;
    }
    if (
      session?.activeTurnId !== undefined &&
      session.activeTurnId !== null &&
      latestTurn?.turnId !== session.activeTurnId
    ) {
      return false;
    }
    return true;
  }

  // 只要这一轮 turn 已经被服务端确认但还没结束，本地发送态就继续托底。
  // 否则 session 在 starting/connecting/running 等中间态切换时会让“正在思考”
  // 短暂消失，再由后续 running 事件显示第二次。
  if (latestTurnChanged && latestTurn && latestTurn.completedAt == null) {
    if (!orchestrationEnded) {
      return false;
    }
  }

  return (
    latestTurnChanged ||
    input.localDispatch.sessionOrchestrationStatus !== (session?.orchestrationStatus ?? null) ||
    input.localDispatch.sessionUpdatedAt !== (session?.updatedAt ?? null)
  );
}
