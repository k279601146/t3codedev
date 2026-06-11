import { describe, expect, it } from "vitest";

import {
  appendComposerPluginLaunchContext,
  buildComposerPluginLaunchContext,
  stripTrailingComposerPluginLaunchContext,
} from "./composerPluginLaunch";
import { searchComposerPluginMentions } from "./composerPluginMentions";
import { promptUsesChromePlugin } from "./browserExternalPluginState";

describe("composerPluginLaunch", () => {
  it("adds launch context for built-in plugin mentions", () => {
    expect(buildComposerPluginLaunchContext("@Computer 截屏看看")).toContain(
      "@Computer: use T3 computer_use",
    );
    expect(buildComposerPluginLaunchContext("@Browser 打开 localhost:3000")).toContain(
      "@Browser: use the T3 in-app browser tools",
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

  it("hides Chrome suggestions until Browser Use External is installed", () => {
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
});
