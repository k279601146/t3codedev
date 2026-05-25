import { describe, expect, it } from "vitest";

import {
  RIGHT_PANEL_DEFAULT_WIDTH_PX,
  RIGHT_PANEL_MAX_WIDTH_PX,
  RIGHT_PANEL_MIN_WIDTH_PX,
  chooseDefaultRightPanelSurface,
  clampRightPanelWidth,
  isRightPanelSurface,
} from "./rightPanelStore";

describe("rightPanelStore", () => {
  it("校验右侧面板 surface 名称", () => {
    expect(isRightPanelSurface("review")).toBe(true);
    expect(isRightPanelSurface("summary")).toBe(true);
    expect(isRightPanelSurface("unknown")).toBe(false);
  });

  it("把右侧面板宽度限制在设计范围内", () => {
    expect(clampRightPanelWidth(RIGHT_PANEL_MIN_WIDTH_PX - 100)).toBe(RIGHT_PANEL_MIN_WIDTH_PX);
    expect(clampRightPanelWidth(RIGHT_PANEL_MAX_WIDTH_PX + 100)).toBe(RIGHT_PANEL_MAX_WIDTH_PX);
    expect(clampRightPanelWidth(Number.NaN)).toBe(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  });

  it("按线程上下文选择默认右侧面板", () => {
    expect(
      chooseDefaultRightPanelSurface({
        diffOpen: true,
        hasReviewChanges: false,
        hasSummary: true,
        hasArtifacts: true,
        terminalOpen: false,
      }),
    ).toBe("review");
    expect(
      chooseDefaultRightPanelSurface({
        diffOpen: false,
        hasReviewChanges: false,
        hasSummary: true,
        hasArtifacts: true,
        terminalOpen: false,
      }),
    ).toBe("summary");
    expect(
      chooseDefaultRightPanelSurface({
        diffOpen: false,
        hasReviewChanges: false,
        hasSummary: false,
        hasArtifacts: true,
        terminalOpen: false,
      }),
    ).toBe("artifacts");
  });
});
