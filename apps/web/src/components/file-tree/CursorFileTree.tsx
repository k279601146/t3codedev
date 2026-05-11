import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import type { EnvironmentId, ProjectDirectoryTreeNode } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { useFileTree } from "../../hooks/useFileTree";
import { cn } from "../../lib/utils";
import { useEditorStore } from "../../editorStore";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

interface CursorFileTreeProps {
  projectKey: string;
  title: string;
  subtitle: string;
  environmentId: EnvironmentId;
  workspaceRoot: string;
  collapsed: boolean;
  onToggleProject: () => void;
  onRemoveProject: () => void;
  onOpenFile: (filePath: string) => void;
}

export function CursorFileTree({
  projectKey,
  title,
  subtitle,
  environmentId,
  workspaceRoot,
  collapsed,
  onToggleProject,
  onRemoveProject,
  onOpenFile,
}: CursorFileTreeProps) {
  const { data, error, isLoading, isFetching, isPending, refetch } = useFileTree(
    environmentId,
    collapsed ? null : workspaceRoot,
  );
  const root = data?.tree ?? null;
  const activeTabPath = useEditorStore(
    (state) =>
      state.tabs.find(
        (tab) =>
          tab.id === state.activeTabId &&
          tab.environmentId === environmentId &&
          tab.workspaceRoot === workspaceRoot,
      )?.filePath ?? null,
  );
  const [openDirectories, setOpenDirectories] = useState<ReadonlySet<string>>(() => new Set());
  const rootPath = root?.path ?? "";

  useEffect(() => {
    if (!rootPath) {
      return;
    }
    setOpenDirectories((current) => {
      if (current.has(rootPath)) {
        return current;
      }
      return new Set([...current, rootPath]);
    });
  }, [rootPath]);

  const renderedNodes = useMemo(() => root?.children ?? [], [root?.children]);

  return (
    <section className="border-b border-border last:border-b-0" data-project-key={projectKey}>
      <div className="flex min-h-10 items-center gap-1 border-b border-border/70 px-2">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
          onClick={onToggleProject}
          aria-label={collapsed ? "Expand project tree" : "Collapse project tree"}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
          onClick={() => void refetch()}
          disabled={collapsed || isFetching}
          aria-label="Refresh file tree"
        >
          <RefreshCwIcon className={cn("size-3", isFetching ? "animate-spin" : "")} />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
          onClick={onRemoveProject}
          aria-label="Remove from file tree"
        >
          <XIcon className="size-3" />
        </Button>
      </div>

      {collapsed ? null : (
        <div className="py-1">
          {root ? (
            renderedNodes.length > 0 ? (
              renderedNodes.map((node) => (
                <CursorFileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  activeTabPath={activeTabPath}
                  openDirectories={openDirectories}
                  setOpenDirectories={setOpenDirectories}
                  onOpenFile={onOpenFile}
                />
              ))
            ) : (
              <div className="px-4 py-3 text-xs text-muted-foreground">No files</div>
            )
          ) : error ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              <div>Could not load file tree.</div>
              <button
                type="button"
                className="mt-1 text-foreground underline decoration-transparent underline-offset-2 hover:decoration-current"
                onClick={() => void refetch()}
              >
                Retry
              </button>
            </div>
          ) : isLoading || isPending || isFetching ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">Loading files...</div>
          ) : (
            <div className="px-4 py-3 text-xs text-muted-foreground">No files found</div>
          )}
          {data?.truncated ? (
            <div className="border-t border-border/70 px-3 py-1 text-[11px] text-muted-foreground">
              Tree truncated for performance.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CursorFileTreeNode({
  node,
  depth,
  activeTabPath,
  openDirectories,
  setOpenDirectories,
  onOpenFile,
}: {
  node: ProjectDirectoryTreeNode;
  depth: number;
  activeTabPath: string | null;
  openDirectories: ReadonlySet<string>;
  setOpenDirectories: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  onOpenFile: (filePath: string) => void;
}) {
  const isFolder = node.kind === "directory";
  const isOpen = isFolder && openDirectories.has(node.path);
  const isSelected = node.kind === "file" && node.path === activeTabPath;

  return (
    <>
      <button
        type="button"
        className={cn(
          "flex h-7 w-full items-center gap-1.5 text-left text-xs outline-none transition-colors",
          isSelected
            ? "bg-accent/70 text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
        style={{ paddingLeft: 10 + depth * 12 }}
        onClick={() => {
          if (!isFolder) {
            onOpenFile(node.path);
            return;
          }
          setOpenDirectories((current) => {
            const next = new Set(current);
            if (next.has(node.path)) {
              next.delete(node.path);
            } else {
              next.add(node.path);
            }
            return next;
          });
        }}
      >
        <span className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground/70">
          {isFolder ? (
            isOpen ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )
          ) : null}
        </span>
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          {isFolder ? (
            isOpen ? (
              <FolderOpenIcon className="size-3.5" />
            ) : (
              <FolderIcon className="size-3.5" />
            )
          ) : (
            <FileTextIcon className="size-3.5" />
          )}
        </span>
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {isFolder && isOpen
        ? (node.children ?? []).map((child) => (
            <CursorFileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeTabPath={activeTabPath}
              openDirectories={openDirectories}
              setOpenDirectories={setOpenDirectories}
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </>
  );
}
