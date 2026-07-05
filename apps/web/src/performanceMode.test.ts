import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPerformanceModeSnapshot,
  resetPerformanceModeForTests,
  setPerformanceModeActive,
  subscribePerformanceMode,
} from "./performanceMode";

beforeEach(() => {
  const body = {
    dataset: {} as Record<string, string>,
    removeAttribute(name: string) {
      if (name === "data-performance-mode") {
        delete this.dataset.performanceMode;
      }
      if (name === "data-performance-lite") {
        delete this.dataset.performanceLite;
      }
    },
  };
  vi.stubGlobal("document", { body });
  resetPerformanceModeForTests();
});

afterEach(() => {
  resetPerformanceModeForTests();
  document.body.removeAttribute("data-performance-mode");
  document.body.removeAttribute("data-performance-lite");
  vi.unstubAllGlobals();
});

describe("performance mode", () => {
  it("keeps lightweight mode active until every reason is released", () => {
    setPerformanceModeActive("scrolling", true);
    setPerformanceModeActive("window-dragging", true);

    expect(document.body.dataset.performanceLite).toBe("true");
    expect(document.body.dataset.performanceMode).toBe("scrolling");

    setPerformanceModeActive("scrolling", false);

    expect(document.body.dataset.performanceLite).toBe("true");
    expect(document.body.dataset.performanceMode).toBe("window-dragging");

    setPerformanceModeActive("window-dragging", false);

    expect(document.body.dataset.performanceLite).toBe("false");
    expect(document.body.dataset.performanceMode).toBe("normal");
  });

  it("balances repeated activation of the same reason", () => {
    setPerformanceModeActive("scrolling", true);
    setPerformanceModeActive("scrolling", true);
    setPerformanceModeActive("scrolling", false);

    expect(document.body.dataset.performanceLite).toBe("true");
    expect(document.body.dataset.performanceMode).toBe("scrolling");

    setPerformanceModeActive("scrolling", false);

    expect(document.body.dataset.performanceLite).toBe("false");
    expect(document.body.dataset.performanceMode).toBe("normal");
  });

  it("supports streaming-heavy as a lightweight performance reason", () => {
    setPerformanceModeActive("streaming-heavy", true);

    expect(document.body.dataset.performanceLite).toBe("true");
    expect(document.body.dataset.performanceMode).toBe("streaming-heavy");

    setPerformanceModeActive("streaming-heavy", false);

    expect(document.body.dataset.performanceLite).toBe("false");
    expect(document.body.dataset.performanceMode).toBe("normal");
  });

  it("notifies subscribers when the active mode changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePerformanceMode(listener);

    setPerformanceModeActive("scrolling", true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPerformanceModeSnapshot()).toBe("scrolling");

    unsubscribe();
    setPerformanceModeActive("scrolling", false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPerformanceModeSnapshot()).toBe("normal");
  });
});
