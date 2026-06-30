import { describe, expect, it } from "vitest";

import {
  appendComposerPluginLaunchContext,
  buildComposerPluginLaunchContext,
  stripTrailingComposerPluginLaunchContext,
} from "./composerPluginLaunch";
import {
  attachComposerPluginMentionHealth,
  getVisibleComposerPluginMentions,
  resolveComposerPluginMentionHealthBlock,
  resolvePromptComposerPluginMentionHealthBlock,
  searchComposerPluginMentionList,
  searchComposerPluginMentions,
} from "./composerPluginMentions";
import { promptUsesChromePlugin } from "./browserExternalPluginState";

describe("composerPluginLaunch", () => {
  it("adds launch context for built-in plugin mentions", () => {
    expect(buildComposerPluginLaunchContext("@Computer 截屏看看")).toContain(
      "@Computer: use Bahew computer_use",
    );
    expect(buildComposerPluginLaunchContext("@Browser 打开 https://example.test")).toContain(
      "@Browser: use the Bahew in-app browser tools",
    );
    expect(buildComposerPluginLaunchContext("@Chrome 检查登录页")).toContain(
      "@Chrome: use browser_use_external with the t3_browser_external namespace",
    );
  });

  it("treats simple app mentions as desktop app targets", () => {
    expect(buildComposerPluginLaunchContext("@Notepad 输入 hello")).toContain(
      '@Notepad: treat this as a desktop app target; use computer_list_windows with query "Notepad"',
    );
  });

  it("leaves ordinary prompts unchanged", () => {
    expect(appendComposerPluginLaunchContext("普通问题")).toBe("普通问题");
  });

  it("strips trailing launch context from display text", () => {
    const prompt = appendComposerPluginLaunchContext("@Computer 截屏看看");
    expect(stripTrailingComposerPluginLaunchContext(prompt)).toBe("@Computer 截屏看看");
  });

  it("exposes Chrome suggestions when builtin plugin capability is enabled", () => {
    expect(searchComposerPluginMentions("").map((mention) => mention.token)).toEqual([
      "@Browser",
      "@Computer",
    ]);
    expect(
      searchComposerPluginMentions("", { includeChrome: true }).map((mention) => mention.token),
    ).toEqual(["@Browser", "@Chrome", "@Computer"]);
  });

  it("detects manually typed Chrome plugin mentions for send gating", () => {
    expect(promptUsesChromePlugin("@Chrome 打开登录页")).toBe(true);
    expect(promptUsesChromePlugin("请用 @chrome 打开登录页")).toBe(true);
    expect(promptUsesChromePlugin("解释 @ChromeDriver")).toBe(false);
  });

  it("attaches bridge health to composer plugin mentions", () => {
    const mentions = attachComposerPluginMentionHealth(
      getVisibleComposerPluginMentions({ includeChrome: true }),
      [
        {
          id: "browser_use",
          label: "Browser Use",
          namespace: "t3_browser",
          status: "ready",
          reason: "ready",
          reasonLabel: "状态正常",
          summary: "可直接使用",
          detail: "当前标签页：Local App",
          actionLabel: null,
          lastError: null,
          updatedAt: "2026-06-30T00:00:00.000Z",
          lastToolCallAt: null,
        },
        {
          id: "browser_use_external",
          label: "Chrome",
          namespace: "t3_browser_external",
          status: "warning",
          reason: "chrome-extension-unpaired",
          reasonLabel: "Chrome 扩展未配对",
          summary: "等待 Chrome 扩展配对",
          detail: "需要把 Endpoint 与 Token 填入 Chrome 扩展弹窗。",
          actionLabel: "打开配对流程",
          lastError: null,
          updatedAt: "2026-06-30T00:00:00.000Z",
          lastToolCallAt: null,
        },
      ],
    );

    expect(mentions.find((mention) => mention.id === "Browser")?.health?.status).toBe("ready");
    expect(mentions.find((mention) => mention.id === "Chrome")?.health?.summary).toBe(
      "等待 Chrome 扩展配对",
    );
    expect(mentions.find((mention) => mention.id === "Chrome")?.health?.actionLabel).toBe(
      "打开配对流程",
    );
    expect(searchComposerPluginMentionList(mentions, "配对").map((mention) => mention.id)).toEqual([
      "Chrome",
    ]);
  });

  it("blocks plugin insertion when bridge health needs attention", () => {
    const chrome = attachComposerPluginMentionHealth(
      getVisibleComposerPluginMentions({ includeChrome: true }),
      [
        {
          id: "browser_use_external",
          label: "Chrome",
          namespace: "t3_browser_external",
          status: "warning",
          reason: "chrome-extension-unpaired",
          reasonLabel: "Chrome 扩展未配对",
          summary: "等待 Chrome 扩展配对",
          detail: "需要把 Endpoint 与 Token 填入 Chrome 扩展弹窗。",
          actionLabel: "打开配对流程",
          lastError: null,
          updatedAt: "2026-06-30T00:00:00.000Z",
          lastToolCallAt: null,
        },
      ],
    ).find((mention) => mention.id === "Chrome");

    expect(chrome).toBeDefined();
    expect(resolveComposerPluginMentionHealthBlock(chrome!)).toEqual({
      title: "Chrome 需要处理",
      description: "需要把 Endpoint 与 Token 填入 Chrome 扩展弹窗。 操作：打开配对流程。",
    });
  });

  it("blocks handwritten plugin mentions before send when bridge health needs attention", () => {
    const mentions = attachComposerPluginMentionHealth(
      getVisibleComposerPluginMentions({ includeChrome: true }),
      [
        {
          id: "browser_use",
          label: "Browser Use",
          namespace: "t3_browser",
          status: "ready",
          reason: "ready",
          reasonLabel: "状态正常",
          summary: "可直接使用",
          detail: "当前标签页：Local App",
          actionLabel: null,
          lastError: null,
          updatedAt: "2026-06-30T00:00:00.000Z",
          lastToolCallAt: null,
        },
        {
          id: "browser_use_external",
          label: "Chrome",
          namespace: "t3_browser_external",
          status: "warning",
          reason: "chrome-extension-unpaired",
          reasonLabel: "Chrome 扩展未配对",
          summary: "等待 Chrome 扩展配对",
          detail: "需要把 Endpoint 与 Token 填入 Chrome 扩展弹窗。",
          actionLabel: "打开配对流程",
          lastError: null,
          updatedAt: "2026-06-30T00:00:00.000Z",
          lastToolCallAt: null,
        },
      ],
    );

    expect(resolvePromptComposerPluginMentionHealthBlock("@Browser 打开网页", mentions)).toBeNull();
    expect(resolvePromptComposerPluginMentionHealthBlock("请用 @chrome 打开网页", mentions))
      .toMatchObject({
        mention: { id: "Chrome" },
        title: "Chrome 需要处理",
      });
    expect(resolvePromptComposerPluginMentionHealthBlock("解释 @ChromeDriver", mentions)).toBeNull();
  });
});
