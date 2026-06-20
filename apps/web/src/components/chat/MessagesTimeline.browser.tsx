import "../../index.css";

import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { createRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const scrollToEndSpy = vi.fn();
const getStateSpy = vi.fn(() => ({ isAtEnd: true }));
const getTurnDiffSpy = vi.fn();
const getFullThreadDiffSpy = vi.fn();

vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");

  function LegendList(props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    ref?: React.Ref<LegendListRef>;
  }) {
    React.useImperativeHandle(
      props.ref,
      () =>
        ({
          scrollToEnd: scrollToEndSpy,
          getState: getStateSpy,
        }) as unknown as LegendListRef,
    );

    return (
      <div data-testid="legend-list">
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  }

  return { LegendList };
});

vi.mock("../../environmentApi", () => ({
  readEnvironmentApi: () => ({
    orchestration: {
      getTurnDiff: getTurnDiffSpy,
      getFullThreadDiff: getFullThreadDiffSpy,
    },
  }),
}));

import { MessagesTimeline } from "./MessagesTimeline";

const MESSAGE_CREATED_AT = "2026-04-13T12:00:00.000Z";
const LEGACY_EMPTY_TIMELINE_PROMPT = "Send a message to start " + "the conversation.";

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnId: null,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    threadId: "thread-1" as never,
    onOpenTurnDiff: vi.fn(),
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: vi.fn(),
    isRevertingCheckpoint: false,
    onImageExpand: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    markdownCwd: undefined,
    resolvedTheme: "dark" as const,
    timestampFormat: "24-hour" as const,
    workspaceRoot: undefined,
    onIsAtEndChange: vi.fn(),
  };
}

function buildLongUserMessageText(tail = "deep hidden detail only after expand") {
  return Array.from({ length: 9 }, (_, index) =>
    index === 8 ? tail : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
  ).join("\n");
}

function buildUserTimelineEntry(text: string) {
  return {
    id: "entry-1",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: "message-1" as never,
      role: "user" as const,
      text,
      createdAt: MESSAGE_CREATED_AT,
      streaming: false,
    },
  };
}

