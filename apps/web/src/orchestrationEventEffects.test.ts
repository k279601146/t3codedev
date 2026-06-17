import {
  CheckpointRef,
  type EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "./types";
import {
  deriveOrchestrationBatchEffects,
  deriveThreadCompletionNotificationCandidates,
  shouldShowBrowserThreadCompletionNotification,
  showThreadCompletionNotifications,
} from "./orchestrationEventEffects";

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {},
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1;
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId:
      "threadId" in payload
        ? payload.threadId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.make("project-1"),
    occurredAt: "2026-02-27T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>;
}

describe("deriveOrchestrationBatchEffects", () => {
  it("targets draft promotion and terminal cleanup from thread lifecycle events", () => {
    const createdThreadId = ThreadId.make("thread-created");
    const deletedThreadId = ThreadId.make("thread-deleted");
    const archivedThreadId = ThreadId.make("thread-archived");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.created", {
        threadId: createdThreadId,
        projectId: ProjectId.make("project-1"),
        title: "Created thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
      }),
      makeEvent("thread.deleted", {
        threadId: deletedThreadId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("thread.archived", {
        threadId: archivedThreadId,
        archivedAt: "2026-02-27T00:00:02.000Z",
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    expect(effects.promoteDraftThreadIds).toEqual([createdThreadId]);
    expect(effects.clearDeletedThreadIds).toEqual([deletedThreadId]);
    expect(effects.removeTerminalStateThreadIds).toEqual([deletedThreadId, archivedThreadId]);
    expect(effects.needsProviderInvalidation).toBe(false);
  });

  it("keeps only the final lifecycle outcome for a thread within one batch", () => {
    const threadId = ThreadId.make("thread-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.deleted", {
        threadId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("thread.created", {
        threadId,
        projectId: ProjectId.make("project-1"),
        title: "Recreated thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:02.000Z",
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
      makeEvent("thread.turn-diff-completed", {
        threadId,
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.make("assistant-1"),
        completedAt: "2026-02-27T00:00:03.000Z",
      }),
    ]);

    expect(effects.promoteDraftThreadIds).toEqual([threadId]);
    expect(effects.clearDeletedThreadIds).toEqual([]);
    expect(effects.removeTerminalStateThreadIds).toEqual([]);
    expect(effects.needsProviderInvalidation).toBe(true);
  });

  it("does not retain archive cleanup when a thread is unarchived later in the same batch", () => {
    const threadId = ThreadId.make("thread-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.archived", {
        threadId,
        archivedAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("thread.unarchived", {
        threadId,
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    expect(effects.promoteDraftThreadIds).toEqual([]);
    expect(effects.clearDeletedThreadIds).toEqual([]);
    expect(effects.removeTerminalStateThreadIds).toEqual([]);
  });
});

describe("deriveThreadCompletionNotificationCandidates", () => {
  it("生成后台完成通知候选，并使用助手回复作为摘要", () => {
    const threadId = ThreadId.make("thread-1");
    const turnId = TurnId.make("turn-1");
    const event = makeEvent("thread.turn-diff-completed", {
      threadId,
      turnId,
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("checkpoint-1"),
      status: "ready",
      files: [],
      assistantMessageId: MessageId.make("assistant-1"),
      completedAt: "2026-02-27T00:00:03.000Z",
    });

    const candidates = deriveThreadCompletionNotificationCandidates({
      events: [event],
      resolveThread: () =>
        makeThread({
          id: threadId,
          title: "修复通知",
          messages: [
            {
              id: MessageId.make("assistant-1"),
              role: "assistant",
              text: "已经修复后台完成提示。",
              turnId,
              createdAt: "2026-02-27T00:00:02.000Z",
              streaming: false,
            },
          ],
        }),
    });

    expect(candidates).toEqual([
      {
        threadId,
        turnId,
        title: "修复通知",
        body: "已经修复后台完成提示。",
      },
    ]);
  });

  it("忽略未完成、缺失或已归档线程，并在同批次内按回合去重", () => {
    const threadId = ThreadId.make("thread-1");
    const turnId = TurnId.make("turn-1");
    const readyEvent = makeEvent("thread.turn-diff-completed", {
      threadId,
      turnId,
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("checkpoint-1"),
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: "2026-02-27T00:00:03.000Z",
    });
    const missingEvent = makeEvent("thread.turn-diff-completed", {
      threadId: ThreadId.make("thread-2"),
      turnId: TurnId.make("turn-2"),
      checkpointTurnCount: 2,
      checkpointRef: CheckpointRef.make("checkpoint-2"),
      status: "missing",
      files: [],
      assistantMessageId: null,
      completedAt: "2026-02-27T00:00:04.000Z",
    });

    const candidates = deriveThreadCompletionNotificationCandidates({
      events: [readyEvent, missingEvent, readyEvent],
      resolveThread: (id) =>
        id === threadId
          ? makeThread({
              id: threadId,
              title: "完成回合",
              messages: [],
            })
          : makeThread({
              id,
              title: "缺失回合",
              archivedAt: "2026-02-27T00:00:05.000Z",
              messages: [],
            }),
    });

    expect(candidates).toEqual([
      {
        threadId,
        turnId,
        title: "完成回合",
        body: "对话已完成。",
      },
    ]);
  });
});

describe("shouldShowBrowserThreadCompletionNotification", () => {
  it("只有已授权且页面不在前台时才显示通知", () => {
    expect(
      shouldShowBrowserThreadCompletionNotification({
        documentVisibilityState: "hidden",
        documentHasFocus: false,
        notificationPermission: "granted",
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserThreadCompletionNotification({
        documentVisibilityState: "visible",
        documentHasFocus: true,
        notificationPermission: "granted",
      }),
    ).toBe(false);
    expect(
      shouldShowBrowserThreadCompletionNotification({
        documentVisibilityState: "hidden",
        documentHasFocus: false,
        notificationPermission: "default",
      }),
    ).toBe(false);
  });
});

describe("showThreadCompletionNotifications", () => {
  it("桌面桥存在时优先调用原生通知", () => {
    const showNotification = vi.fn();
    const browserWindow = {
      desktopBridge: {
        showNotification,
      },
      Notification: undefined,
      document: {
        visibilityState: "hidden",
        hasFocus: () => false,
      },
    } as unknown as Window & typeof globalThis;

    showThreadCompletionNotifications(
      [
        {
          threadId: ThreadId.make("thread-1"),
          turnId: "turn-1",
          title: "后台任务",
          body: "任务已完成。",
        },
      ],
      browserWindow,
    );

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith({
      title: "后台任务",
      body: "任务已完成。",
      tag: "thread-completed:thread-1:turn-1",
    });
  });

  it("没有桌面桥时回退到浏览器 Notification API", () => {
    const created: Array<{ title: string; options: NotificationOptions | undefined }> = [];
    const NotificationMock = vi.fn(function Notification(
      this: Notification,
      title: string,
      options?: NotificationOptions,
    ) {
      created.push({ title, options });
      return { onclick: null };
    }) as unknown as typeof Notification;
    Object.defineProperty(NotificationMock, "permission", {
      value: "granted",
    });
    const browserWindow = {
      Notification: NotificationMock,
      document: {
        visibilityState: "hidden",
        hasFocus: () => false,
      },
      focus: vi.fn(),
    } as unknown as Window & typeof globalThis;

    showThreadCompletionNotifications(
      [
        {
          threadId: ThreadId.make("thread-1"),
          turnId: "turn-1",
          title: "后台任务",
          body: "任务已完成。",
        },
      ],
      browserWindow,
    );

    expect(NotificationMock).toHaveBeenCalledTimes(1);
    expect(created).toEqual([
      {
        title: "后台任务",
        options: {
          body: "任务已完成。",
          tag: "thread-completed:thread-1:turn-1",
          silent: false,
        },
      },
    ]);
  });
});

function makeThread(
  input: Pick<Thread, "id" | "title" | "messages"> & Partial<Thread>,
): Thread {
  return {
    ...input,
    id: input.id,
    environmentId: "env-primary" as EnvironmentId,
    codexThreadId: null,
    projectId: ProjectId.make("project-1"),
    title: input.title,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: input.messages,
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    archivedAt: input.archivedAt ?? null,
    updatedAt: "2026-02-27T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}
