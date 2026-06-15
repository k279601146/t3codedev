import type { ServerProviderSkill } from "@t3tools/contracts";

function titleCaseWords(value: string): string {
  return value
    .split(/[\s:_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizePathSeparators(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

export function formatProviderSkillDisplayName(
  skill: Pick<ServerProviderSkill, "name" | "displayName">,
): string {
  const displayName = skill.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return titleCaseWords(skill.name);
}

export function mergeProviderSkillsForInlineDisplay(
  primarySkills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>,
  providerSkillGroups: ReadonlyArray<{
    skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  }>,
): ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> {
  const merged: Array<Pick<ServerProviderSkill, "name" | "displayName">> = [];
  const seenNames = new Set<string>();

  const appendSkills = (
    skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>,
  ) => {
    for (const skill of skills) {
      if (seenNames.has(skill.name)) {
        continue;
      }
      seenNames.add(skill.name);
      merged.push(skill);
    }
  };

  appendSkills(primarySkills);
  for (const provider of providerSkillGroups) {
    appendSkills(provider.skills);
  }

  return merged;
}

export function formatProviderSkillInstallSource(
  skill: Pick<ServerProviderSkill, "path" | "scope">,
): string | null {
  const normalizedPath = normalizePathSeparators(skill.path);
  if (normalizedPath.includes("/.codex/plugins/") || normalizedPath.includes("/.agents/plugins/")) {
    return "App";
  }

  const normalizedScope = skill.scope?.trim().toLowerCase();
  if (normalizedScope === "system") {
    return "System";
  }
  if (
    normalizedScope === "project" ||
    normalizedScope === "workspace" ||
    normalizedScope === "local"
  ) {
    return "Project";
  }
  if (normalizedScope === "user" || normalizedScope === "personal") {
    return "Personal";
  }
  if (normalizedScope) {
    return titleCaseWords(normalizedScope);
  }

  return null;
}
