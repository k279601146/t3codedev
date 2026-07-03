import {
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveCompletionDividerBeforeEntryId,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
} from "./session-logic";

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
  turnId?: string;
  itemId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  const payload = overrides.payload ?? {};
  return {
    id: EventId.make(overrides.id ?? crypto.randomUUID()),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload,
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    ...(overrides.itemId ? { itemId: overrides.itemId } : {}),
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("derivePendingApprovals", () => {
  it("tracks open approvals and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-1",
          requestKind: "command",
          detail: "bun run lint",
        },
      }),
      makeActivity({
        id: "approval-close",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "approval.resolved",
        summary: "Approval resolved",
        tone: "info",
        payload: { requestId: "req-2" },
      }),
      makeActivity({
        id: "approval-closed-request",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "approval.requested",
        summary: "File-change approval requested",
        tone: "approval",
        payload: { requestId: "req-2", requestKind: "file-change" },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-1",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "bun run lint",
      },
    ]);
  });

  it("maps canonical requestType payloads into pending approvals", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-request-type",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-request-type",
          requestType: "command_execution_approval",
          detail: "pwd",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-request-type",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "pwd",
      },
    ]);
  });

  it("clears stale pending approvals when provider reports unknown pending request", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-stale",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-stale-1",
          requestKind: "command",
        },
      }),
      makeActivity({
        id: "approval-failed-stale",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        tone: "error",
        payload: {
          requestId: "req-stale-1",
          detail: "Unknown pending permission request: req-stale-1",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });

  it("clears stale pending approvals when the backend marks them stale after restart", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-stale-restart",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-stale-restart-1",
          requestKind: "command",
        },
      }),
      makeActivity({
        id: "approval-failed-stale-restart",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        tone: "error",
        payload: {
          requestId: "req-stale-restart-1",
          detail:
            "Stale pending approval request: req-stale-restart-1. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });
});

describe("derivePendingUserInputs", () => {
  it("tracks open structured prompts and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-1",
          questions: [
            {
              id: "sandbox_mode",
              header: "Sandbox",
              question: "Which mode should be used?",
              options: [
                {
                  label: "workspace-write",
                  description: "Allow workspace writes only",
                },
              ],
              multiSelect: true,
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-resolved",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "user-input.resolved",
        summary: "User input submitted",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          answers: {
            sandbox_mode: "workspace-write",
          },
        },
      }),
      makeActivity({
        id: "user-input-open-2",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          questions: [
            {
              id: "approval",
              header: "Approval",
              question: "Continue?",
              options: [
                {
                  label: "yes",
                  description: "Continue execution",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([
      {
        requestId: "req-user-input-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow workspace writes only",
              },
            ],
            multiSelect: true,
          },
        ],
      },
    ]);
  });

  it("clears stale pending user-input prompts when the provider reports an orphaned request", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open-stale",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-stale-1",
          questions: [
            {
              id: "sandbox_mode",
              header: "Sandbox",
              question: "Which mode should be used?",
              options: [
                {
                  label: "workspace-write",
                  description: "Allow workspace writes only",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-failed-stale",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.user-input.respond.failed",
        summary: "Provider user input response failed",
        tone: "error",
        payload: {
          requestId: "req-user-input-stale-1",
          detail:
            "Stale pending user-input request: req-user-input-stale-1. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.",
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([]);
  });
});

describe("deriveActivePlanState", () => {
  it("returns the latest plan update for the active turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-old",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Initial plan",
          plan: [{ step: "Inspect code", status: "pending" }],
        },
      }),
      makeActivity({
        id: "plan-latest",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Refined plan",
          plan: [{ step: "Implement Codex user input", status: "inProgress" }],
        },
      }),
    ];

    expect(deriveActivePlanState(activities, TurnId.make("turn-1"))).toEqual({
      createdAt: "2026-02-23T00:00:02.000Z",
      turnId: "turn-1",
      explanation: "Refined plan",
      steps: [{ step: "Implement Codex user input", status: "inProgress" }],
    });
  });

  it("falls back to the most recent plan from a previous turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-from-turn-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [{ step: "Write tests", status: "completed" }],
        },
      }),
    ];

    // Current turn is turn-2, which has no plan activity — should fall back to turn-1's plan
    const result = deriveActivePlanState(activities, TurnId.make("turn-2"));
    expect(result).toEqual({
      createdAt: "2026-02-23T00:00:01.000Z",
      turnId: "turn-1",
      steps: [{ step: "Write tests", status: "completed" }],
    });
  });
});

describe("findLatestProposedPlan", () => {
  it("prefers the latest proposed plan for the active turn", () => {
    expect(
      findLatestProposedPlan(
        [
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "# Older",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:01.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "# Latest",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:02.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-2",
            turnId: TurnId.make("turn-2"),
            planMarkdown: "# Different turn",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:03.000Z",
            updatedAt: "2026-02-23T00:00:03.000Z",
          },
        ],
        TurnId.make("turn-1"),
      ),
    ).toEqual({
      id: "plan:thread-1:turn:turn-1",
      turnId: "turn-1",
      planMarkdown: "# Latest",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the most recently updated proposed plan", () => {
    const latestPlan = findLatestProposedPlan(
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.make("turn-1"),
          planMarkdown: "# First",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:01.000Z",
          updatedAt: "2026-02-23T00:00:01.000Z",
        },
        {
          id: "plan:thread-1:turn:turn-2",
          turnId: TurnId.make("turn-2"),
          planMarkdown: "# Latest",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:03.000Z",
        },
      ],
      null,
    );

    expect(latestPlan?.planMarkdown).toBe("# Latest");
  });
});

