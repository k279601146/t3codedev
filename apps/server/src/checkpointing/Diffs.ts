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

function splitGitHeaderPathTokens(value: string): [string | undefined, string | undefined] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      current += char;
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return [tokens[0], tokens[1]];
}

function decodeGitQuotedPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  const content = value.slice(1, -1);
  const decoder = new TextDecoder();
  let decoded = "";
  let octalBytes: number[] = [];

  const flushOctalBytes = () => {
    if (octalBytes.length === 0) {
      return;
    }
    decoded += decoder.decode(new Uint8Array(octalBytes));
    octalBytes = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] ?? "";
    if (char !== "\\") {
      flushOctalBytes();
      decoded += char;
      continue;
    }

    const next = content[index + 1] ?? "";
    if (/^[0-7]$/u.test(next)) {
      const octal = content.slice(index + 1).match(/^[0-7]{1,3}/u)?.[0] ?? "";
      octalBytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    flushOctalBytes();
    index += 1;
    switch (next) {
      case "a":
        decoded += "\x07";
        break;
      case "b":
        decoded += "\b";
        break;
      case "f":
        decoded += "\f";
        break;
      case "n":
        decoded += "\n";
        break;
      case "r":
        decoded += "\r";
        break;
      case "t":
        decoded += "\t";
        break;
      case "v":
        decoded += "\v";
        break;
      case "":
        decoded += "\\";
        break;
      default:
        decoded += next;
        break;
    }
  }

  flushOctalBytes();
  return decoded;
}

function normalizeDiffPath(value: string): string | null {
  const rawTrimmed = value.trim();
  const decoded = decodeGitQuotedPath(rawTrimmed);
  const trimmed = rawTrimmed.startsWith('"') && rawTrimmed.endsWith('"')
    ? decoded
    : (decoded.split(/\t|\s/)[0] ?? decoded);
  if (!trimmed || trimmed === "/dev/null") {
    return null;
  }
  const path = trimmed;
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function readGitHeaderPaths(line: string): { oldPath: string | null; newPath: string | null } {
  const parts = splitGitHeaderPathTokens(line.slice("diff --git ".length));
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
