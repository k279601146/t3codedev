export type PerformanceMode = "normal" | "scrolling" | "window-dragging" | "streaming-heavy" | "background";

const activeReasons = new Map<Exclude<PerformanceMode, "normal">, number>();

function applyPerformanceMode() {
  if (typeof document === "undefined") return;
  const nextMode = activeReasons.size === 0 ? "normal" : Array.from(activeReasons.keys())[0];
  document.body.dataset.performanceMode = nextMode;
  document.body.dataset.performanceLite = nextMode === "normal" ? "false" : "true";
}

export function setPerformanceModeActive(
  mode: Exclude<PerformanceMode, "normal">,
  active: boolean,
) {
  const count = activeReasons.get(mode) ?? 0;
  if (active) {
    activeReasons.set(mode, count + 1);
  } else if (count <= 1) {
    activeReasons.delete(mode);
  } else {
    activeReasons.set(mode, count - 1);
  }
  applyPerformanceMode();
}

export function resetPerformanceModeForTests() {
  activeReasons.clear();
  applyPerformanceMode();
}
