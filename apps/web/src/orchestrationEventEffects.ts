import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import type { ChatMessage, Thread } from "./types";

export interface OrchestrationBatchEffects {
  promoteDraftThreadIds: ThreadId[];
  clearDeletedThreadIds: ThreadId[];
  removeTerminalStateThreadIds: ThreadId[];
  needsProviderInvalidation: boolean;
}

export interface ThreadCompletionNotificationCandidate {
  threadId: ThreadId;
  turnId: string;
  title: string;
  body: string;
}

const MAX_NOTIFICATION_BODY_LENGTH = 180;

export function deriveOrchestrationBatchEffects(
  events: readonly OrchestrationEvent[],
): OrchestrationBatchEffects {
  const threadLifecycleEffects = new Map<
    ThreadId,
    {
      clearPromotedDraft: boolean;
      clearDeletedThread: boolean;
      removeTerminalState: boolean;
    }
  >();
  let needsProviderInvalidation = false;

  for (const event of events) {
    switch (event.type) {
      case "thread.turn-diff-completed":
      case "thread.reverted": {
        needsProviderInvalidation = true;
        break;
      }

      case "thread.created": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: true,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      case "thread.deleted": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: true,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.archived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.unarchived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  const promoteDraftThreadIds: ThreadId[] = [];
  const clearDeletedThreadIds: ThreadId[] = [];
  const removeTerminalStateThreadIds: ThreadId[] = [];
  for (const [threadId, effect] of threadLifecycleEffects) {
    if (effect.clearPromotedDraft) {
      promoteDraftThreadIds.push(threadId);
    }
    if (effect.clearDeletedThread) {
      clearDeletedThreadIds.push(threadId);
    }
    if (effect.removeTerminalState) {
      removeTerminalStateThreadIds.push(threadId);
    }
  }

  return {
    promoteDraftThreadIds,
    clearDeletedThreadIds,
    removeTerminalStateThreadIds,
    needsProviderInvalidation,
  };
}

export function deriveThreadCompletionNotificationCandidates(input: {
  events: readonly OrchestrationEvent[];
  resolveThread: (threadId: ThreadId) => Thread | undefined;
}): ThreadCompletionNotificationCandidate[] {
  const candidates = new Map<string, ThreadCompletionNotificationCandidate>();

  for (const event of input.events) {
    if (event.type !== "thread.turn-diff-completed") {
      continue;
    }
    if (event.payload.status !== "ready") {
      continue;
    }

    const thread = input.resolveThread(event.payload.threadId);
    if (!thread || thread.archivedAt !== null) {
      continue;
    }

    const turnId = event.payload.turnId;
    const assistantMessage = findAssistantMessageForTurn(thread.messages, turnId);
    const body = normalizeNotificationBody(assistantMessage?.text) ?? "对话已完成。";
    const key = `${event.payload.threadId}:${turnId}`;
    candidates.set(key, {
      threadId: event.payload.threadId,
      turnId,
      title: normalizeNotificationTitle(thread.title),
      body,
    });
  }

  return [...candidates.values()];
}

export function shouldShowBrowserThreadCompletionNotification(input: {
  documentVisibilityState: DocumentVisibilityState | undefined;
  documentHasFocus: boolean;
  notificationPermission: NotificationPermission | undefined;
}): boolean {
  if (input.notificationPermission !== "granted") {
    return false;
  }

  return input.documentVisibilityState !== "visible" || !input.documentHasFocus;
}

export function showThreadCompletionNotifications(
  candidates: readonly ThreadCompletionNotificationCandidate[],
  browserWindow: Window & typeof globalThis,
): void {
  if (candidates.length === 0) {
    return;
  }

  const desktopBridge = browserWindow.desktopBridge;
  if (typeof desktopBridge?.showNotification === "function") {
    for (const candidate of candidates) {
      void desktopBridge.showNotification({
        title: candidate.title,
        body: candidate.body,
        tag: `thread-completed:${candidate.threadId}:${candidate.turnId}`,
      });
    }
    return;
  }

  if (typeof browserWindow.Notification !== "function") {
    return;
  }

  const notificationPermission = browserWindow.Notification.permission;
  const documentVisibilityState = browserWindow.document?.visibilityState;
  const documentHasFocus = browserWindow.document?.hasFocus?.() ?? true;
  if (
    !shouldShowBrowserThreadCompletionNotification({
      documentVisibilityState,
      documentHasFocus,
      notificationPermission,
    })
  ) {
    return;
  }

  for (const candidate of candidates) {
    const notification = new browserWindow.Notification(candidate.title, {
      body: candidate.body,
      tag: `thread-completed:${candidate.threadId}:${candidate.turnId}`,
      silent: false,
    });
    notification.onclick = () => {
      browserWindow.focus();
    };
  }
}

function findAssistantMessageForTurn(
  messages: readonly ChatMessage[],
  turnId: string,
): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role === "assistant" && message.turnId === turnId) {
      return message;
    }
  }
  return undefined;
}

function normalizeNotificationTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Bahew";
}

function normalizeNotificationBody(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }
  if (collapsed.length <= MAX_NOTIFICATION_BODY_LENGTH) {
    return collapsed;
  }

  return `${collapsed.slice(0, MAX_NOTIFICATION_BODY_LENGTH - 1).trimEnd()}…`;
}
