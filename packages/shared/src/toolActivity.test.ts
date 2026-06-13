import { describe, expect, it } from "vitest";

import {
  deriveDynamicToolActivityPresentation,
  deriveToolActivityPresentation,
} from "./toolActivity.ts";

describe("toolActivity", () => {
  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toEqual({
      summary: "Ran command",
      family: "command",
      detail: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      family: "file",
      detail: "/tmp/app.ts",
    });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      family: "file",
    });
  });

  it("summarizes generic MCP tools with parameters and output", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "mcp_tool_call",
        title: "MCP tool call",
        data: {
          tool: "github_create_issue",
          rawInput: {
            title: "修复注册入口",
            path: "apps/web/src/Register.tsx",
          },
          rawOutput: {
            stdout: "created issue #42\nhttps://example.test/issues/42",
          },
        },
        fallbackSummary: "MCP tool call",
      }),
    ).toEqual({
      summary: "MCP github create issue",
      family: "mcp",
      toolName: "github_create_issue",
      argumentsPreview: "path: apps/web/src/Register.tsx",
      outputPreview: "created issue #42\nhttps://example.test/issues/42",
      detail:
        "参数: path: apps/web/src/Register.tsx\n输出: created issue #42\nhttps://example.test/issues/42",
    });
  });

  it("summarizes Codex MCP item arguments and result content", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "mcp_tool_call",
        title: "MCP tool call",
        data: {
          item: {
            type: "mcpToolCall",
            tool: "list_repositories",
            server: "github",
            arguments: {
              query: "t3 code",
            },
            result: {
              content: [{ type: "text", text: "t3codedev\ncodex-monitor" }],
            },
          },
        },
        fallbackSummary: "MCP tool call",
      }),
    ).toEqual({
      summary: "MCP list repositories",
      family: "mcp",
      toolName: "list_repositories",
      argumentsPreview: "query: t3 code",
      outputPreview: "t3codedev\ncodex-monitor",
      detail: "参数: query: t3 code\n输出: t3codedev\ncodex-monitor",
    });
  });

  it("extracts Codex web-search queries and opened pages from official item shape", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "web_search",
        title: "Web search",
        data: {
          item: {
            id: "ws_1",
            type: "webSearch",
            query: "Codex plugins .codex-plugin plugin.json",
            action: {
              type: "search",
              query: "Codex plugins .codex-plugin plugin.json",
            },
          },
        },
        fallbackSummary: "Web search",
      }),
    ).toEqual({
      summary: "Searched web",
      family: "search",
      detail: "Codex plugins .codex-plugin plugin.json",
    });

    expect(
      deriveToolActivityPresentation({
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
        fallbackSummary: "Web search",
      }),
    ).toMatchObject({
      summary: "Searched web",
      family: "search",
      detail: "https://developers.openai.com/codex/app-server",
    });
  });

  it("labels browser dynamic tools with arguments and output", () => {
    expect(
      deriveDynamicToolActivityPresentation({
        namespace: "t3_browser",
        tool: "browser_click",
        arguments: {
          selector: "button[aria-label='注册']",
        },
        contentItems: [{ type: "inputText", text: "Clicked button[aria-label='注册']" }],
      }),
    ).toMatchObject({
      title: "浏览器点击元素",
      family: "browser",
      detail: "参数: selector: button[aria-label='注册']\n输出: Clicked button[aria-label='注册']",
    });
  });

  it("distinguishes external browser and computer dynamic tools", () => {
    expect(
      deriveDynamicToolActivityPresentation({
        namespace: "t3_browser_external",
        tool: "browser_visible_dom",
      }),
    ).toMatchObject({
      title: "外部浏览器读取可见元素",
      family: "external_browser",
    });

    expect(
      deriveDynamicToolActivityPresentation({
        namespace: "t3_computer",
        tool: "computer_screenshot",
      }),
    ).toMatchObject({
      title: "电脑控制截图",
      family: "computer",
    });
  });
});
