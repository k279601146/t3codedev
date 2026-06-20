import type { UnifiedDiffFilePatch, UnifiedDiffHunk, UnifiedDiffLine } from "../lib/unifiedDiff";

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

export function countExpandedDiffLines(
  files: ReadonlyArray<UnifiedDiffFilePatch>,
  collapsedFileKeys: ReadonlySet<string>,
): number {
  let lineCount = 0;
  for (const file of files) {
    if (collapsedFileKeys.has(buildFileDiffRenderKey(file))) {
      continue;
    }
    for (const hunk of file.hunks) {
      lineCount += 1 + hunk.lines.length;
    }
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
