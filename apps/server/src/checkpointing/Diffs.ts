export interface TurnDiffFileSummary {
  readonly path: string;
  readonly kind: "added" | "deleted" | "renamed" | "modified";
  readonly additions: number;
  readonly deletions: number;
}

interface DiffFileSection {
  readonly lines: string[];
}

function splitDiffFileSections(diff: string): DiffFileSection[] {
  const sections: DiffFileSection[] = [];
  let currentLines: string[] = [];

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ") && currentLines.length > 0) {
      sections.push({ lines: currentLines });
      currentLines = [];
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sections.push({ lines: currentLines });
  }

  return sections;
}

function normalizeDiffPath(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (!trimmed || trimmed === "/dev/null") {
    return null;
  }
  const path = trimmed.split(/\t|\s/)[0] ?? trimmed;
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function readGitHeaderPaths(line: string): { oldPath: string | null; newPath: string | null } {
  const parts = line.slice("diff --git ".length).split(" ");
  return {
    oldPath: normalizeDiffPath(parts[0] ?? ""),
    newPath: normalizeDiffPath(parts[1] ?? ""),
  };
}

function summarizeDiffFileSection(section: DiffFileSection): TurnDiffFileSummary | null {
  const headerLine = section.lines.find((line) => line.startsWith("diff --git "));
  const headerPaths = headerLine
    ? readGitHeaderPaths(headerLine)
    : { oldPath: null, newPath: null };
  let oldPath = headerPaths.oldPath;
  let newPath = headerPaths.newPath;
  let sawNewFileMode = false;
  let sawDeletedFileMode = false;
  let sawRename = false;
  let additions = 0;
  let deletions = 0;
  let insideHunk = false;

  for (const line of section.lines) {
    if (line.startsWith("new file mode ")) {
      sawNewFileMode = true;
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      sawDeletedFileMode = true;
      continue;
    }
    if (line.startsWith("rename from ")) {
      sawRename = true;
      oldPath = normalizeDiffPath(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      sawRename = true;
      newPath = normalizeDiffPath(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      newPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("@@ ")) {
      insideHunk = true;
      continue;
    }
    if (!insideHunk || line.startsWith("\\ No newline")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  const path = newPath ?? oldPath;
  if (!path) {
    return null;
  }

  const kind =
    sawRename && oldPath !== newPath
      ? "renamed"
      : sawNewFileMode || oldPath === null
        ? "added"
        : sawDeletedFileMode || newPath === null
          ? "deleted"
          : "modified";

  return { path, kind, additions, deletions };
}

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const files = splitDiffFileSections(normalized)
    .map(summarizeDiffFileSection)
    .filter((file): file is TurnDiffFileSummary => file !== null);

  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}
