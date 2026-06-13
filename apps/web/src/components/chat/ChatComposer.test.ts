import { describe, expect, it } from "vitest";

import { deriveComposerFooterVisibility } from "./composerFooterVisibility";

describe("deriveComposerFooterVisibility", () => {
  it("首页新建输入框不显示回复专属入口", () => {
    expect(
      deriveComposerFooterVisibility({
        composerSurface: "new-thread",
        hasPlanSidebarContent: true,
        planSidebarOpen: true,
        hasContextWindow: true,
      }),
    ).toEqual({
      showPlanSidebarToggle: false,
      showContextWindow: false,
    });
  });

  it("回复输入框有任务或侧栏打开时显示 Tasks/Plan 入口", () => {
    expect(
      deriveComposerFooterVisibility({
        composerSurface: "reply",
        hasPlanSidebarContent: true,
        planSidebarOpen: false,
        hasContextWindow: false,
      }).showPlanSidebarToggle,
    ).toBe(true);

    expect(
      deriveComposerFooterVisibility({
        composerSurface: "reply",
        hasPlanSidebarContent: false,
        planSidebarOpen: true,
        hasContextWindow: false,
      }).showPlanSidebarToggle,
    ).toBe(true);
  });

  it("回复输入框没有任务内容时不显示 Tasks/Plan 入口", () => {
    expect(
      deriveComposerFooterVisibility({
        composerSurface: "reply",
        hasPlanSidebarContent: false,
        planSidebarOpen: false,
        hasContextWindow: false,
      }).showPlanSidebarToggle,
    ).toBe(false);
  });

  it("context window 只在回复输入框显示", () => {
    expect(
      deriveComposerFooterVisibility({
        composerSurface: "reply",
        hasPlanSidebarContent: false,
        planSidebarOpen: false,
        hasContextWindow: true,
      }).showContextWindow,
    ).toBe(true);

    expect(
      deriveComposerFooterVisibility({
        composerSurface: "new-thread",
        hasPlanSidebarContent: false,
        planSidebarOpen: false,
        hasContextWindow: true,
      }).showContextWindow,
    ).toBe(false);
  });
});
