import {
  parseUnifiedDiff,
  type UnifiedDiffFilePatch,
  type UnifiedDiffHunk,
  type UnifiedDiffLine,
} from "../lib/unifiedDiff";

export type DiffRenderRow =
  | {
      kind: "hunk";
      id: string;
      hunk: UnifiedDiffHunk;
      index: number;
    }
  | {
      kind: "line";
      id: string;
      line: UnifiedDiffLine;
      oldLineNumber: number | null;
      newLineNumber: number | null;
    };

export function buildFileDiffRenderKey(fileDiff: UnifiedDiffFilePatch): string {
  return `${fileDiff.oldPath ?? "none"}:${fileDiff.newPath ?? "none"}`;
}

const PARSED_DIFF_CACHE_LIMIT = 24;
const parsedDiffCache = new Map<string, UnifiedDiffFilePatch[]>();
const fileLineCountCache = new WeakMap<UnifiedDiffFilePatch, number>();

export function parseRenderableUnifiedDiff(patch: string): UnifiedDiffFilePatch[] {
  const cached = parsedDiffCache.get(patch);
  if (cached) {
    parsedDiffCache.delete(patch);
    parsedDiffCache.set(patch, cached);
    return cached;
  }
  const parsed = parseUnifiedDiff(patch).filter((file) => file.hunks.length > 0);
  parsedDiffCache.set(patch, parsed);
  if (parsedDiffCache.size > PARSED_DIFF_CACHE_LIMIT) {
    const oldestKey = parsedDiffCache.keys().next().value;
    if (oldestKey !== undefined) {
      parsedDiffCache.delete(oldestKey);
    }
  }
  return parsed;
}

export function countFileDiffRenderLines(file: UnifiedDiffFilePatch): number {
  const cached = fileLineCountCache.get(file);
  if (cached !== undefined) {
    return cached;
  }
  let lineCount = 0;
  for (const hunk of file.hunks) {
    lineCount += 1 + hunk.lines.length;
  }
  fileLineCountCache.set(file, lineCount);
  return lineCount;
}

export function countExpandedDiffLines(
  files: ReadonlyArray<UnifiedDiffFilePatch>,
  collapsedFileKeys: ReadonlySet<string>,
): number {
  let lineCount = 0;
  for (const file of files) {
    if (collapsedFileKeys.has(buildFileDiffRenderKey(file))) {
      continue;
    }
    lineCount += countFileDiffRenderLines(file);
  }
  return lineCount;
}

export function buildDiffRenderRows(file: UnifiedDiffFilePatch): DiffRenderRow[] {
  const rows: DiffRenderRow[] = [];
  const fileKey = buildFileDiffRenderKey(file);
  file.hunks.forEach((hunk, hunkIndex) => {
    rows.push({
      kind: "hunk",
      id: `${fileKey}:hunk:${hunk.oldStart}:${hunk.newStart}:${hunkIndex}`,
      hunk,
      index: hunkIndex,
    });

    let oldLineNumber = hunk.oldStart;
    let newLineNumber = hunk.newStart;
    hunk.lines.forEach((line, lineIndex) => {
      const oldDisplay = line.type === "add" ? null : oldLineNumber;
      const newDisplay = line.type === "remove" ? null : newLineNumber;

      if (line.type !== "add") {
        oldLineNumber += 1;
      }
      if (line.type !== "remove") {
        newLineNumber += 1;
      }

      rows.push({
        kind: "line",
        id: `${fileKey}:line:${hunk.oldStart}:${hunk.newStart}:${lineIndex}`,
        line,
        oldLineNumber: oldDisplay,
        newLineNumber: newDisplay,
      });
    });
  });
  return rows;
}
