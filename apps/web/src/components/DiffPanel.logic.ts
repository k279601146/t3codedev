import {
  parseUnifiedDiff,
  type UnifiedDiffFilePatch,
  type UnifiedDiffHunk,
  type UnifiedDiffLine,
} from "../lib/unifiedDiff";
import { buildPatchCacheKey } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";

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
const PARSED_DIFF_CACHE_MEMORY_BYTES = 24 * 1024 * 1024;
const parsedDiffCache = new LRUCache<UnifiedDiffFilePatch[]>(
  PARSED_DIFF_CACHE_LIMIT,
  PARSED_DIFF_CACHE_MEMORY_BYTES,
);
const fileLineCountCache = new WeakMap<UnifiedDiffFilePatch, number>();

function estimateParsedDiffSize(patch: string, files: ReadonlyArray<UnifiedDiffFilePatch>): number {
  let lineTextLength = 0;
  let lineCount = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      lineCount += 1;
      for (const line of hunk.lines) {
        lineCount += 1;
        lineTextLength += line.text.length;
      }
    }
  }
  return patch.length * 2 + lineTextLength * 2 + lineCount * 96 + files.length * 512;
}

export function parseRenderableUnifiedDiff(patch: string): UnifiedDiffFilePatch[] {
  const cacheKey = buildPatchCacheKey(patch, "renderable-diff");
  const cached = parsedDiffCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const parsed = parseUnifiedDiff(patch).filter((file) => file.hunks.length > 0);
  const approximateSize = estimateParsedDiffSize(patch, parsed);
  if (approximateSize <= PARSED_DIFF_CACHE_MEMORY_BYTES) {
    parsedDiffCache.set(cacheKey, parsed, approximateSize);
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
