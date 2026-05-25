import { describe, expect, it } from "vitest";
import { MessageId, ThreadId } from "@t3tools/contracts";

import {
  buildReviewInlineCommentsPrompt,
  createReviewInlineComment,
  openReviewInlineComments,
} from "./reviewComments";

describe("reviewComments", () => {
  it("创建审查行内评论时会清理正文和无效行号", () => {
    const comment = createReviewInlineComment({
      id: "comment-1",
      threadId: ThreadId.make("thread-1"),
      filePath: " src/App.tsx ",
      body: "  这里需要补空状态  ",
      diffSide: "new",
      newLine: 12,
      oldLine: -1,
      messageId: MessageId.make("message-1"),
      createdAt: "2026-05-25T00:00:00.000Z",
    });

    expect(comment).toMatchObject({
      filePath: "src/App.tsx",
      body: "这里需要补空状态",
      status: "open",
      surface: "review",
      newLine: 12,
      oldLine: null,
    });
  });

  it("只把未解决评论注入后续提示", () => {
    const openComment = createReviewInlineComment({
      id: "comment-1",
      threadId: ThreadId.make("thread-1"),
      filePath: "src/App.tsx",
      body: "按钮需要有禁用态",
      diffSide: "new",
      newLine: 42,
    });
    const resolvedComment = {
      ...openComment,
      id: "comment-2",
      body: "已处理的问题",
      status: "resolved" as const,
    };

    expect(openReviewInlineComments([openComment, resolvedComment])).toEqual([openComment]);
    expect(buildReviewInlineCommentsPrompt([openComment, resolvedComment])).toBe(
      [
        "请处理下面这些代码审查行内评论：",
        "",
        "1. src/App.tsx:42 - 按钮需要有禁用态",
        "",
        "请优先逐条解决评论中指出的问题；如果某条评论不适用，请说明原因。",
      ].join("\n"),
    );
  });

  it("没有开放评论时不生成提示", () => {
    expect(buildReviewInlineCommentsPrompt([])).toBeNull();
  });
});
