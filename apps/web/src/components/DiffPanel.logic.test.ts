import { describe, expect, it } from "vitest";

import {
  countExpandedDiffLines,
  countFileDiffRenderLines,
  parseRenderableUnifiedDiff,
} from "./DiffPanel.logic";
import type { UnifiedDiffFilePatch } from "../lib/unifiedDiff";

function filePatch(path: string, lineCount: number): UnifiedDiffFilePatch {
  return {
    oldPath: path,
    newPath: path,
    hunks: [
      {
        oldStart: 1,
        oldCount: lineCount,
        newStart: 1,
        newCount: lineCount,
        lines: Array.from({ length: lineCount }, (_, index) => ({
          type: "context" as const,
          text: `line ${index + 1}`,
        })),
      },
    ],
  };
}

describe("countExpandedDiffLines", () => {
  it("counts hunk headers and diff lines for expanded files", () => {
    expect(
      countExpandedDiffLines([filePatch("src/a.ts", 3), filePatch("src/b.ts", 2)], new Set()),
    ).toBe(7);
  });

  it("skips collapsed files", () => {
    expect(
      countExpandedDiffLines(
        [filePatch("src/a.ts", 3), filePatch("src/b.ts", 2)],
        new Set(["src/a.ts:src/a.ts"]),
      ),
    ).toBe(3);
  });
});

describe("parseRenderableUnifiedDiff", () => {
  it("reuses parsed file objects for the same patch text", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    const first = parseRenderableUnifiedDiff(patch);
    const second = parseRenderableUnifiedDiff(patch);

    expect(first).toBe(second);
    expect(first).toHaveLength(1);
  });
});

describe("countFileDiffRenderLines", () => {
  it("counts hunk headers and lines for one file", () => {
    expect(countFileDiffRenderLines(filePatch("src/a.ts", 4))).toBe(5);
  });
});
