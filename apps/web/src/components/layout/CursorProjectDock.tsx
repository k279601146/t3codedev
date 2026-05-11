import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, FolderPlusIcon, PanelTopOpenIcon } from "lucide-react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCommandPaletteStore } from "../../commandPaletteStore";
import { readEnvironmentApi } from "../../environmentApi";
import { newCommandId } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsForProjectRef,
  useStore,
} from "../../store";
import type { Project } from "../../types";
import { useCursorLayoutStore } from "../../cursorLayoutStore";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ProjectFavicon } from "../ProjectFavicon";

export const CURSOR_PROJECT_DRAG_TYPE = "application/x-t3code-project-key";

async function removeProject(project: Project): Promise<void> {
  const projectRef = scopeProjectRef(project.environmentId, project.id);
  const api = readLocalApi();
  const threads = selectSidebarThreadsForProjectRef(useStore.getState(), projectRef);
  const confirmMessage =
    threads.length > 0
      ? [
          `Remove project "${project.name}" and delete its ${threads.length} thread${
            threads.length === 1 ? "" : "s"
          }?`,
          `Path: ${project.cwd}`,
          "This removes only this project entry and clears its conversation history.",
        ].join("\n")
      : [`Remove project "${project.name}"?`, `Path: ${project.cwd}`].join("\n");
  const confirmed = api
    ? await api.dialogs.confirm(confirmMessage)
    : window.confirm(confirmMessage);
  if (!confirmed) {
    return;
  }

  const environmentApi = readEnvironmentApi(project.environmentId);
  if (!environmentApi) {
    throw new Error("Project API unavailable.");
  }

  await environmentApi.orchestration.dispatchCommand({
    type: "project.delete",
    commandId: newCommandId(),
    projectId: project.id,
    ...(threads.length > 0 ? { force: true } : {}),
  });
}

export function CursorProjectDock() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const openAddProject = useCommandPaletteStore((state) => state.openAddProject);
  const pinProject = useCursorLayoutStore((state) => state.pinProject);
  const collapsed = useCursorLayoutStore((state) => state.projectDockCollapsed);
  const setCollapsed = useCursorLayoutStore((state) => state.setProjectDockCollapsed);
  const pinnedProjectKeys = useCursorLayoutStore((state) => state.pinnedProjectKeys);
  const pinnedProjectKeySet = useMemo(() => new Set(pinnedProjectKeys), [pinnedProjectKeys]);

  return (
    <div className="flex max-h-[45%] flex-none flex-col border-t border-border bg-background">
      <div className="flex h-9 min-h-9 items-center gap-2 px-2">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand projects" : "Collapse projects"}
        >
          {collapsed ? (
            <ChevronUpIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </Button>
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          Projects
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
          onClick={() => openAddProject()}
          aria-label="Add project"
        >
          <FolderPlusIcon className="size-3.5" />
        </Button>
      </div>

      {collapsed ? null : (
        <div className="min-h-0 overflow-y-auto px-1 pb-2">
          {projects.length > 0 ? (
            projects.map((project) => {
              const projectRef = scopeProjectRef(project.environmentId, project.id);
              const projectKey = scopedProjectKey(projectRef);
              return (
                <CursorProjectDockRow
                  key={projectKey}
                  project={project}
                  projectRef={projectRef}
                  projectKey={projectKey}
                  pinned={pinnedProjectKeySet.has(projectKey)}
                  onPin={() => pinProject(projectKey)}
                />
              );
            })
          ) : (
            <div className="px-3 py-3 text-xs text-muted-foreground">No projects</div>
          )}
        </div>
      )}
    </div>
  );
}

function CursorProjectDockRow({
  project,
  projectRef,
  projectKey,
  pinned,
  onPin,
}: {
  project: Project;
  projectRef: ScopedProjectRef;
  projectKey: string;
  pinned: boolean;
  onPin: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      className="group flex h-9 w-full cursor-grab items-center gap-2 rounded-sm px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onPin}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(CURSOR_PROJECT_DRAG_TYPE, projectKey);
        event.dataTransfer.setData("text/plain", project.cwd);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void showProjectContextMenu({
          project,
          projectRef,
          position: { x: event.clientX, y: event.clientY },
          onPin,
        });
      }}
    >
      <ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{project.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{project.cwd}</span>
      </span>
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {pinned ? (
          <PanelTopOpenIcon className="size-3.5 text-foreground" />
        ) : (
          <FolderPlusIcon className="size-3.5" />
        )}
      </span>
    </button>
  );
}

async function showProjectContextMenu({
  project,
  position,
  onPin,
}: {
  project: Project;
  projectRef: ScopedProjectRef;
  position: { x: number; y: number };
  onPin: () => void;
}) {
  const api = readLocalApi();
  const action = api
    ? await api.contextMenu.show(
        [
          { id: "pin", label: "Add to file tree" },
          { id: "copy-path", label: "Copy Project Path" },
          { id: "remove", label: "Remove project", destructive: true },
        ],
        position,
      )
    : window.prompt("Type pin, copy, or remove")?.trim();

  if (!action) {
    return;
  }

  if (action === "pin") {
    onPin();
    return;
  }

  if (action === "copy-path") {
    await navigator.clipboard?.writeText(project.cwd);
    toastManager.add({
      type: "success",
      title: "Path copied",
      description: project.cwd,
    });
    return;
  }

  if (action !== "remove") {
    return;
  }

  try {
    await removeProject(project);
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: `Failed to remove "${project.name}"`,
        description: error instanceof Error ? error.message : "Unknown error removing project.",
      }),
    );
  }
}
