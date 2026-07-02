import type { OrchestrationGoal, OrchestrationGoalStatus } from "@t3tools/contracts";

export const GOAL_OBJECTIVE_MAX_CHARS = 4_000;

export function normalizeGoalObjective(value: string): string {
  return value.trim();
}

export function isValidGoalObjective(value: string): boolean {
  const normalized = normalizeGoalObjective(value);
  return normalized.length > 0 && normalized.length <= GOAL_OBJECTIVE_MAX_CHARS;
}

export function isGoalRunning(status: OrchestrationGoalStatus): boolean {
  return status === "active";
}

export function isGoalTerminal(status: OrchestrationGoalStatus): boolean {
  return (
    status === "blocked" ||
    status === "budgetLimited" ||
    status === "usageLimited" ||
    status === "complete"
  );
}

function readTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeGoalElapsedMs(goal: OrchestrationGoal, nowMs: number): number {
  const baseElapsedMs = Math.max(0, goal.elapsedMs);
  if (goal.status !== "active" || goal.activeSince === null) {
    return baseElapsedMs;
  }
  const activeSinceMs = readTimeMs(goal.activeSince);
  if (activeSinceMs === null || nowMs < activeSinceMs) {
    return baseElapsedMs;
  }
  return baseElapsedMs + (nowMs - activeSinceMs);
}

export function formatGoalDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function mergeGoalTiming(
  previousGoal: OrchestrationGoal | null | undefined,
  providerGoal: OrchestrationGoal,
  nowIso: string,
): OrchestrationGoal {
  const nowMs = readTimeMs(nowIso) ?? 0;
  const previousElapsedMs = previousGoal ? computeGoalElapsedMs(previousGoal, nowMs) : 0;
  const previousStartedAt = previousGoal ? previousGoal.startedAt : providerGoal.startedAt;

  if (providerGoal.status === "active") {
    return {
      ...providerGoal,
      startedAt: previousStartedAt,
      activeSince:
        previousGoal?.status === "active" && previousGoal.activeSince !== null
          ? previousGoal.activeSince
          : nowIso,
      elapsedMs: previousGoal?.status === "active" ? previousGoal.elapsedMs : previousElapsedMs,
      completedAt: null,
    };
  }

  const terminal = isGoalTerminal(providerGoal.status);
  return {
    ...providerGoal,
    startedAt: previousStartedAt,
    activeSince: null,
    elapsedMs: previousElapsedMs,
    completedAt:
      providerGoal.status === "complete"
        ? (previousGoal?.completedAt ?? providerGoal.completedAt ?? nowIso)
        : terminal
          ? (providerGoal.completedAt ?? null)
          : null,
  };
}
