import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { useParams } from "@tanstack/react-router";
import { FolderPlusIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
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
import { dedupeCursorProjects, getCursorProjectIdentity } from "../../lib/cursorProjects";
import {
  ensureCursorProjectForPath,
  getExternalFolderPathsFromDrop,
  hasExternalFolderDrop,
} from "../../lib/cursorExternalProjects";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { CURSOR_PROJECT_DRAG_TYPE, CursorProjectDock } from "./CursorProjectDock";
import type { Project } from "../../types";

const PROJECT_DOCK_MIN_HEIGHT_PX = 112;
const PROJECT_DOCK_MAX_HEIGHT_RATIO = 0.82;
const PROJECT_DOCK_AUTO_RESIZE_THRESHOLD_PX = 6;

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
  const visibleProjects = useMemo(() => dedupeCursorProjects(projects), [projects]);
  const projectByKey = useMemo(
    () =>
      new Map(
        visibleProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project,
        ]),
      ),
    [visibleProjects],
  );
  const pinnedProjectKeys = useCursorLayoutStore((state) => state.pinnedProjectKeys);
  const collapsedPinnedProjectKeys = useCursorLayoutStore(
    (state) => state.collapsedPinnedProjectKeys,
  );
  const pendingPinnedProjectKeys = useCursorLayoutStore((state) => state.pendingPinnedProjectKeys);
  const pinProject = useCursorLayoutStore((state) => state.pinProject);
  const unpinProject = useCursorLayoutStore((state) => state.unpinProject);
  const setPinnedProjects = useCursorLayoutStore((state) => state.setPinnedProjects);
  const togglePinnedProject = useCursorLayoutStore((state) => state.togglePinnedProject);
  const openAddProject = useCommandPaletteStore((state) => state.openAddProject);
  const openFile = useEditorStore((state) => state.openFile);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [isProjectDropActive, setIsProjectDropActive] = useState(false);
  const [hiddenActiveProjectKeys, setHiddenActiveProjectKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const projectDockPanelRef = useRef<PanelImperativeHandle | null>(null);
  const activeProjectKey = activeProject
    ? scopedProjectKey(scopeProjectRef(activeProject.environmentId, activeProject.id))
    : null;
  const pinnedProjects = useMemo(
    () => pinnedProjectKeys.flatMap((projectKey) => projectByKey.get(projectKey) ?? []),
    [pinnedProjectKeys, projectByKey],
  );
  const pinProjectInExplorer = useCallback(
    (projectKey: string) => {
      setHiddenActiveProjectKeys((current) => {
        if (!current.has(projectKey)) {
          return current;
        }
        const next = new Set(current);
        next.delete(projectKey);
        return next;
      });
      pinProject(projectKey);
    },
    [pinProject],
  );
  const removeProjectFromExplorer = useCallback(
    (projectKey: string) => {
      setHiddenActiveProjectKeys((current) => {
        if (current.has(projectKey)) {
          return current;
        }
        return new Set([...current, projectKey]);
      });
      unpinProject(projectKey);
    },
    [unpinProject],
  );
  const explorerProjects = useMemo(() => {
    const nextProjects = [...pinnedProjects];
    if (
      activeProject &&
      activeProjectKey &&
      !hiddenActiveProjectKeys.has(activeProjectKey) &&
      !nextProjects.some(
        (project) => getCursorProjectIdentity(project) === getCursorProjectIdentity(activeProject),
      )
    ) {
      nextProjects.unshift(activeProject);
    }
    return dedupeCursorProjects(nextProjects);
  }, [activeProject, activeProjectKey, hiddenActiveProjectKeys, pinnedProjects]);

  useEffect(() => {
    const availableProjectKeys = new Set(projectByKey.keys());
    const retainedProjectKeys: string[] = [];
    const retainedProjectIdentities = new Set<string>();
    for (const projectKey of pinnedProjectKeys) {
      const project = projectByKey.get(projectKey);
      if (!project || !availableProjectKeys.has(projectKey)) {
        const pinnedAt = pendingPinnedProjectKeys[projectKey];
        if (typeof pinnedAt === "number" && Date.now() - pinnedAt < 15_000) {
          retainedProjectKeys.push(projectKey);
        }
        continue;
      }
      const projectIdentity = getCursorProjectIdentity(project);
      if (retainedProjectIdentities.has(projectIdentity)) {
        continue;
      }
      retainedProjectIdentities.add(projectIdentity);
      retainedProjectKeys.push(projectKey);
    }
    if (retainedProjectKeys.length !== pinnedProjectKeys.length) {
      setPinnedProjects(retainedProjectKeys);
    }
  }, [pendingPinnedProjectKeys, pinnedProjectKeys, projectByKey, setPinnedProjects]);

  useEffect(() => {
    if (pinnedProjectKeys.length > 0 || !activeProject || !activeProjectKey) {
      return;
    }
    if (hiddenActiveProjectKeys.has(activeProjectKey)) {
      return;
    }
    pinProjectInExplorer(activeProjectKey);
  }, [
    activeProject,
    activeProjectKey,
    hiddenActiveProjectKeys,
    pinProjectInExplorer,
    pinnedProjectKeys.length,
  ]);

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
      pinProjectInExplorer(projectKey);
      return true;
    },
    [pinProjectInExplorer, projectByKey],
  );

  const addExternalProjectsFromDrop = useCallback(
    async (event: React.DragEvent) => {
      if (!primaryEnvironmentId) {
        toastManager.add({
          type: "error",
          title: "Could not add dropped folder",
          description: "No local environment is available.",
        });
        return false;
      }

      const paths = getExternalFolderPathsFromDrop(event);
      if (paths.length === 0) {
        toastManager.add({
          type: "error",
          title: "Could not add dropped folder",
          description: "The desktop drag payload did not include a folder path.",
        });
        return false;
      }

      await Promise.all(
        paths.map((rawPath) =>
          ensureCursorProjectForPath({
            environmentId: primaryEnvironmentId,
            rawPath,
            projects,
            pinToExplorer: true,
          }),
        ),
      );
      toastManager.add({
        type: "success",
        title: paths.length === 1 ? "Project added to Explorer" : "Projects added to Explorer",
      });
      return true;
    },
    [primaryEnvironmentId, projects],
  );

  const resizeProjectDockToContent = useCallback((contentHeight: number) => {
    const panel = projectDockPanelRef.current;
    if (!panel || !Number.isFinite(contentHeight) || contentHeight <= 0) {
      return;
    }

    const currentSize = panel.getSize();
    if (currentSize.asPercentage <= 0 || currentSize.inPixels <= 0) {
      return;
    }

    const groupHeight = currentSize.inPixels / (currentSize.asPercentage / 100);
    if (!Number.isFinite(groupHeight) || groupHeight <= 0) {
      return;
    }

    const maxHeight = Math.floor(groupHeight * PROJECT_DOCK_MAX_HEIGHT_RATIO);
    const targetHeight = Math.min(
      Math.max(Math.ceil(contentHeight), PROJECT_DOCK_MIN_HEIGHT_PX),
      maxHeight,
    );

    if (targetHeight > currentSize.inPixels + PROJECT_DOCK_AUTO_RESIZE_THRESHOLD_PX) {
      panel.resize(`${targetHeight}px`);
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Group id="cursor-sidebar-panels" className="h-full min-h-0" orientation="vertical">
        <Panel
          id="cursor-explorer-panel"
          defaultSize="46%"
          minSize="18%"
          className="min-h-0 overflow-hidden"
        >
          <div
            className={cn(
              "h-full min-h-0 overflow-y-auto transition-colors",
              isProjectDropActive ? "bg-accent/30" : "",
            )}
            onDragEnter={(event) => {
              if (
                event.dataTransfer.types.includes(CURSOR_PROJECT_DRAG_TYPE) ||
                hasExternalFolderDrop(event)
              ) {
                event.preventDefault();
                setIsProjectDropActive(true);
              }
            }}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes(CURSOR_PROJECT_DRAG_TYPE) ||
                hasExternalFolderDrop(event)
              ) {
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
              if (pinProjectFromDragEvent(event)) {
                return;
              }
              if (hasExternalFolderDrop(event)) {
                void addExternalProjectsFromDrop(event).catch((error) => {
                  toastManager.add({
                    type: "error",
                    title: "Could not add dropped folder",
                    description:
                      error instanceof Error ? error.message : "The folder could not be added.",
                  });
                });
              }
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
                aria-label="Add project"
                title="Add project to Explorer"
                onClick={() => openAddProject({ pinToCursorExplorer: true })}
              >
                <FolderPlusIcon className="size-3.5" />
              </Button>
            </div>

            {explorerProjects.length > 0 ? (
              explorerProjects.map((project) => {
                const projectKey = scopedProjectKey(
                  scopeProjectRef(project.environmentId, project.id),
                );
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
                    onRemoveProject={() => removeProjectFromExplorer(projectKey)}
                    onOpenFile={(filePath) => {
                      void handleOpenFile(project, filePath);
                    }}
                  />
                );
              })
            ) : (
              <div className="flex min-h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Drag projects or folders here, or right-click a project below to add it to the file
                tree.
              </div>
            )}
          </div>
        </Panel>
        <Separator className="h-px bg-border transition-colors hover:bg-border/80" />
        <Panel
          id="cursor-project-dock-panel"
          panelRef={projectDockPanelRef}
          defaultSize="25%"
          minSize={`${PROJECT_DOCK_MIN_HEIGHT_PX}px`}
          maxSize={`${PROJECT_DOCK_MAX_HEIGHT_RATIO * 100}%`}
          className="min-h-0 overflow-hidden"
        >
          <CursorProjectDock onContentHeightChange={resizeProjectDockToContent} />
        </Panel>
      </Group>
    </div>
  );
}