describe("MessagesTimeline", () => {
  afterEach(() => {
    scrollToEndSpy.mockReset();
    getStateSpy.mockClear();
    getTurnDiffSpy.mockReset();
    getFullThreadDiffSpy.mockReset();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders activity rows instead of the empty placeholder when a thread has non-message timeline data", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "work-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "thinking",
              detail: "Inspecting repository state",
              tone: "thinking",
            },
          },
        ]}
      />,
    );

    try {
      await expect.element(page.getByText(LEGACY_EMPTY_TIMELINE_PROMPT)).not.toBeInTheDocument();
      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("snaps to the bottom when timeline rows appear after an initially empty render", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const props = buildProps();
    const screen = await render(<MessagesTimeline {...props} timelineEntries={[]} />);

    try {
      await expect.element(page.getByTestId("timeline-empty-placeholder")).toBeInTheDocument();
      await expect.element(page.getByText(LEGACY_EMPTY_TIMELINE_PROMPT)).not.toBeInTheDocument();

      await screen.rerender(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            {
              id: "work-1",
              kind: "work",
              createdAt: "2026-04-13T12:00:00.000Z",
              entry: {
                id: "work-1",
                createdAt: "2026-04-13T12:00:00.000Z",
                label: "thinking",
                detail: "Inspecting repository state",
                tone: "thinking",
              },
            },
          ]}
        />,
      );

      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
      expect(props.onIsAtEndChange).toHaveBeenCalledWith(true);
      expect(scrollToEndSpy).toHaveBeenCalledWith({ animated: false });
      expect(requestAnimationFrameSpy).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("starts long user messages collapsed by default", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    try {
      const toggle = page.getByRole("button", { name: "Show full message" });
      await expect.element(toggle).toBeVisible();
      await expect.element(toggle).toHaveAttribute("aria-expanded", "false");

      const messageBody = document.querySelector(
        "[data-user-message-body='true']",
      ) as HTMLDivElement | null;
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("true");
      expect(messageBody?.className).toContain("max-h-44");
      expect(messageBody?.className).toContain("overflow-hidden");
      expect(messageBody?.getAttribute("data-user-message-fade")).toBe("true");
      expect(messageBody?.style.maskImage).toContain("linear-gradient");
    } finally {
      await screen.unmount();
    }
  });

  it("expands and re-collapses long user messages from the toggle", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    try {
      const expandButton = page.getByRole("button", { name: "Show full message" });
      await expect.element(expandButton).toBeVisible();

      expect(document.body.textContent ?? "").toContain("deep hidden detail only after expand");

      await expandButton.click();

      const collapseButton = page.getByRole("button", { name: "Show less" });
      await expect.element(collapseButton).toBeVisible();
      await expect.element(collapseButton).toHaveAttribute("aria-expanded", "true");

      let messageBody = document.querySelector("[data-user-message-body='true']");
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("false");
      expect(messageBody?.className).not.toContain("max-h-44");
      expect(messageBody?.getAttribute("data-user-message-fade")).toBe("false");
      expect((messageBody as HTMLDivElement | null)?.style.maskImage ?? "").toBe("");

      await collapseButton.click();

      await expect.element(page.getByRole("button", { name: "Show full message" })).toBeVisible();
      messageBody = document.querySelector("[data-user-message-body='true']");
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("true");
      expect(messageBody?.className).toContain("max-h-44");
      expect(messageBody?.getAttribute("data-user-message-fade")).toBe("true");
      expect((messageBody as HTMLDivElement | null)?.style.maskImage).toContain("linear-gradient");
    } finally {
      await screen.unmount();
    }
  });

  it("starts the newest long user prompt collapsed", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText("latest long prompt"))]}
      />,
    );

    try {
      await expect.element(page.getByRole("button", { name: "Show full message" })).toBeVisible();

      const messageBody = document.querySelector("[data-user-message-body='true']");
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("true");
    } finally {
      await screen.unmount();
    }
  });

  it("将已编辑文件摘要展开为文件行和内联 diff", async () => {
    getTurnDiffSpy.mockResolvedValue({
      diff: "diff --git a/apps/web/src/localApi.test.ts b/apps/web/src/localApi.test.ts\n--- a/apps/web/src/localApi.test.ts\n+++ b/apps/web/src/localApi.test.ts\n@@ -1,2 +1,2 @@\n-old value\n+new value",
    });
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        onOpenMarkdownFile={vi.fn()}
        workspaceRoot="C:/repo"
        turnDiffSummaryByAssistantMessageId={
          new Map([
            [
              MessageId.make("assistant-1"),
              {
                turnId: TurnId.make("turn-1"),
                completedAt: "2026-04-13T12:00:00.000Z",
                files: [
                  {
                    path: "apps/web/src/api/admin/settings.ts",
                    kind: "modified",
                    additions: 0,
                    deletions: 0,
                  },
                  {
                    path: "apps/web/src/localApi.test.ts",
                    kind: "modified",
                    additions: 4,
                    deletions: 0,
                  },
                ],
                checkpointTurnCount: 2,
              },
            ],
          ])
        }
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: [
                "C:/repo/apps/web/src/api/admin/settings.ts",
                "C:/repo/apps/web/src/localApi.test.ts",
              ],
            },
          },
          {
            id: "assistant-entry-1",
            kind: "message",
            createdAt: "2026-04-13T12:00:01.000Z",
            message: {
              id: MessageId.make("assistant-1"),
              role: "assistant",
              text: "",
              turnId: TurnId.make("turn-1"),
              createdAt: "2026-04-13T12:00:01.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    try {
      const summaryToggle = page.getByRole("button", { name: /已编辑 1 个文件/ });
      await expect.element(summaryToggle).toBeVisible();
      await expect.element(page.getByText("localApi.test.ts")).not.toBeInTheDocument();

      await summaryToggle.click();
      await expect.element(page.getByText("settings.ts")).not.toBeInTheDocument();
      await expect.element(page.getByText("localApi.test.ts")).toBeVisible();
      await expect.element(page.getByText("+4")).toBeVisible();
      await expect.element(page.getByText("-0")).toBeVisible();
      await expect.element(page.getByText("new value")).not.toBeInTheDocument();

      await page.getByRole("button", { name: "展开文件 diff" }).click();
      expect(getTurnDiffSpy).toHaveBeenCalledWith({
        threadId: "thread-1",
        fromTurnCount: 1,
        toTurnCount: 2,
        ignoreWhitespace: false,
      });
      await expect.element(page.getByText("new value")).toBeVisible();
      await expect.element(page.getByText("old value")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps user message copy, restore, and time metadata outside the message bubble", async () => {
    const props = buildProps();
    const screen = await render(
      <MessagesTimeline
        {...props}
        timelineEntries={[buildUserTimelineEntry("Save as a file")]}
        revertTurnCountByUserMessageId={new Map([["message-1" as never, 0]])}
      />,
    );

    try {
      const actions = document.querySelector("[data-user-message-actions='true']") as HTMLElement;
      const messageBody = document.querySelector("[data-user-message-body='true']");
      const bubble = messageBody?.closest("[class*='bg-secondary']");

      expect(actions).toBeTruthy();
      expect(actions.className).toContain("opacity-0");
      expect(actions.className).toContain("group-hover:opacity-100");
      expect(bubble?.contains(actions)).toBe(false);
      await expect.element(page.getByRole("button", { name: "Copy link" })).toBeVisible();
      await expect
        .element(page.getByRole("button", { name: "Revert to before this message" }))
        .toBeVisible();
      expect(actions.textContent).toMatch(/\d{2}:\d{2}/);
    } finally {
      await screen.unmount();
    }
  });
});
