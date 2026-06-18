import { describe, expect, it } from "vitest";

import {
  buildIdleSuggestions,
  IDLE_SUGGESTION_DELAY_MS,
} from "./NewThreadLauncherSuggestions";

describe("NewThreadLauncherSuggestions", () => {
  it("延迟到 90 秒后再显示闲置建议", () => {
    expect(IDLE_SUGGESTION_DELAY_MS).toBe(90_000);
  });

  it("优先展示已经安装的内置插件能力", () => {
    const suggestions = buildIdleSuggestions({
      skills: [],
      plugins: {
        pptMasterInstalled: true,
        agentReachInstalled: true,
      },
      count: 2,
      random: () => 0.999,
    });

    expect(suggestions).toEqual([
      "$ppt-master 请把这个主题制作成一份结构完整、可编辑的演示文稿。主题：",
      "$agent-reach 请围绕这个主题做公开资料调研，输出来源链接、关键事实和后续问题。主题：",
    ]);
  });

  it("根据当前 provider skill 生成可直接执行的建议", () => {
    const suggestions = buildIdleSuggestions({
      skills: [
        {
          name: "gh-fix-ci",
          displayName: "GitHub CI Fixer",
          shortDescription: "Review failing CI and suggest tests",
          description: undefined,
        },
      ],
      plugins: {
        pptMasterInstalled: false,
        agentReachInstalled: false,
      },
      count: 1,
      random: () => 0.999,
    });

    expect(suggestions).toEqual([
      "$gh-fix-ci 请审查当前改动，按严重程度列出问题、测试缺口和建议。",
    ]);
  });

  it("能力数据不足时使用更贴近 IDE 的默认任务兜底", () => {
    const suggestions = buildIdleSuggestions({
      skills: [],
      plugins: {
        pptMasterInstalled: false,
        agentReachInstalled: false,
      },
      count: 3,
      random: () => 0.999,
    });

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toContain("当前项目");
    expect(suggestions[1]).toContain("最近的代码改动");
  });
});
