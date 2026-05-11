import type { Project } from "../types";

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

export function getCursorProjectIdentity(project: Pick<Project, "environmentId" | "cwd">): string {
  return `${project.environmentId}:${normalizeProjectPath(project.cwd)}`;
}

export function dedupeCursorProjects<T extends Project>(projects: readonly T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const project of projects) {
    const identity = getCursorProjectIdentity(project);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push(project);
  }

  return deduped;
}
