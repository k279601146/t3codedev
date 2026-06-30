export type PerformanceMode = "normal" | "scrolling" | "window-dragging" | "streaming-heavy" | "background";

const activeReasons = new Map<Exclude<PerformanceMode, "normal">, number>();
const subscribers = new Set<() => void>();

function resolvePerformanceMode(): PerformanceMode {
  return activeReasons.size === 0 ? "normal" : Array.from(activeReasons.keys())[0];
}

function applyPerformanceMode() {
  if (typeof document === "undefined") return;
  const nextMode = resolvePerformanceMode();
  document.body.dataset.performanceMode = nextMode;
  document.body.dataset.performanceLite = nextMode === "normal" ? "false" : "true";
  for (const subscriber of subscribers) {
    subscriber();
  }
}

export function getPerformanceModeSnapshot(): PerformanceMode {
  return resolvePerformanceMode();
}

export function subscribePerformanceMode(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
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
  subscribers.clear();
  applyPerformanceMode();
}
