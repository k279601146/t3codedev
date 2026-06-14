import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveClientLocale } from "./i18n";

describe("resolveClientLocale", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-detects Simplified Chinese from browser languages", () => {
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US", "zh-CN"],
    });

    expect(resolveClientLocale("system")).toBe("zh-CN");
  });

  it("falls back to English when browser languages are not Chinese", () => {
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US"],
    });

    expect(resolveClientLocale("system")).toBe("en");
  });

  it("uses the selected language before browser auto-detection", () => {
    vi.stubGlobal("navigator", {
      language: "zh-CN",
      languages: ["zh-CN"],
    });

    expect(resolveClientLocale("en")).toBe("en");
    expect(resolveClientLocale("zh-CN")).toBe("zh-CN");
  });
});
