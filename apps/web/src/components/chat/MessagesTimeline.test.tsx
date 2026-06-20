import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { createRef, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { LegendListRef } from "@legendapp/list/react";

vi.mock("@legendapp/list/react", async () => {
  const legendListTestId = "legend-list";

  const LegendList = (props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    ref?: Ref<LegendListRef>;
  }) => (
    <div data-testid={legendListTestId}>
      {props.ListHeaderComponent}
      {props.data.map((item) => (
        <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
      ))}
      {props.ListFooterComponent}
    </div>
  );

  return { LegendList };
});

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
});

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const MESSAGE_CREATED_AT = "2026-03-17T19:12:28.000Z";
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
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ACTIVE_THREAD_ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
    onIsAtEndChange: () => {},
  };
}

function buildLongUserMessageText(tail = "deep hidden detail only after expand") {
  return Array.from({ length: 9 }, (_, index) =>
    index === 8 ? tail : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
  ).join("\n");
}

function buildUserTimelineEntry(text: string, turnId?: TurnId | null) {
  return {
    id: "entry-1",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: MessageId.make("message-1"),
      role: "user" as const,
      text,
      ...(turnId !== undefined ? { turnId } : {}),
      createdAt: MESSAGE_CREATED_AT,
      streaming: false,
    },
  };
}

function buildAssistantTimelineEntry(input: {
  id: string;
  entryId: string;
  text: string;
  turnId: TurnId | null;
  createdAt: string;
  completedAt?: string;
}) {
  return {
    id: input.entryId,
    kind: "message" as const,
    createdAt: input.createdAt,
    message: {
      id: MessageId.make(input.id),
      role: "assistant" as const,
      text: input.text,
      turnId: input.turnId,
      createdAt: input.createdAt,
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      streaming: false,
    },
  };
}

