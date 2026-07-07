import { describe, expect, it } from "vitest";
import type { ProjectDirectoryTreeNode } from "@t3tools/contracts";

import { flattenVisibleFileTreeNodes } from "./CursorFileTree.logic";

const tree: ProjectDirectoryTreeNode[] = [
  {
    kind: "directory",
    name: "src",
    path: "src",
    children: [
      { kind: "file", name: "index.ts", path: "src/index.ts" },
      {
        kind: "directory",
        name: "components",
        path: "src/components",
        children: [{ kind: "file", name: "App.tsx", path: "src/components/App.tsx" }],
      },
    ],
  },
  { kind: "file", name: "README.md", path: "README.md" },
];

describe("flattenVisibleFileTreeNodes", () => {
  it("returns only visible nodes in tree order", () => {
    expect(
      flattenVisibleFileTreeNodes({
        nodes: tree,
        openDirectories: new Set(["src"]),
      }).map((entry) => [entry.node.path, entry.depth]),
    ).toEqual([
      ["src", 0],
      ["src/index.ts", 1],
      ["src/components", 1],
      ["README.md", 0],
    ]);
  });

  it("includes nested children when their parent directory is open", () => {
    expect(
      flattenVisibleFileTreeNodes({
        nodes: tree,
        openDirectories: new Set(["src", "src/components"]),
      }).map((entry) => [entry.node.path, entry.depth]),
    ).toEqual([
      ["src", 0],
      ["src/index.ts", 1],
      ["src/components", 1],
      ["src/components/App.tsx", 2],
      ["README.md", 0],
    ]);
  });
});
