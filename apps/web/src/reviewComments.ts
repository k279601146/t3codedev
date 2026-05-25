import type { MessageId, ThreadId } from "@t3tools/contracts";

export type ReviewCommentDiffSide = "old" | "new";
export type ReviewCommentStatus = "open" | "resolved";

export interface ReviewInlineComment {
  id: string;
  threadId: ThreadId;
  surface: "review";
  filePath: string;
  body: string;
  status: ReviewCommentStatus;
  createdAt: string;
  diffSide: ReviewCommentDiffSide;
  oldLine: number | null;
  newLine: number | null;
  messageId?: MessageId | undefined;
}

export interface ReviewInlineCommentDraft {
  threadId: ThreadId;
  filePath: string;
  body: string;
  diffSide: ReviewCommentDiffSide;
  oldLine?: number | null | undefined;
  newLine?: number | null | undefined;
  messageId?: MessageId | undefined;
}

function normalizeLine(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export function createReviewInlineComment(
  input: ReviewInlineCommentDraft & { id: string; createdAt?: string | undefined },
): ReviewInlineComment {
  return {
    id: input.id,
    threadId: input.threadId,
    surface: "review",
    filePath: input.filePath.trim(),
    body: input.body.trim(),
    status: "open",
    createdAt: input.createdAt ?? new Date().toISOString(),
    diffSide: input.diffSide,
    oldLine: normalizeLine(input.oldLine),
    newLine: normalizeLine(input.newLine),
    ...(input.messageId ? { messageId: input.messageId } : {}),
  };
}

export function openReviewInlineComments(
  comments: readonly ReviewInlineComment[],
): ReviewInlineComment[] {
  return comments.filter((comment) => comment.status === "open" && comment.body.length > 0);
}

function formatCommentLocation(comment: ReviewInlineComment): string {
  const line = comment.diffSide === "old" ? comment.oldLine : comment.newLine;
  return line ? `${comment.filePath}:${line}` : comment.filePath;
}

export function buildReviewInlineCommentsPrompt(
  comments: readonly ReviewInlineComment[],
): string | null {
  const openComments = openReviewInlineComments(comments);
  if (openComments.length === 0) {
    return null;
  }

  const lines = openComments.map(
    (comment, index) => `${index + 1}. ${formatCommentLocation(comment)} - ${comment.body}`,
  );
  return [
    "请处理下面这些代码审查行内评论：",
    "",
    ...lines,
    "",
    "请优先逐条解决评论中指出的问题；如果某条评论不适用，请说明原因。",
  ].join("\n");
}