describe("MessagesTimeline", () => {
  it("does not render the legacy empty conversation prompt for an empty timeline", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[]} />,
    );

    expect(markup).toContain('data-timeline-empty-placeholder="true"');
    expect(markup).not.toContain(LEGACY_EMPTY_TIMELINE_PROMPT);
  }, 20_000);

  it("renders a history skeleton while an existing thread detail is loading", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[]} isLoadingHistory />,
    );

    expect(markup).toContain('data-timeline-history-skeleton="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("正在加载对话内容");
    expect(markup).not.toContain(LEGACY_EMPTY_TIMELINE_PROMPT);
  }, 20_000);

  it("renders collapse controls for long user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain("显示完整消息");
    expect(markup).toContain("justify-end");
    expect(markup).toContain("items-end");
    expect(markup).toContain("max-w-[80%]");
    expect(markup).toContain("w-fit");
    expect(markup).toContain("rounded-[18px]");
    expect(markup).toContain("bg-secondary");
    expect(markup).toContain("px-4");
    expect(markup).toContain("py-2.5");
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-fade="true"');
    expect(markup).toContain('data-user-message-footer="true"');
    expect(markup).not.toContain("chat-user-document");
  }, 20_000);

  it("does not render collapse controls for short user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("Short prompt.")]}
      />,
    );

    expect(markup).not.toContain("显示完整消息");
    expect(markup).toContain('data-user-message-collapsible="false"');
  });

  it("renders a steer marker before the first assistant reply guided by a user steer", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const turnId = TurnId.make("turn-1");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry("继续补充这点。", turnId),
          buildAssistantTimelineEntry({
            id: "assistant-confirm",
            entryId: "entry-assistant-confirm",
            text: "收到，改成 5 页。",
            turnId,
            createdAt: "2026-03-17T19:13:28.000Z",
            completedAt: "2026-03-17T19:13:30.000Z",
          }),
          buildAssistantTimelineEntry({
            id: "assistant-final",
            entryId: "entry-assistant-final",
            text: "已改为 5 页并完成导出。",
            turnId,
            createdAt: "2026-03-17T19:14:28.000Z",
            completedAt: "2026-03-17T19:14:30.000Z",
          }),
        ]}
      />,
    );

    expect(markup).toContain("已引导对话");
    expect(markup.indexOf("已引导对话")).toBeLessThan(markup.indexOf("收到，改成 5 页。"));
    expect(markup.indexOf("已引导对话")).toBeGreaterThan(markup.indexOf("继续补充这点。"));
    expect(markup.indexOf("已引导对话")).toBeLessThan(markup.indexOf("已改为 5 页并完成导出。"));
    expect(markup).toContain('data-steer-conversation-marker="true"');
  });

  it("does not render a steer marker on a lone user steer message", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("继续补充这点。", TurnId.make("turn-1"))]}
      />,
    );

    expect(markup).not.toContain("已引导对话");
  });

  it("does not render a steer marker for ordinary user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("开始任务。")]}
      />,
    );

    expect(markup).not.toContain("已引导对话");
  });

  it("renders skill tokens in user messages with the inline skill chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("$ppt-master 请制作一份季度经营复盘。")]}
        skills={[
          {
            name: "ppt-master",
            displayName: "Ppt Master",
          },
        ]}
      />,
    );

    expect(markup).toContain("Ppt Master");
    expect(markup).toContain("sr-only");
    expect(markup).toContain("$ppt-master");
    expect(markup).toContain("border-fuchsia-500");
  });

  it("renders unknown skill tokens in user messages with the inline skill chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("$agent-reach 请整理客户触达计划。")]}
      />,
    );

    expect(markup).toContain("Agent Reach");
    expect(markup).toContain("$agent-reach");
    expect(markup).toContain("border-fuchsia-500");
  });

  it("only renders assistant time metadata for the terminal assistant message in a turn", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const turnId = TurnId.make("turn-1");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry("实现一个小功能"),
          buildAssistantTimelineEntry({
            id: "assistant-interim",
            entryId: "entry-assistant-interim",
            text: "我先检查相关文件。",
            turnId,
            createdAt: "2026-03-17T19:12:35.000Z",
            completedAt: "2026-03-17T19:12:36.000Z",
          }),
          buildAssistantTimelineEntry({
            id: "assistant-final",
            entryId: "entry-assistant-final",
            text: "已经完成。",
            turnId,
            createdAt: "2026-03-17T19:12:50.000Z",
            completedAt: "2026-03-17T19:12:55.000Z",
          }),
        ]}
      />,
    );

    expect(markup.match(/data-assistant-message-meta="true"/g)).toHaveLength(1);
    expect(markup).toContain("我先检查相关文件。");
    expect(markup).toContain("已经完成。");
  });

  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              buildLongUserMessageText("yoo what's @terminal-1:1-5 mean"),
              "",
              "<terminal_context>",
              "- Terminal 1 lines 1-5:",
              "  1 | julius@mac effect-http-ws-cli % bun i",
              "  2 | bun install v1.3.9 (cf6cdbbb)",
              "</terminal_context>",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s ");
    expect(markup).toContain("显示完整消息");
  }, 20_000);

  it("keeps the copy button for collapsed long user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain('aria-label="Copy link"');
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-footer="true"');
  });

  it("renders a checkpoint restore button beside the user message copy action", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const userMessageId = MessageId.make("message-1");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("Change the title")]}
        revertTurnCountByUserMessageId={new Map([[userMessageId, 0]])}
      />,
    );

    expect(markup).toContain('aria-label="Copy link"');
    expect(markup).toContain('aria-label="Revert to before this message"');
    expect(markup).toContain("lucide-undo-2");
  });

  it("folds context compaction entries into a completed work summary", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("已处理 1 项");
    expect(markup).toContain('data-work-group-summary="true"');
  });

  it("renders changed file work as a compact editable file row", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: ["C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts"],
            },
          },
        ]}
        workspaceRoot="C:/Users/mike/dev-stuff/t3code"
      />,
    );

    expect(markup).toContain("已编辑");
    expect(markup).toContain("1 个文件");
    expect(markup).not.toContain("session-logic.ts");
    expect(markup).not.toContain("+0");
    expect(markup).not.toContain(">-0<");
    expect(markup).not.toContain("C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts");
  });

  it("shows parsed diff stats for file-change work", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: ["C:/repo/apps/web/src/App.tsx"],
              detail:
                "diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx\n--- a/apps/web/src/App.tsx\n+++ b/apps/web/src/App.tsx\n@@ -1,3 +1,4 @@\n import React from 'react';\n-console.log('old');\n+console.log('new');\n+console.log('again');",
            },
          },
        ]}
        workspaceRoot="C:/repo"
      />,
    );

    expect(markup).toContain("已编辑");
    expect(markup).toContain("1 个文件");
    expect(markup).not.toContain("+2");
    expect(markup).not.toContain(">-1<");
    expect(markup).not.toContain("console.log(&#x27;new&#x27;)");
  });

  it("在文件变更行展开前隐藏已变更文件路径", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        onOpenMarkdownFile={() => {}}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: ["C:/repo/apps/web/src/App.tsx"],
              detail:
                "diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx\n--- a/apps/web/src/App.tsx\n+++ b/apps/web/src/App.tsx\n@@ -1,1 +1,1 @@\n-old\n+new",
            },
          },
        ]}
        workspaceRoot="C:/repo"
      />,
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("已编辑");
    expect(markup).toContain("1 个文件");
    expect(markup).not.toContain("apps/web/src/App.tsx");
    expect(markup).not.toContain("hover:text-[#0F66D0]");
  });

  it("labels synthetic new-file diffs as creating file work", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Ran command",
              tone: "tool",
              requestKind: "file-change",
              changedFiles: ["hello.py"],
              status: "running",
              detail:
                'diff --git a/hello.py b/hello.py\nnew file mode 100644\n--- /dev/null\n+++ b/hello.py\n@@ -0,0 +1,1 @@\n+print("你好")',
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("正在创建");
    expect(markup).toContain("1 个文件");
    expect(markup).not.toContain("hello.py");
    expect(markup).not.toContain("+1");
    expect(markup).not.toContain(">-0<");
  });

  it("shows running command work with shimmer styling", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Ran command",
              tone: "tool",
              command: "bun typecheck",
              itemType: "command_execution",
              status: "running",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("正在运行");
    expect(markup).toContain("bun typecheck");
    expect(markup).toContain("textShimmerMoving");
    expect(markup).toContain('aria-busy="true"');
  });

  it("starts completed command work collapsed with the command summary", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const command = "Get-Content -Path apps\\web\\package.json -TotalCount 160";
    const output = Array.from({ length: 18 }, (_, index) => `"line-${index + 1}": "value"`).join(
      "\n",
    );
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Ran command",
              tone: "tool",
              command,
              output,
              itemType: "command_execution",
              status: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("已运行");
    expect(markup).toContain(command);
    expect(markup).not.toContain('data-command-work-panel="true"');
    expect(markup).not.toContain("bash");
    expect(markup).not.toContain("&quot;line-18&quot;: &quot;value&quot;");
    expect(markup).not.toContain('aria-label="复制命令和输出"');
    expect(markup).not.toContain('aria-label="复制命令"');
    expect(markup).not.toContain('aria-label="复制输出"');
    expect(markup).not.toContain("成功");
    expect(markup).not.toContain('data-command-output-scroll="true"');
  });

  it("hides duplicated command text from the output block", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const command = "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'";
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Ran command",
              tone: "tool",
              command: "bun run lint",
              rawCommand: command,
              detail: command,
              itemType: "command_execution",
              status: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("已运行 bun run lint");
    expect(markup).not.toContain("无输出");
    expect(markup).not.toContain("复制输出");
    expect(markup).not.toContain('"C:\\Program Files\\PowerShell\\7\\pwsh.exe"');
  });

  it("keeps explicit command output hidden while collapsed", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Ran command",
              tone: "tool",
              command: "bun tsc --noEmit",
              output: "line-1\nline-2\nline-3",
              detail: "summary line",
              itemType: "command_execution",
              status: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("已运行 bun tsc --noEmit");
    expect(markup).not.toContain("line-3");
    expect(markup).not.toContain("已运行命令");
    expect(markup).not.toContain("summary line");
  });

  it("keeps the collapsed summary command text without rendering shell output", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Ran command",
              tone: "tool",
              command: "bun test",
              output: "ok\n1 pass",
              itemType: "command_execution",
              status: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("已运行 bun test");
    expect(markup).not.toContain("1 pass");
    expect(markup).not.toContain("bun test\nok");
  });

  it.each([
    [
      "thinking",
      {
        label: "Thinking",
        tone: "thinking" as const,
        status: "running" as const,
      },
      "正在思考",
    ],
    [
      "file-change",
      {
        label: "Edited files",
        tone: "tool" as const,
        requestKind: "file-change" as const,
        changedFiles: ["C:/repo/apps/web/src/App.tsx"],
        status: "running" as const,
      },
      "正在编辑",
    ],
    [
      "file-change via changedFiles",
      {
        label: "Edited files",
        tone: "tool" as const,
        changedFiles: ["C:/repo/apps/web/src/App.tsx"],
        status: "running" as const,
      },
      "正在编辑",
    ],
  ])("shows %s running work with the shimmer status treatment", async (_name, entry, label) => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              ...entry,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain(label);
    if (_name === "thinking") {
      expect(markup).toContain("textShimmerMoving");
      expect(markup).toContain('aria-busy="true"');
    } else {
      expect(markup).toContain("1 个文件");
      expect(markup).not.toContain("App.tsx");
      expect(markup).not.toContain("+0");
      expect(markup).not.toContain(">-0<");
    }
  });

  it("shows running image generation with shimmer wording instead of the raw tool label", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Image view",
              tone: "tool",
              itemType: "image_view",
              status: "running",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("正在生成图片");
    expect(markup).toContain("image-generation-shimmer");
    expect(markup).not.toContain(">Image view<");
  });

  it("shows image generation failure instead of a shimmer when runtime reports an error", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Image view",
              tone: "tool",
              itemType: "image_view",
              status: "running",
            },
          },
          {
            id: "entry-2",
            kind: "work",
            createdAt: "2026-03-17T19:13:28.000Z",
            entry: {
              id: "work-2",
              createdAt: "2026-03-17T19:13:28.000Z",
              label: "Runtime warning",
              detail:
                "Reconnecting... 1/5: stream disconnected before completion: stream closed before response.completed",
              tone: "info",
              status: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("图片生成失败");
    expect(markup).toContain("stream disconnected before completion");
    expect(markup).toContain('data-image-tile-status="failed"');
    expect(markup).not.toContain("image-generation-shimmer");
  });

  it("renders the live working row with shimmer styling", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        timelineEntries={[]}
      />,
    );

    expect(markup).toContain("正在思考");
    expect(markup).toContain("textShimmerMoving");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("animate-spin");
  });
});