describe("hasActionableProposedPlan", () => {
  it("returns true for an unimplemented proposed plan", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.make("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:01.000Z",
      }),
    ).toBe(true);
  });

  it("returns false for a proposed plan already implemented elsewhere", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.make("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: "2026-02-23T00:00:02.000Z",
        implementationThreadId: ThreadId.make("thread-implement"),
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:02.000Z",
      }),
    ).toBe(false);
  });
});

describe("findSidebarProposedPlan", () => {
  it("prefers the running turn source proposed plan when available on the same thread", () => {
    expect(
      findSidebarProposedPlan({
        threads: [
          {
            id: ThreadId.make("thread-1"),
            proposedPlans: [
              {
                id: "plan-1",
                turnId: TurnId.make("turn-plan"),
                planMarkdown: "# Source plan",
                implementedAt: "2026-02-23T00:00:03.000Z",
                implementationThreadId: ThreadId.make("thread-2"),
                createdAt: "2026-02-23T00:00:01.000Z",
                updatedAt: "2026-02-23T00:00:02.000Z",
              },
            ],
          },
          {
            id: ThreadId.make("thread-2"),
            proposedPlans: [
              {
                id: "plan-2",
                turnId: TurnId.make("turn-other"),
                planMarkdown: "# Latest elsewhere",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:04.000Z",
                updatedAt: "2026-02-23T00:00:05.000Z",
              },
            ],
          },
        ],
        latestTurn: {
          turnId: TurnId.make("turn-implementation"),
          sourceProposedPlan: {
            threadId: ThreadId.make("thread-1"),
            planId: "plan-1",
          },
        },
        latestTurnSettled: false,
        threadId: ThreadId.make("thread-1"),
      }),
    ).toEqual({
      id: "plan-1",
      turnId: "turn-plan",
      planMarkdown: "# Source plan",
      implementedAt: "2026-02-23T00:00:03.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the latest proposed plan once the turn is settled", () => {
    expect(
      findSidebarProposedPlan({
        threads: [
          {
            id: ThreadId.make("thread-1"),
            proposedPlans: [
              {
                id: "plan-1",
                turnId: TurnId.make("turn-plan"),
                planMarkdown: "# Older",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:01.000Z",
                updatedAt: "2026-02-23T00:00:02.000Z",
              },
              {
                id: "plan-2",
                turnId: TurnId.make("turn-latest"),
                planMarkdown: "# Latest",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:03.000Z",
                updatedAt: "2026-02-23T00:00:04.000Z",
              },
            ],
          },
        ],
        latestTurn: {
          turnId: TurnId.make("turn-implementation"),
          sourceProposedPlan: {
            threadId: ThreadId.make("thread-1"),
            planId: "plan-1",
          },
        },
        latestTurnSettled: true,
        threadId: ThreadId.make("thread-1"),
      })?.planMarkdown,
    ).toBe("# Latest");
  });
});

describe("deriveWorkLogEntries", () => {
  it("omits tool started entries and keeps completed entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "tool-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Tool call",
        kind: "tool.started",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("keeps image-generation started entries so the shimmer appears immediately", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "image-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Image view started",
        kind: "tool.started",
        payload: {
          itemType: "image_view",
          data: {
            item: {
              id: "ig_1",
              result: "",
              status: "in_progress",
              type: "imageGeneration",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toMatchObject([
      {
        id: "image-start",
        itemType: "image_view",
        status: "running",
        generatedImage: {
          status: "in_progress",
        },
      },
    ]);
  });

  it("detects raw Codex imageGeneration started payloads without a precomputed itemType", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "raw-image-start",
        itemId: "ig_1",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Image view started",
        kind: "tool.started",
        payload: {
          itemId: "ig_1",
          data: {
            item: {
              id: "ig_1",
              result: "",
              revisedPrompt: null,
              status: "in_progress",
              type: "imageGeneration",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toMatchObject([
      {
        id: "raw-image-start",
        itemType: "image_view",
        status: "running",
        generatedImage: {
          id: "ig_1",
          status: "in_progress",
          type: "imageGeneration",
        },
      },
    ]);
  });

  it("uses ig-prefixed item ids as a fast image-generation signal", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "ig-prefix-start",
        itemId: "ig_1",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Image view started",
        kind: "tool.started",
        payload: {
          itemId: "ig_1",
          data: {
            item: {
              id: "ig_1",
              result: "",
              status: "in_progress",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries[0]).toMatchObject({
      itemType: "image_view",
      status: "running",
      generatedImage: {
        id: "ig_1",
        status: "in_progress",
      },
    });
  });

  it("collapses image-generation started and completed entries by provider item id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "image-start",
        itemId: "ig_1",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Image view started",
        kind: "tool.started",
        payload: {
          itemType: "image_view",
          itemId: "ig_1",
          data: {
            item: {
              id: "ig_1",
              result: "",
              status: "in_progress",
              type: "imageGeneration",
            },
          },
        },
      }),
      makeActivity({
        id: "image-complete",
        itemId: "ig_1",
        createdAt: "2026-02-23T00:00:03.000Z",
        summary: "Image view",
        kind: "tool.completed",
        payload: {
          itemType: "image_view",
          itemId: "ig_1",
          data: {
            item: {
              id: "ig_1",
              result: "a".repeat(512),
              status: "generating",
              type: "imageGeneration",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "image-complete",
      itemType: "image_view",
      status: "completed",
      generatedImage: {
        result: "a".repeat(512),
        status: "generating",
      },
    });
  });

  it("omits task.started but shows task.progress and task.completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "default task started",
        tone: "info",
      }),
      makeActivity({
        id: "task-progress",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Updating files",
        tone: "info",
      }),
      makeActivity({
        id: "task-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task completed",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["task-progress", "task-complete"]);
  });

  it("uses payload summary as label for task entries when available", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-progress-with-summary",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Reasoning update",
        tone: "info",
        payload: { summary: "Searching for API endpoints" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries[0]?.label).toBe("Searching for API endpoints");
  });

  it("uses payload detail as label for task.completed and preserves error tone", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-completed-failed",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task failed",
        tone: "error",
        payload: { detail: "Failed to deploy changes" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries[0]?.label).toBe("Failed to deploy changes");
    expect(entries[0]?.tone).toBe("error");
  });

  it("keeps historical turn work when a later turn becomes latest", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "turn-1",
        turnId: "turn-1",
        summary: "Ran previous command",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "turn-2",
        turnId: "turn-2",
        summary: "Ran latest command",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "no-turn",
        summary: "Runtime warning",
        kind: "runtime.warning",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, TurnId.make("turn-2"));
    expect(entries.map((entry) => entry.id)).toEqual(["turn-1", "turn-2"]);
  });

  it("omits checkpoint captured info entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "checkpoint",
        createdAt: "2026-02-23T00:00:01.000Z",
        summary: "Checkpoint captured",
        tone: "info",
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Ran command",
        tone: "tool",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("omits ExitPlanMode lifecycle entries once the plan card is shown", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "exit-plan-updated",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          detail: 'ExitPlanMode: {"allowedPrompts":[{"tool":"Bash","prompt":"run tests"}]}',
        },
      }),
      makeActivity({
        id: "exit-plan-completed",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          detail: "ExitPlanMode: {}",
        },
      }),
      makeActivity({
        id: "real-work-log",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail: "Bash: bun test",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["real-work-log"]);
  });

  it("orders work log by activity sequence when present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "second",
        createdAt: "2026-02-23T00:00:03.000Z",
        sequence: 2,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "first",
        createdAt: "2026-02-23T00:00:04.000Z",
        sequence: 1,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("extracts command text for command tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["bun", "run", "lint"],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("bun run lint");
  });

  it("unwraps PowerShell command wrappers for displayed command text", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("bun run lint");
    expect(entry?.rawCommand).toBe(
      "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
    );
  });

  it("unwraps PowerShell command wrappers from argv-style command payloads", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper-argv",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "-Command", "rg -n foo ."],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("rg -n foo .");
    expect(entry?.rawCommand).toBe(
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "rg -n foo ."',
    );
  });

  it("extracts command text from command detail when structured command metadata is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-detail-fallback",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail:
            '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command \'rg -n -F "new Date()" .\' <exited with exit code 0>',
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe('rg -n -F "new Date()" .');
    expect(entry?.rawCommand).toBe(
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command 'rg -n -F "new Date()" .'`,
    );
    expect(entry?.detail).toBeUndefined();
  });

  it("does not unwrap shell commands when no wrapper flag is present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-shell-script",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "bash script.sh",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("bash script.sh");
    expect(entry?.rawCommand).toBeUndefined();
  });

  it("keeps compact Codex tool metadata used for icons and labels", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-with-metadata",
        kind: "tool.completed",
        summary: "bash",
        payload: {
          itemType: "command_execution",
          title: "bash",
          status: "completed",
          detail: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
          data: {
            item: {
              command: ["bun", "run", "dev"],
              result: {
                content: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
                exitCode: 0,
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      command: "bun run dev",
      detail: '{ "dev": "vite dev --port 3000" }',
      itemType: "command_execution",
      toolTitle: "bash",
    });
  });

  it("extracts changed file paths for file-change tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "file-tool",
        kind: "tool.completed",
        summary: "File change",
        payload: {
          itemType: "file_change",
          data: {
            item: {
              changes: [
                { path: "apps/web/src/components/ChatView.tsx" },
                { filename: "apps/web/src/session-logic.ts" },
              ],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.changedFiles).toEqual([
      "apps/web/src/components/ChatView.tsx",
      "apps/web/src/session-logic.ts",
    ]);
  });

  it("treats PowerShell Out-File commands as file creation work", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-write-file",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail:
            '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Write-Output \'print(\\"你好\\")\' | Out-File -Encoding UTF8 hello.py"',
          data: {
            item: {
              command:
                '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Write-Output \'print(\\"你好\\")\' | Out-File -Encoding UTF8 hello.py"',
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.requestKind).toBe("file-change");
    expect(entry?.changedFiles).toEqual(["hello.py"]);
    expect(entry?.detail).toContain("--- /dev/null");
    expect(entry?.detail).toContain("+++ b/hello.py");
    expect(entry?.detail).toContain('+print("你好")');
  });

  it("extracts PowerShell Out-File targets after long here-strings", () => {
    const command =
      "\"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -Command \"@'\n# \u300a\u4e5e\u8ba8\u6b66\u6797\u300b\u521b\u4f5c\u63d0\u793a\u8bcd\n\n- **\u4e3b\u7c7b\u578b**\uff1a\u4f20\u7edf\u6b66\u4fa0\n'@ | Out-File -FilePath \\\"output/\u63d0\u793a\u8bcd.md\\\" -Encoding UTF8; Write-Output \\\"\u63d0\u793a\u8bcd\u5df2\u751f\u6210\\\"\"";
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-here-string-file",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command,
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.requestKind).toBe("file-change");
    expect(entry?.changedFiles).toEqual(["output/\u63d0\u793a\u8bcd.md"]);
    expect(entry?.detail).toContain("+++ b/output/\u63d0\u793a\u8bcd.md");
    expect(entry?.detail).toContain("+# \u300a\u4e5e\u8ba8\u6b66\u6797\u300b\u521b\u4f5c\u63d0\u793a\u8bcd");
  });

  it("treats PowerShell Set-Content commands as file edit work", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-edit-file",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command:
                '@"\nimport sys\nfrom datetime import datetime\nprint("你好")\n"@ | Set-Content -Path D:\\workspace\\testimg\\hello.py -Encoding UTF8',
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.requestKind).toBe("file-change");
    expect(entry?.changedFiles).toEqual(["D:\\workspace\\testimg\\hello.py"]);
    expect(entry?.detail).toContain("--- a/D:/workspace/testimg/hello.py");
    expect(entry?.detail).toContain("+++ b/D:/workspace/testimg/hello.py");
    expect(entry?.detail).toContain("+from datetime import datetime");
  });

  it("does not treat stderr redirection as file creation work", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-stderr-redirection",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command:
                'bun run lint 2>&1 | Select-String -Pattern "error|warning|successful|clean" -CaseSensitive:$false',
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.itemType).toBe("command_execution");
    expect(entry?.command).toContain('Select-String -Pattern "error|warning|successful|clean"');
    expect(entry?.changedFiles).toBeUndefined();
    expect(entry?.detail).toBeUndefined();
  });

  it("does not extract changed files from ordinary command output paths", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-path-output",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          requestKind: "command",
          data: {
            item: {
              command: 'Get-ChildItem "apps\\\\web\\\\src\\\\app\\\\[locale]\\\\workspace\\\\plugins"',
              result: {
                content:
                  "[locale]\\\\workspace\\\\plugins\\\\page.tsx\n[locale]\\\\workspace\\\\plugins\\\\[tab]\\\\page.tsx",
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.requestKind).toBe("command");
    expect(entry?.changedFiles).toBeUndefined();
  });

  it("drops runtime warning lines when the same command output already contains them", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: TurnId.make("turn-1"),
        payload: {
          itemType: "command_execution",
          requestKind: "command",
          data: {
            item: {
              command: "python -m pytest tests/test_connectors_api.py -x -q 2>&1 | Select-Object -Last 15",
              aggregatedOutput:
                "tests/test_connectors_api.py::test_approval_response\n" +
                "D:\\workspace\\dev2_OpenHarness_SaaS\\apps\\api\\connectors.py:239: DeprecationWarning: datetime.datetime.utcnow() is deprecated\n" +
                "5 passed, 9 warnings in 1.58s\n",
            },
          },
        },
      }),
      makeActivity({
        id: "runtime-warning-output",
        createdAt: "2026-01-01T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Output:",
        },
      }),
      makeActivity({
        id: "runtime-warning-pytest",
        createdAt: "2026-01-01T00:00:02.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "5 passed, 9 warnings in 1.58s",
        },
      }),
      makeActivity({
        id: "runtime-warning-deprecation",
        createdAt: "2026-01-01T00:00:03.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message:
            "D:\\workspace\\dev2_OpenHarness_SaaS\\apps\\api\\connectors.py:239: DeprecationWarning: datetime.datetime.utcnow() is deprecated",
        },
      }),
      makeActivity({
        id: "runtime-warning-exit",
        createdAt: "2026-01-01T00:00:04.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "2026-06-19T10:33:42.475527Z ERROR codex_core::tools::router: error=Exit code: 1",
        },
      }),
      makeActivity({
        id: "runtime-warning-wall-time",
        createdAt: "2026-01-01T00:00:05.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Wall time: 7.4 seconds",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestKind: "command",
      itemType: "command_execution",
    });
    expect(entries[0]?.output).toContain("5 passed, 9 warnings in 1.58s");
  });

  it("drops command-summary runtime warnings that sit near a command entry even when not duplicated in output", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: TurnId.make("turn-1"),
        payload: {
          itemType: "command_execution",
          requestKind: "command",
          data: {
            item: {
              command: 'rg --type binary "pattern" src',
              aggregatedOutput: "rg: unrecognized file type: binary",
            },
          },
        },
      }),
      makeActivity({
        id: "runtime-warning-exit",
        createdAt: "2026-01-01T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "2026-06-19T10:22:36.787195Z ERROR codex_core::tools::router: error=Exit code: 1",
        },
      }),
      makeActivity({
        id: "runtime-warning-wall-time",
        createdAt: "2026-01-01T00:00:02.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Wall time: 4.2 seconds",
        },
      }),
      makeActivity({
        id: "runtime-warning-output",
        createdAt: "2026-01-01T00:00:03.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Output:",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.requestKind).toBe("command");
    expect(entries[0]?.label).toBe("Ran command");
  });

  it("drops standalone command exit and timeout summaries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "runtime-warning-exit-status",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "exit status 1",
        },
      }),
      makeActivity({
        id: "runtime-warning-timeout",
        createdAt: "2026-01-01T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "command timed out after 5273 milliseconds",
        },
      }),
    ];

    expect(deriveWorkLogEntries(activities, undefined)).toEqual([]);
  });

  it("drops legacy PowerShell stderr fragments that belong to nearby command output", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: TurnId.make("turn-1"),
        payload: {
          itemType: "command_execution",
          requestKind: "command",
          data: {
            item: {
              command:
                'bun run lint 2>&1 | Select-String -Pattern "error|warning|successful|clean"',
              aggregatedOutput:
                "Select-String : The input object cannot be bound to any parameters for the command either because the command does not\n" +
                "take pipeline input or the input and its properties do not match any of the parameters that take pipeline input.\n" +
                "At line:2 char:34\n" +
                "+ ... lint 2>&1 | Select-String -Pattern \"error|warning|successful|clean\" - ...\n" +
                "+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n" +
                "+ CategoryInfo          : InvalidArgument: (> eslint .:PSObject) [Select-String], ParameterBindingException\n" +
                "+ FullyQualifiedErrorId : InputObjectNotBound,Microsoft.PowerShell.Commands.SelectStringCommand\n",
            },
          },
        },
      }),
      makeActivity({
        id: "runtime-warning-exit",
        createdAt: "2026-01-01T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "2026-06-19T10:33:08.393688Z ERROR codex_core::tools::router: error=Exit code: 1",
        },
      }),
      makeActivity({
        id: "runtime-warning-wall-time",
        createdAt: "2026-01-01T00:00:02.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Wall time: 28.6 seconds",
        },
      }),
      makeActivity({
        id: "runtime-warning-total-lines",
        createdAt: "2026-01-01T00:00:03.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Total output lines: 1625",
        },
      }),
      makeActivity({
        id: "runtime-warning-output",
        createdAt: "2026-01-01T00:00:04.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Output:",
        },
      }),
      makeActivity({
        id: "runtime-warning-select-string",
        createdAt: "2026-01-01T00:00:05.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message:
            "Select-String : The input object cannot be bound to any parameters for the command either because the command does not",
        },
      }),
      makeActivity({
        id: "runtime-warning-at-line",
        createdAt: "2026-01-01T00:00:06.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "At line:2 char:34",
        },
      }),
      makeActivity({
        id: "runtime-warning-binding",
        createdAt: "2026-01-01T00:00:07.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message:
            "+ CategoryInfo          : InvalidArgument: (> eslint .:PSObject) [Select-String], ParameterBindingException",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.requestKind).toBe("command");
    expect(entries[0]?.output).toContain("At line:2 char:34");
    expect(entries[0]?.output).toContain("FullyQualifiedErrorId");
  });

  it("drops Chinese PowerShell stderr fragments that belong to nearby command output", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: TurnId.make("turn-1"),
        payload: {
          itemType: "command_execution",
          requestKind: "command",
          data: {
            item: {
              command: "$wc.DownloadData('https://api.skillhub.cn/api/skills')",
              aggregatedOutput:
                "使用“1”个参数调用“DownloadData”时发生异常:“基础连接已经关闭: 接收时发生错误。”\n" +
                "所在位置 行:2 字符: 253\n",
            },
          },
        },
      }),
      makeActivity({
        id: "runtime-warning-download",
        createdAt: "2026-01-01T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message:
            "使用“1”个参数调用“DownloadData”时发生异常:“基础连接已经关闭: 接收时发生错误。”",
        },
      }),
      makeActivity({
        id: "runtime-warning-location",
        createdAt: "2026-01-01T00:00:02.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "所在位置 行:2 字符: 253。",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.requestKind).toBe("command");
    expect(entries[0]?.label).toBe("Ran command");
  });

  it("drops Select-String output fragments split into runtime warnings", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: TurnId.make("turn-1"),
        payload: {
          itemType: "command_execution",
          requestKind: "command",
          data: {
            item: {
              command:
                'Select-String -LiteralPath "D:\\workspace\\dev2_OpenHarness_SaaS\\apps\\api\\connectors.py" -Pattern "trigger" -Context 2,20',
              aggregatedOutput:
                "apps\\api\\api.log:52:INFO: 127.0.0.1:5758 - \"GET /api/v1/connectors/apps HTTP/1.1\" 200 OK\n" +
                "> apps\\api\\connectors.py:279:@connectors_router.patch(\"/triggers/{trigger_id}\")\n" +
                "D:\\workspace\\dev2_OpenHarness_SaaS\\apps\\api\\.pytest_cache' is denied.",
            },
          },
        },
      }),
      makeActivity({
        id: "runtime-warning-exit",
        createdAt: "2026-01-01T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "2026-06-19T12:07:47.681Z ERROR codex_core::tools::router: error=Exit code: 1",
        },
      }),
      makeActivity({
        id: "runtime-warning-wall-time",
        createdAt: "2026-01-01T00:00:02.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Wall time: 8.8 seconds",
        },
      }),
      makeActivity({
        id: "runtime-warning-total-lines",
        createdAt: "2026-01-01T00:00:03.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Total output lines: 140",
        },
      }),
      makeActivity({
        id: "runtime-warning-output",
        createdAt: "2026-01-01T00:00:04.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "Output:",
        },
      }),
      makeActivity({
        id: "runtime-warning-log-line",
        createdAt: "2026-01-01T00:00:05.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message:
            'apps\\api\\api.log:52:INFO: 127.0.0.1:5758 - "GET /api/v1/connectors/apps HTTP/1.1" 200 OK',
        },
      }),
      makeActivity({
        id: "runtime-warning-code-line",
        createdAt: "2026-01-01T00:00:06.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: '> apps\\api\\connectors.py:279:@connectors_router.patch("/triggers/{trigger_id}")',
        },
      }),
      makeActivity({
        id: "runtime-warning-denied",
        createdAt: "2026-01-01T00:00:07.000Z",
        kind: "runtime.warning",
        summary: "Runtime warning",
        turnId: TurnId.make("turn-1"),
        payload: {
          message: "D:\\workspace\\dev2_OpenHarness_SaaS\\apps\\api\\.pytest_cache' is denied.",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.requestKind).toBe("command");
    expect(entries[0]?.label).toBe("Ran command");
  });

  it("drops duplicated tool detail when it only repeats the title", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "read-file-generic",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.toolTitle).toBe("Read File");
    expect(entry?.detail).toBeUndefined();
  });

  it("uses grep raw output summaries instead of repeating the generic tool label", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "grep-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "grep",
        payload: {
          itemType: "web_search",
          title: "grep",
          detail: "grep",
          data: {
            toolCallId: "tool-grep-1",
            kind: "search",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "grep-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "grep",
        payload: {
          itemType: "web_search",
          title: "grep",
          detail: "grep",
          data: {
            toolCallId: "tool-grep-1",
            kind: "search",
            rawOutput: {
              totalFiles: 19,
              truncated: false,
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "grep-complete",
      toolTitle: "grep",
      detail: "19 files",
      itemType: "web_search",
    });
  });

  it("uses completed read-file output previews and still collapses the same tool call", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "read-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-1",
            kind: "read",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "read-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-1",
            kind: "read",
            rawOutput: {
              content:
                'import * as Effect from "effect/Effect"\nimport * as Layer from "effect/Layer"\n',
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "read-complete",
      toolTitle: "Read File",
      detail: 'import * as Effect from "effect/Effect"',
      itemType: "dynamic_tool_call",
    });
  });

  it("uses structured dynamic tool presentation for browser and computer tools", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "browser-click-complete",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          data: {
            item: {
              id: "tool-browser-1",
              type: "dynamicToolCall",
              namespace: "t3_browser",
              tool: "browser_click",
              arguments: {
                selector: "button[aria-label='注册']",
              },
              contentItems: [{ type: "inputText", text: "Clicked button[aria-label='注册']" }],
            },
          },
        },
      }),
      makeActivity({
        id: "computer-screenshot-complete",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          data: {
            item: {
              id: "tool-computer-1",
              type: "dynamicToolCall",
              namespace: "t3_computer",
              tool: "computer_screenshot",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries[0]).toMatchObject({
      toolTitle: "浏览器点击元素",
      toolFamily: "browser",
      detail: "参数: selector: button[aria-label='注册']\n输出: Clicked button[aria-label='注册']",
    });
    expect(entries[1]).toMatchObject({
      toolTitle: "电脑控制截图",
      toolFamily: "computer",
    });
  });

  it("derives transparent presentation for generic MCP tools without backend metadata", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "mcp-tool-complete",
        kind: "tool.completed",
        summary: "MCP tool call",
        payload: {
          itemType: "mcp_tool_call",
          title: "MCP tool call",
          data: {
            toolCallId: "tool-mcp-1",
            tool: "github_create_issue",
            rawInput: {
              path: "apps/web/src/Register.tsx",
              title: "修复注册入口",
            },
            rawOutput: {
              stdout: "created issue #42\nhttps://example.test/issues/42",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      toolTitle: "MCP github create issue",
      toolFamily: "mcp",
      detail:
        "参数: path: apps/web/src/Register.tsx\n输出: created issue #42\nhttps://example.test/issues/42",
      itemType: "mcp_tool_call",
    });
  });

  it("does not use command stdout as the detail when Cursor omits the command input", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "cursor-command-complete",
        createdAt: "2026-04-16T22:40:42.221Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          data: {
            toolCallId: "toolu_vrtx_01WypXgRM8PPygBtrVAZwzy5",
            kind: "execute",
            rawInput: {},
            rawOutput: {
              exitCode: 0,
              stdout: "total 960\napps\npackages\n",
              stderr: "",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      id: "cursor-command-complete",
      label: "Ran command",
      itemType: "command_execution",
      toolTitle: "Ran command",
    });
    expect(entry?.detail).toBeUndefined();
    expect(entry?.command).toBeUndefined();
    expect(entry?.output).toBe("total 960\napps\npackages");
  });

  it("uses Codex command aggregated output as the expandable command detail", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "codex-command-complete",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          detail: "bun test",
          data: {
            item: {
              id: "cmd_1",
              type: "commandExecution",
              command: "bun test",
              aggregatedOutput: "ok\n1 pass",
              status: "completed",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      command: "bun test",
      detail: "ok",
      output: "ok\n1 pass",
      itemType: "command_execution",
      toolTitle: "Ran command",
      toolFamily: "command",
    });
  });

  it("combines command stdout and stderr into the preserved output", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-complete-with-streams",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          data: {
            item: {
              id: "cmd_2",
              type: "commandExecution",
              command: "bun tsc --noEmit",
              result: {
                stdout: "checked 12 files",
                stderr: "error TS2345: mismatch",
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      command: "bun tsc --noEmit",
      output: "checked 12 files\nerror TS2345: mismatch",
    });
  });

  it("collapses legacy completed tool rows that are missing tool metadata", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "legacy-read-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-legacy",
            kind: "read",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "legacy-read-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "legacy-read-complete",
      toolTitle: "Read File",
      itemType: "dynamic_tool_call",
    });
    expect(entries[0]?.detail).toBeUndefined();
  });

  it("derives Codex web-search detail from query and action url", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "web-search-complete",
        kind: "tool.completed",
        summary: "Web search",
        payload: {
          itemType: "web_search",
          title: "Web search",
          data: {
            item: {
              id: "ws_1",
              type: "webSearch",
              query: "Codex plugins .codex-plugin plugin.json skills",
              action: {
                type: "search",
                query: "Codex plugins .codex-plugin plugin.json skills",
              },
            },
          },
        },
      }),
      makeActivity({
        id: "web-open-complete",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.completed",
        summary: "Web search",
        payload: {
          itemType: "web_search",
          title: "Web search",
          data: {
            item: {
              id: "ws_2",
              type: "webSearch",
              query: "",
              action: {
                type: "openPage",
                url: "https://developers.openai.com/codex/app-server",
              },
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toMatchObject([
      {
        id: "web-search-complete",
        itemType: "web_search",
        toolFamily: "search",
        detail: "Codex plugins .codex-plugin plugin.json skills",
      },
      {
        id: "web-open-complete",
        itemType: "web_search",
        toolFamily: "search",
        detail: "https://developers.openai.com/codex/app-server",
      },
    ]);
  });

  it("collapses repeated lifecycle updates for the same tool call into one entry", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-update-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-update-2",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
          data: {
            item: {
              command: ["sed", "-n", "1,40p", "/tmp/app.ts"],
            },
          },
        },
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "tool-complete",
      createdAt: "2026-02-23T00:00:03.000Z",
      label: "Tool call completed",
      detail: 'Read: {"file_path":"/tmp/app.ts"}',
      command: "sed -n 1,40p /tmp/app.ts",
      itemType: "dynamic_tool_call",
      toolTitle: "Tool call",
    });
  });

  it("keeps separate tool entries when an identical call starts after the prior one completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-1-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-1-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-update",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries.map((entry) => entry.id)).toEqual(["tool-1-complete", "tool-2-complete"]);
  });

  it("collapses same-timestamp lifecycle rows even when completed sorts before updated by id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "z-update-earlier",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "a-complete-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "z-update-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("a-complete-same-timestamp");
  });
});

describe("deriveTimelineEntries", () => {
  it("includes proposed plans alongside messages and work entries in chronological order", () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "hello",
          createdAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
      ],
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.make("turn-1"),
          planMarkdown: "# Ship it",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:02.000Z",
        },
      ],
      [
        {
          id: "work-1",
          createdAt: "2026-02-23T00:00:03.000Z",
          label: "Ran tests",
          tone: "tool",
        },
      ],
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "proposed-plan", "work"]);
    expect(entries[1]).toMatchObject({
      kind: "proposed-plan",
      proposedPlan: {
        planMarkdown: "# Ship it",
        implementedAt: null,
        implementationThreadId: null,
      },
    });
  });

  it("sorts when an input group arrives out of chronological order", () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.make("message-late"),
          role: "assistant",
          text: "late",
          createdAt: "2026-02-23T00:00:03.000Z",
          streaming: false,
        },
        {
          id: MessageId.make("message-early"),
          role: "user",
          text: "early",
          createdAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
      ],
      [],
      [
        {
          id: "work-middle",
          createdAt: "2026-02-23T00:00:02.000Z",
          label: "Ran tests",
          tone: "tool",
        },
      ],
    );

    expect(entries.map((entry) => entry.id)).toEqual([
      "message-early",
      "work-middle",
      "message-late",
    ]);
  });

  it("anchors the completion divider to latestTurn.assistantMessageId before timestamp fallback", () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.make("assistant-earlier"),
          role: "assistant",
          text: "progress update",
          createdAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
        {
          id: MessageId.make("assistant-final"),
          role: "assistant",
          text: "final answer",
          createdAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
      ],
      [],
      [],
    );

    expect(
      deriveCompletionDividerBeforeEntryId(entries, {
        assistantMessageId: MessageId.make("assistant-final"),
        state: "completed",
        startedAt: "2026-02-23T00:00:00.000Z",
        completedAt: "2026-02-23T00:00:02.000Z",
      }),
    ).toBe("assistant-final");
  });

  it("falls back to the user message when an interrupted turn has no assistant response", () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.make("user-interrupted"),
          role: "user",
          text: "stop this",
          createdAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
      ],
      [],
      [],
    );

    expect(
      deriveCompletionDividerBeforeEntryId(entries, {
        assistantMessageId: null,
        state: "interrupted",
        startedAt: "2026-02-23T00:00:00.000Z",
        completedAt: "2026-02-23T00:00:05.000Z",
      }),
    ).toBe("user-interrupted");
  });
});

describe("deriveWorkLogEntries context window handling", () => {
  it("excludes context window updates from the work log", () => {
    const entries = deriveWorkLogEntries(
      [
        makeActivity({
          id: "context-1",
          turnId: "turn-1",
          kind: "context-window.updated",
          summary: "Context window updated",
          tone: "info",
        }),
        makeActivity({
          id: "tool-1",
          turnId: "turn-1",
          kind: "tool.completed",
          summary: "Ran command",
          tone: "tool",
        }),
      ],
      TurnId.make("turn-1"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Ran command");
  });

  it("keeps context compaction activities as normal work log entries", () => {
    const entries = deriveWorkLogEntries(
      [
        makeActivity({
          id: "compaction-1",
          turnId: "turn-1",
          kind: "context-compaction",
          summary: "Context compacted",
          tone: "info",
        }),
      ],
      TurnId.make("turn-1"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Context compacted");
  });
});

describe("hasToolActivityForTurn", () => {
  it("returns false when turn id is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "tool-1", turnId: "turn-1", kind: "tool.completed", tone: "tool" }),
    ];

    expect(hasToolActivityForTurn(activities, undefined)).toBe(false);
    expect(hasToolActivityForTurn(activities, null)).toBe(false);
  });

  it("returns true only for matching tool activity in the target turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "tool-1", turnId: "turn-1", kind: "tool.completed", tone: "tool" }),
      makeActivity({ id: "info-1", turnId: "turn-2", kind: "turn.completed", tone: "info" }),
    ];

    expect(hasToolActivityForTurn(activities, TurnId.make("turn-1"))).toBe(true);
    expect(hasToolActivityForTurn(activities, TurnId.make("turn-2"))).toBe(false);
  });
});

describe("isLatestTurnSettled", () => {
  const latestTurn = {
    turnId: TurnId.make("turn-1"),
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("returns false while the same turn is still active in a running session", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.make("turn-1"),
      }),
    ).toBe(false);
  });

  it("returns false while any turn is running to avoid stale latest-turn banners", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.make("turn-2"),
      }),
    ).toBe(false);
  });

  it("returns true once the session is no longer running that turn", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "ready",
        activeTurnId: undefined,
      }),
    ).toBe(true);
  });

  it("returns false when turn timestamps are incomplete", () => {
    expect(
      isLatestTurnSettled(
        {
          turnId: TurnId.make("turn-1"),
          startedAt: null,
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
      ),
    ).toBe(false);
  });
});

describe("deriveActiveWorkStartedAt", () => {
  const latestTurn = {
    turnId: TurnId.make("turn-1"),
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("prefers the in-flight turn start when the latest turn is not settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-1"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:10:00.000Z");
  });

  it("uses the new send start while the session is running a different turn", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("falls back to sendStartedAt once the latest turn is settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "ready",
          activeTurnId: undefined,
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("uses sendStartedAt for a fresh send after the prior turn completed", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          turnId: TurnId.make("turn-1"),
          startedAt: "2026-02-27T21:10:00.000Z",
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });
});
