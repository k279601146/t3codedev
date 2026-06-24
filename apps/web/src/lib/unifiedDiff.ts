export interface UnifiedDiffFilePatch {
  oldPath: string | null;
  newPath: string | null;
  hunks: UnifiedDiffHunk[];
}

export interface UnifiedDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: UnifiedDiffLine[];
}

export type UnifiedDiffLine =
  | { type: "context"; text: string }
  | { type: "add"; text: string }
  | { type: "remove"; text: string };

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function normalizeDiffPath(value: string): string | null {
  if (value === "/dev/null") {
    return null;
  }
  const path = value.split(/\t|\s/)[0] ?? value;
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function readGitHeaderPath(value: string): string | null {
  return normalizeDiffPath(value.replace(/^"|"$/g, ""));
}

export function parseUnifiedDiff(diff: string): UnifiedDiffFilePatch[] {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const patches: UnifiedDiffFilePatch[] = [];
  let current: UnifiedDiffFilePatch | null = null;
  let currentHunk: UnifiedDiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const parts = line.slice("diff --git ".length).split(" ");
      current = {
        oldPath: readGitHeaderPath(parts[0] ?? ""),
        newPath: readGitHeaderPath(parts[1] ?? ""),
        hunks: [],
      };
      patches.push(current);
      currentHunk = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const hunkMatch = HUNK_HEADER_PATTERN.exec(line);
    if (hunkMatch) {
      currentHunk = {
        oldStart: Number(hunkMatch[1]),
        oldCount: Number(hunkMatch[2] ?? "1"),
        newStart: Number(hunkMatch[3]),
        newCount: Number(hunkMatch[4] ?? "1"),
        lines: [],
      };
      current.hunks.push(currentHunk);
      continue;
    }

    if (currentHunk) {
      if (line.startsWith("\\ No newline")) {
        continue;
      }
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " ") {
        currentHunk.lines.push({ type: "context", text });
      } else if (marker === "+") {
        currentHunk.lines.push({ type: "add", text });
      } else if (marker === "-") {
        currentHunk.lines.push({ type: "remove", text });
      }
      continue;
    }

    if (line.startsWith("--- ")) {
      current.oldPath = normalizeDiffPath(line.slice(4).trim());
      continue;
    }

    if (line.startsWith("+++ ")) {
      current.newPath = normalizeDiffPath(line.slice(4).trim());
      continue;
    }
  }

  return patches;
}

function splitTextIntoLines(text: string): { lines: string[]; finalNewline: boolean } {
  const finalNewline = text.endsWith("\n");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (finalNewline) {
    lines.pop();
  }
  return { lines, finalNewline };
}

function joinLines(lines: string[], finalNewline: boolean): string {
  const text = lines.join("\n");
  return finalNewline ? `${text}\n` : text;
}

export function reconstructOriginalFromModified(
  patch: UnifiedDiffFilePatch,
  modifiedContents: string,
): string {
  if (patch.oldPath === null) {
    return "";
  }

  const { lines: modifiedLines, finalNewline } = splitTextIntoLines(modifiedContents);
  const originalLines: string[] = [];
  let modifiedIndex = 0;

  for (const hunk of patch.hunks) {
    const hunkStart = Math.max(0, hunk.newStart - 1);
    while (modifiedIndex < hunkStart && modifiedIndex < modifiedLines.length) {
      originalLines.push(modifiedLines[modifiedIndex]!);
      modifiedIndex++;
    }

    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === "context") {
        originalLines.push(modifiedLines[modifiedIndex] ?? hunkLine.text);
        modifiedIndex++;
      } else if (hunkLine.type === "add") {
        modifiedIndex++;
      } else {
        originalLines.push(hunkLine.text);
      }
    }
  }

  while (modifiedIndex < modifiedLines.length) {
    originalLines.push(modifiedLines[modifiedIndex]!);
    modifiedIndex++;
  }

  return joinLines(originalLines, finalNewline);
}

export function getPatchDisplayPath(patch: UnifiedDiffFilePatch): string | null {
  return patch.newPath ?? patch.oldPath;
}
