import { describe, expect, it } from "vitest";

import { resolveConversationWorkspacePath } from "./conversationWorkspace";

describe("resolveConversationWorkspacePath", () => {
  it("resolves a conversation workspace under a Windows root", () => {
    expect(
      resolveConversationWorkspacePath(
        "C:\\Users\\Administrator\\.bahew\\userdata\\conversation-workspace\\",
        "53b71277-23ac-411f-95f1-ee9393c9c6f4",
      ),
    ).toBe(
      "C:\\Users\\Administrator\\.bahew\\userdata\\conversation-workspace\\53b71277-23ac-411f-95f1-ee9393c9c6f4",
    );
  });

  it("resolves a conversation workspace under a POSIX root", () => {
    expect(resolveConversationWorkspacePath("/tmp/conversation-workspace/", "thread-1")).toBe(
      "/tmp/conversation-workspace/thread-1",
    );
  });

  it("returns undefined when the root or thread id is missing", () => {
    expect(resolveConversationWorkspacePath("", "thread-1")).toBeUndefined();
    expect(resolveConversationWorkspacePath("/tmp/conversation-workspace", null)).toBeUndefined();
  });
});
