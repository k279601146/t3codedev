import type { EnvironmentApi } from "@t3tools/contracts";

type ProjectFileApi = {
  readonly projects: Pick<EnvironmentApi["projects"], "readFile" | "searchEntries">;
};

function hasDirectorySeparator(filePath: string): boolean {
  return /[\\/]/.test(filePath);
}

function basenameOfWorkspacePath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

async function resolveUniqueBareFileMatch(
  api: ProjectFileApi,
  cwd: string,
  filePath: string,
): Promise<string | null> {
  const query = filePath.trim();
  if (!query || query !== filePath || hasDirectorySeparator(query)) {
    return null;
  }

  const result = await api.projects.searchEntries({
    cwd,
    query,
    limit: 25,
  });
  const normalizedQuery = query.toLowerCase();
  const matchingPaths = [
    ...new Set(
      result.entries
        .filter(
          (entry) =>
            entry.kind === "file" &&
            basenameOfWorkspacePath(entry.path).toLowerCase() === normalizedQuery,
        )
        .map((entry) => entry.path),
    ),
  ];

  return matchingPaths.length === 1 ? (matchingPaths[0] ?? null) : null;
}

export async function readWorkspaceFileWithBareNameFallback(
  api: ProjectFileApi,
  cwd: string,
  filePath: string,
): Promise<string> {
  try {
    const result = await api.projects.readFile({
      cwd,
      relativePath: filePath,
    });
    return result.contents;
  } catch (error) {
    const fallbackPath = await resolveUniqueBareFileMatch(api, cwd, filePath).catch(() => null);
    if (!fallbackPath || fallbackPath === filePath) {
      throw error;
    }

    const result = await api.projects.readFile({
      cwd,
      relativePath: fallbackPath,
    });
    return result.contents;
  }
}
