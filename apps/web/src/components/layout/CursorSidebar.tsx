import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { useParams } from "@tanstack/react-router";
import { FolderPlusIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import {
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectThreadByRef,
  useStore,
} from "../../store";
import { useComposerDraftStore } from "../../composerDraftStore";
import { CursorFileTree } from "../file-tree/CursorFileTree";
import { getEditorLanguage, useEditorStore } from "../../editorStore";
import { toastManager } from "../ui/toast";
import { useCursorLayoutStore } from "../../cursorLayoutStore";
import { readEnvironmentApi } from "../../environmentApi";
import { Button } from "../ui/button";
import { useCommandPaletteStore } from "../../commandPaletteStore";
import { cn } from "../../lib/utils";
import { CURSOR_PROJECT_DRAG_TYPE, CursorProjectDock } from "./CursorProjectDock";
import type { Project } from "../../types";

export function CursorSidebar() {
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const serverThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const draftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const serverThread = useStore((state) =>
    serverThreadRef ? selectThreadByRef(state, serverThreadRef) : undefined,
  );
  const draftSession = useComposerDraftStore((state) =>
    draftId ? state.getDraftSession(draftId) : null,
  );
  const projectRef = draftSession
    ? scopeProjectRef(draftSession.environmentId, draftSession.projectId)
    : serverThread
      ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
      : null;
  const activeProject = useStore((state) =>
    projectRef ? selectProjectByRef(state, projectRef) : undefined,
  );
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const projectByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project,
        ]),
      ),
    [projects],
  );
  const pinnedProjectKeys = useCursorLayoutStore((state) => state.pinnedProjectKeys);
  const collapsedPinnedProjectKeys = useCursorLayoutStore(
    (state) => state.collapsedPinnedProjectKeys,
  );
  const pinProject = useCursorLayoutStore((state) => state.pinProject);
  const unpinProject = useCursorLayoutStore((state) => state.unpinProject);
  const setPinnedProjects = useCursorLayoutStore((state) => state.setPinnedProjects);
  const togglePinnedProject = useCursorLayoutStore((state) => state.togglePinnedProject);
  const openAddProject = useCommandPaletteStore((state) => state.openAddProject);
  const openFile = useEditorStore((state) => state.openFile);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const [isProjectDropActive, setIsProjectDropActive] = useState(false);
  const pinnedProjects = useMemo(
    () => pinnedProjectKeys.flatMap((projectKey) => projectByKey.get(projectKey) ?? []),
    [pinnedProjectKeys, projectByKey],
  );

  useEffect(() => {
    const availableProjectKeys = new Set(projectByKey.keys());
    const retainedProjectKeys = pinnedProjectKeys.filter((projectKey) =>
      availableProjectKeys.has(projectKey),
    );
    if (retainedProjectKeys.length !== pinnedProjectKeys.length) {
      setPinnedProjects(retainedProjectKeys);
    }
  }, [pinnedProjectKeys, projectByKey, setPinnedProjects]);

  useEffect(() => {
    if (pinnedProjectKeys.length > 0 || !activeProject) {
      return;
    }
    pinProject(scopedProjectKey(scopeProjectRef(activeProject.environmentId, activeProject.id)));
  }, [activeProject, pinProject, pinnedProjectKeys.length]);

  const handleOpenFile = useCallback(
    async (project: Project, filePath: string) => {
      const existing = useEditorStore
        .getState()
        .tabs.find(
          (tab) =>
            tab.environmentId === project.environmentId &&
            tab.workspaceRoot === project.cwd &&
            tab.filePath === filePath,
        );
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      try {
        const api = readEnvironmentApi(project.environmentId);
        if (!api) {
          throw new Error("Workspace API is unavailable.");
        }
        const result = await api.projects.readFile({
          cwd: project.cwd,
          relativePath: filePath,
        });
        openFile({
          environmentId: project.environmentId,
          workspaceRoot: project.cwd,
          filePath,
          fileName: filePath.split(/[\\/]/).at(-1) ?? filePath,
          language: getEditorLanguage(filePath),
          contents: result.contents,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not open file",
          description: error instanceof Error ? error.message : "The file could not be loaded.",
        });
      }
    },
    [openFile, setActiveTab],
  );

  const pinProjectFromDragEvent = useCallback(
    (event: React.DragEvent) => {
      const projectKey = event.dataTransfer.getData(CURSOR_PROJECT_DRAG_TYPE);
      if (!projectKey || !projectByKey.has(projectKey)) {
        return false;
      }
      pinProject(projectKey);
      return true;
    },
    [pinProject, projectByKey],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto border-b border-border transition-colors",
          isProjectDropActive ? "bg-accent/30" : "",
        )}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes(CURSOR_PROJECT_DRAG_TYPE)) {
            event.preventDefault();
            setIsProjectDropActive(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(CURSOR_PROJECT_DRAG_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsProjectDropActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsProjectDropActive(false);
          pinProjectFromDragEvent(event);
        }}
      >
        <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border bg-background/95 px-2 backdrop-blur">
          <div className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            Explorer
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

        {pinnedProjects.length > 0 ? (
          pinnedProjects.map((project) => {
            const projectKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
            return (
              <CursorFileTree
                key={projectKey}
                projectKey={projectKey}
                title={project.name}
                subtitle={project.cwd}
                environmentId={project.environmentId}
                workspaceRoot={project.cwd}
                collapsed={collapsedPinnedProjectKeys[projectKey] ?? false}
                onToggleProject={() => togglePinnedProject(projectKey)}
                onRemoveProject={() => unpinProject(projectKey)}
                onOpenFile={(filePath) => {
                  void handleOpenFile(project, filePath);
                }}
              />
            );
          })
        ) : (
          <div className="flex min-h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Drag projects here or right-click a project below to add it to the file tree.
          </div>
        )}
      </div>
      <CursorProjectDock />
    </div>
  );
}
