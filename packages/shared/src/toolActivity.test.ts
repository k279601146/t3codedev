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
