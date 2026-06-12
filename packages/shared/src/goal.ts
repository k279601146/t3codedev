import type { OrchestrationGoalStatus } from "@t3tools/contracts";

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
