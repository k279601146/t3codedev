import { describe, expect, it } from "vitest";

import { parseQqCommand } from "./RemoteControlLayer.ts";

describe("parseQqCommand", () => {
  it("parses new session commands", () => {
    expect(parseQqCommand("/new 帮我看一下当前项目")).toEqual({
      kind: "new",
      argument: "帮我看一下当前项目",
    });
  });

  it("treats plain messages as existing-thread ask payloads", () => {
    expect(parseQqCommand("thread-1 继续")).toEqual({
      kind: "ask",
      argument: "thread-1 继续",
    });
  });
});
