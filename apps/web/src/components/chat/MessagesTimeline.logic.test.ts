import { describe, expect, it } from "vitest";
import {
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  deriveTurnProcessCollapseState,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
} from "./MessagesTimeline.logic";

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        completedAt: "2026-01-01T00:00:10Z",
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous assistant completedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message without completedAt", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", createdAt: "2026-01-01T00:00:30Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      { id: "u2", role: "user", createdAt: "2026-01-01T00:01:00Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        completedAt: "2026-01-01T00:01:20Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s1", role: "system", createdAt: "2026-01-01T00:00:01Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it("returns enabled copy state for completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Ship it",
        streaming: false,
      }),
    ).toEqual({
      text: "Ship it",
      visible: true,
    });
  });

  it("hides copy while an assistant message is still streaming", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Still streaming",
        streaming: true,
      }),
    ).toEqual({
      text: "Still streaming",
      visible: false,
    });
  });

  it("hides copy for empty completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "   ",
        streaming: false,
      }),
    ).toEqual({
      text: null,
      visible: false,
    });
  });

  it("hides copy for non-terminal assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: false,
        text: "Interim thought",
        streaming: false,
      }),
    ).toEqual({
      text: "Interim thought",
      visible: false,
    });
  });
});

describe("deriveTurnProcessCollapseState", () => {
  it("does not hide a proposed plan behind the processed toggle", () => {
    const state = deriveTurnProcessCollapseState([
      {
        kind: "message",
        id: "row-user",
        createdAt: "2026-01-01T00:00:00Z",
        durationStart: "2026-01-01T00:00:00Z",
        showAssistantMeta: true,
        showCompletionDivider: false,
        completionSummary: null,
        showAssistantCopyButton: false,
        assistantCopyStreaming: false,
        showUrlPreviewCard: false,
        message: {
          id: "user-1" as never,
          role: "user",
          text: "Plan this",
          turnId: null,
          createdAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
      },
      {
        kind: "work",
        id: "row-work",
        createdAt: "2026-01-01T00:00:05Z",
        groupedEntries: [
          {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            label: "Reasoning",
            tone: "thinking",
            status: "completed",
          },
        ],
      },
      {
        kind: "proposed-plan",
        id: "row-plan",
        createdAt: "2026-01-01T00:00:10Z",
        proposedPlan: {
          id: "plan-1" as never,
          turnId: "turn-1" as never,
          planMarkdown: "# 方案",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-01-01T00:00:10Z",
          updatedAt: "2026-01-01T00:00:11Z",
        },
      },
      {
        kind: "message",
        id: "row-assistant",
        createdAt: "2026-01-01T00:00:12Z",
        durationStart: "2026-01-01T00:00:00Z",
        showAssistantMeta: true,
        showCompletionDivider: false,
        completionSummary: null,
        showAssistantCopyButton: true,
        assistantCopyStreaming: false,
        showUrlPreviewCard: false,
        message: {
          id: "assistant-1" as never,
          role: "assistant",
          text: "计划已生成。",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:12Z",
          completedAt: "2026-01-01T00:00:12Z",
          streaming: false,
        },
      },
    ]);

    expect(state.ownerAssistantMessageIdByRowId.get("row-work")).toBe("assistant-1");
    expect(state.ownerAssistantMessageIdByRowId.has("row-plan")).toBe(false);
    expect(state.ownerAssistantMessageIdByRowId.has("row-assistant")).toBe(false);
    expect(state.summaryButtonHostByRowId.get("row-work")).toBe("assistant-1");
    expect(state.elapsedByAssistantMessageId.get("assistant-1")).toBe("7.0s");
  });

  it("keeps generated images visible while collapsing the preceding process", () => {
    const state = deriveTurnProcessCollapseState([
      {
        kind: "message",
        id: "row-user",
        createdAt: "2026-01-01T00:00:00Z",
        durationStart: "2026-01-01T00:00:00Z",
        showAssistantMeta: true,
        showCompletionDivider: false,
        completionSummary: null,
        showAssistantCopyButton: false,
        assistantCopyStreaming: false,
        showUrlPreviewCard: false,
        message: {
          id: "user-1" as never,
          role: "user",
          text: "Generate an image",
          turnId: null,
          createdAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
      },
      {
        kind: "message",
        id: "row-intro",
        createdAt: "2026-01-01T00:00:02Z",
        durationStart: "2026-01-01T00:00:00Z",
        showAssistantMeta: false,
        showCompletionDivider: false,
        completionSummary: null,
        showAssistantCopyButton: false,
        assistantCopyStreaming: false,
        showUrlPreviewCard: false,
        message: {
          id: "assistant-intro" as never,
          role: "assistant",
          text: "我会生成图片。",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:02Z",
          completedAt: "2026-01-01T00:00:02Z",
          streaming: false,
        },
      },
      {
        kind: "work",
        id: "row-work",
        createdAt: "2026-01-01T00:00:04Z",
        groupedEntries: [
          {
            id: "work-1",
            createdAt: "2026-01-01T00:00:04Z",
            label: "Ran command",
            tone: "tool",
            status: "completed",
          },
        ],
      },
      {
        kind: "image-generation",
        id: "row-image",
        createdAt: "2026-01-01T00:00:13Z",
        items: [
          {
            id: "image-1",
            createdAt: "2026-01-01T00:00:13Z",
            status: "completed",
            label: "图片已生成",
            imagePath: "data:image/png;base64,abc",
          },
        ],
      },
    ]);

    expect(state.ownerAssistantMessageIdByRowId.get("row-intro")).toBe("row-image");
    expect(state.ownerAssistantMessageIdByRowId.get("row-work")).toBe("row-image");
    expect(state.ownerAssistantMessageIdByRowId.has("row-image")).toBe(false);
    expect(state.summaryButtonHostByRowId.get("row-intro")).toBe("row-image");
    expect(state.elapsedByAssistantMessageId.get("row-image")).toBe("9.0s");
  });
});

describe("deriveMessagesTimelineRows", () => {
  it("renders an image-generation shimmer row as soon as the image task starts", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "image-start-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "image-start",
            createdAt: "2026-01-01T00:00:00Z",
            label: "正在生成图片",
            tone: "tool",
            itemType: "image_view",
            status: "running",
            generatedImage: {
              status: "in_progress",
            },
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows).toEqual([
      {
        kind: "image-generation",
        id: "image-start-entry",
        createdAt: "2026-01-01T00:00:00Z",
        items: [
          {
            id: "image-start-entry",
            createdAt: "2026-01-01T00:00:00Z",
            status: "running",
            label: "正在生成图片",
            imagePath: null,
          },
        ],
      },
    ]);
  });

  it("keeps image-generation started events instead of the generic working row", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "image-start-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "image-start",
            createdAt: "2026-01-01T00:00:00Z",
            label: "Image view started",
            tone: "tool",
            itemType: "image_view",
            status: "running",
            generatedImage: {
              status: "in_progress",
            },
          },
        },
        {
          id: "thinking-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:01Z",
          entry: {
            id: "thinking",
            createdAt: "2026-01-01T00:00:01Z",
            label: "Thinking",
            tone: "thinking",
            status: "running",
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows[0]?.kind).toBe("image-generation");
    expect(rows[1]?.kind).toBe("work");
  });

  it("suppresses the generic thinking row while an image-generation shimmer is running", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "image-start-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "image-start",
            createdAt: "2026-01-01T00:00:00Z",
            label: "Image view",
            tone: "tool",
            itemType: "image_view",
            status: "running",
            generatedImage: {
              id: "ig_1",
              status: "in_progress",
              type: "imageGeneration",
            },
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["image-generation"]);
  });

  it("marks an unresolved image-generation row as failed when a later runtime issue arrives", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "image-start-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "image-start",
            createdAt: "2026-01-01T00:00:00Z",
            label: "Image view",
            tone: "tool",
            itemType: "image_view",
            status: "running",
            generatedImage: {
              id: "ig_1",
              status: "in_progress",
              type: "imageGeneration",
            },
          },
        },
        {
          id: "runtime-warning-entry",
          kind: "work",
          createdAt: "2026-01-01T00:01:00Z",
          entry: {
            id: "runtime-warning",
            createdAt: "2026-01-01T00:01:00Z",
            label: "Runtime warning",
            detail:
              "Reconnecting... 1/5: stream disconnected before completion: stream closed before response.completed",
            tone: "info",
            status: "completed",
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const row = rows[0];
    expect(row?.kind).toBe("image-generation");
    if (row?.kind !== "image-generation") return;
    expect(row.items[0]).toEqual({
      id: "image-start-entry",
      createdAt: "2026-01-01T00:00:00Z",
      status: "failed",
      label: "图片生成失败",
      imagePath: null,
      errorMessage:
        "Reconnecting... 1/5: stream disconnected before completion: stream closed before response.completed",
    });
  });

  it("suppresses the generic thinking row while a running work entry is visible", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "thinking-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:01Z",
          entry: {
            id: "thinking",
            createdAt: "2026-01-01T00:00:01Z",
            label: "Thinking",
            tone: "thinking",
            status: "running",
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["work"]);
    expect(rows.some((row) => row.id === "working-indicator-row")).toBe(false);
  });

  it("uses completed image base64 even when the provider item status still says generating", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "image-complete-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "image-complete",
            createdAt: "2026-01-01T00:00:00Z",
            label: "Image view",
            tone: "tool",
            itemType: "image_view",
            status: "completed",
            generatedImage: {
              result: "a".repeat(512),
              status: "generating",
            },
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const row = rows[0];
    expect(row?.kind).toBe("image-generation");
    if (row?.kind !== "image-generation") return;
    expect(row.items[0]?.status).toBe("completed");
    expect(row.items[0]?.imagePath).toBe(`data:image/png;base64,${"a".repeat(512)}`);
  });

  it("falls back to the generated image saved path when base64 is unavailable", () => {
    const savedPath =
      "C:\\Users\\Administrator\\.bahew\\agent-data\\generated_images\\thread\\image.png";
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "image-saved-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "image-saved",
            createdAt: "2026-01-01T00:00:00Z",
            label: "Image view",
            tone: "tool",
            itemType: "image_view",
            status: "completed",
            generatedImage: {
              result: "",
              savedPath,
              status: "generating",
            },
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const row = rows[0];
    expect(row?.kind).toBe("image-generation");
    if (row?.kind !== "image-generation") return;
    expect(row.items[0]?.status).toBe("completed");
    expect(row.items[0]?.imagePath).toBe(savedPath);
  });

  it("only enables assistant copy for the terminal assistant message in a turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            completedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: "assistant-final-entry",
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.showAssistantCopyButton).toBe(false);
    expect(assistantRows[0]?.showAssistantMeta).toBe(false);
    expect(assistantRows[1]?.showAssistantCopyButton).toBe(true);
    expect(assistantRows[1]?.showAssistantMeta).toBe(true);
    expect(assistantRows[1]?.showCompletionDivider).toBe(true);
  });

  it("marks only the active assistant turn as streaming for copy controls", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-one-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-one" as never,
            role: "assistant",
            text: "Earlier response.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            completedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-two-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-two" as never,
            role: "assistant",
            text: "Active response.",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: "assistant-two-entry",
      completionSummary: "done",
      isWorking: false,
      activeTurnInProgress: true,
      activeTurnId: "turn-2" as never,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows[0]?.assistantCopyStreaming).toBe(false);
    expect(assistantRows[0]?.completionSummary).toBeNull();
    expect(assistantRows[1]?.assistantCopyStreaming).toBe(true);
    expect(assistantRows[1]?.completionSummary).toBe("done");
  });

  it("shows the URL preview card only after the turn finishes on the final assistant message", () => {
    const baseInput = {
      timelineEntries: [
        {
          id: "assistant-one-entry",
          kind: "message" as const,
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-one" as never,
            role: "assistant" as const,
            text: "实时预览在 http://localhost:5050 监听。",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            completedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-two-entry",
          kind: "message" as const,
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-two" as never,
            role: "assistant" as const,
            text: "已完成，预览地址 http://localhost:5050 。",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: "assistant-two-entry",
      completionSummary: "done",
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    };

    const urlPreviewFlags = (rows: ReturnType<typeof deriveMessagesTimelineRows>) =>
      rows.flatMap((row) => (row.kind === "message" ? [row.showUrlPreviewCard] : []));

    const runningRows = deriveMessagesTimelineRows({
      ...baseInput,
      activeTurnInProgress: true,
      activeTurnId: "turn-1" as never,
    });

    expect(urlPreviewFlags(runningRows)).toEqual([false, false]);

    const completedRows = deriveMessagesTimelineRows({
      ...baseInput,
      activeTurnInProgress: false,
      activeTurnId: null,
    });

    expect(urlPreviewFlags(completedRows)).toEqual([false, true]);
  });

  it("projects assistant diff summaries and user revert counts onto the affected rows", () => {
    const assistantTurnDiffSummary = {
      turnId: "turn-1" as never,
      completedAt: "2026-01-01T00:00:30Z",
      assistantMessageId: "assistant-1" as never,
      checkpointTurnCount: 2,
      checkpointRef: "refs/t3/checkpoints/thread-1/turn/2" as never,
      files: [{ path: "src/index.ts", additions: 3, deletions: 1 }],
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map([
        ["assistant-1" as never, assistantTurnDiffSummary],
      ]),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 1]]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );
    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(userRow?.revertTurnCount).toBe(1);
    expect(userRow?.canEditUserMessage).toBe(true);
    expect(assistantRow?.assistantTurnDiffSummary).toBe(assistantTurnDiffSummary);
  });

  it("只允许最后一条用户消息显示编辑入口", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-one-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "First request",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-one-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "First answer",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
        {
          id: "user-two-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-2" as never,
            role: "user",
            text: "Second request",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 0]]),
    });

    const userRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );

    expect(userRows.map((row) => [row.message.id, row.canEditUserMessage ?? false])).toEqual([
      ["user-1", false],
      ["user-2", true],
    ]);
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("reuses work rows when equivalent timeline derivations create new grouped arrays", () => {
    const firstWorkEntry = {
      id: "work-1",
      createdAt: "2026-01-01T00:00:00Z",
      label: "thinking",
      detail: "Inspecting repository state",
      tone: "thinking" as const,
    };
    const secondWorkEntry = {
      id: "work-2",
      createdAt: "2026-01-01T00:00:01Z",
      label: "read",
      detail: "Reading package.json",
      tone: "tool" as const,
    };

    const createRows = () =>
      deriveMessagesTimelineRows({
        timelineEntries: [
          {
            id: "entry-work-1",
            kind: "work",
            createdAt: firstWorkEntry.createdAt,
            entry: firstWorkEntry,
          },
          {
            id: "entry-work-2",
            kind: "work",
            createdAt: secondWorkEntry.createdAt,
            entry: secondWorkEntry,
          },
        ],
        completionDividerBeforeEntryId: null,
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

    const firstRows = createRows();
    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });
    const secondRows = createRows();

    expect(secondRows[0]).not.toBe(firstRows[0]);

    const repeated = computeStableMessagesTimelineRows(secondRows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result[0]).toBe(initial.result[0]);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });
});
