import { describe, expect, it } from "vitest";

import {
  buildProviderBaseEnvironment,
  mergeProviderInstanceEnvironment,
} from "./ProviderInstanceEnvironment.ts";

describe("buildProviderBaseEnvironment", () => {
  it("keeps runtime essentials and filters ambient provider secrets", () => {
    expect(
      buildProviderBaseEnvironment({
        PATH: "/bin",
        HOME: "/home/runner",
        MYIDE_ENGINE_PATH: "/opt/bahew/ai-engine",
        T3CODE_BROWSER_USE_TOKEN: "tool-token",
        OPENAI_API_KEY: "sk-openai-ambient",
        ANTHROPIC_API_KEY: "sk-ant-ambient",
        GITHUB_TOKEN: "ghp_ambient",
      }),
    ).toEqual({
      PATH: "/bin",
      HOME: "/home/runner",
      MYIDE_ENGINE_PATH: "/opt/bahew/ai-engine",
      T3CODE_BROWSER_USE_TOKEN: "tool-token",
    });
  });
});

describe("mergeProviderInstanceEnvironment", () => {
  it("overrides inherited environment values and preserves empty strings", () => {
    expect(
      mergeProviderInstanceEnvironment(
        [
          { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
        ],
        { ANTHROPIC_API_KEY: "inherited", PATH: "/bin" },
      ),
    ).toEqual({
      OPENROUTER_API_KEY: "sk-or-test",
      ANTHROPIC_API_KEY: "",
      PATH: "/bin",
    });
  });

  it("filters inherited provider secrets when no instance override is configured", () => {
    expect(
      mergeProviderInstanceEnvironment(undefined, {
        PATH: "/bin",
        OPENAI_API_KEY: "sk-openai-ambient",
      }),
    ).toEqual({
      PATH: "/bin",
    });
  });
});
