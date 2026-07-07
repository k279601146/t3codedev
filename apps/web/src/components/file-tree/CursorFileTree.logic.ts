import type { ProjectDirectoryTreeNode } from "@t3tools/contracts";

export interface VisibleFileTreeNode {
  readonly node: ProjectDirectoryTreeNode;
  readonly depth: number;
}

export function flattenVisibleFileTreeNodes(input: {
  readonly nodes: ReadonlyArray<ProjectDirectoryTreeNode>;
  readonly openDirectories: ReadonlySet<string>;
  readonly depth?: number;
}): VisibleFileTreeNode[] {
  const depth = input.depth ?? 0;
  const visible: VisibleFileTreeNode[] = [];
  for (const node of input.nodes) {
    visible.push({ node, depth });
    if (node.kind === "directory" && input.openDirectories.has(node.path)) {
      visible.push(
        ...flattenVisibleFileTreeNodes({
          nodes: node.children ?? [],
          openDirectories: input.openDirectories,
          depth: depth + 1,
        }),
      );
    }
  }
  return visible;
}
