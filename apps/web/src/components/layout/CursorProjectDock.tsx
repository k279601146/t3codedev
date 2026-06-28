import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime";
import type { ContextMenuItem } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloudIcon,
  FolderPlusIcon,
  SquarePenIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useComposerDraftStore } from "../../composerDraftStore";
import { readEnvironmentApi } from "../../environmentApi";
import { newCommandId } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import {
  createSidebarThreadsForProjectRefsSelector,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsForProjectRef,
  useStore,
} from "../../store";
import type { Project, SidebarThreadSummary } from "../../types";
import { useCursorLayoutStore } from "../../cursorLayoutStore";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ProjectFavicon } from "../ProjectFavicon";
import { SidebarChromeFooter } from "../Sidebar";
import {
  ensureCursorProjectForPath,
  getExternalFolderPathsFromDrop,
  hasExternalFolderDrop,
} from "../../lib/cursorExternalProjects";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { cn } from "../../lib/utils";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useThreadActions } from "../../hooks/useThreadActions";
import { sortThreads } from "../../lib/threadSort";
import { useUiStateStore } from "../../uiStateStore";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../../threadRoutes";
import {
  orderItemsByPreferredIds,
  resolveProjectStatusIndicator,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
} from "../Sidebar.logic";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";
import { getProjectOrderKey } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../../environments/runtime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AddProjectMenu } from "../AddProjectMenu";
import { useI18n } from "../../i18n";

export const CURSOR_PROJECT_DRAG_TYPE = "application/x-t3code-project-key";
const PROJECT_DOCK_LIST_PADDING_PX = 8;

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

async function chooseProjectMember(
  members: readonly SidebarProjectGroupMember[],
  position: { x: number; y: number },
): Promise<SidebarProjectGroupMember | null> {
  if (members.length === 0) {
    return null;
  }
  if (members.length === 1) {
    return members[0] ?? null;
  }

  const api = readLocalApi();
  if (!api) {
    return members[0] ?? null;
  }

  const clicked = await api.contextMenu.show(
    members.map((member) => ({
      id: member.physicalProjectKey,
      label: member.environmentLabel ? `${member.name} · ${member.environmentLabel}` : member.name,
    })),
    position,
  );
  if (!clicked) {
    return null;
  }
  return members.find((member) => member.physicalProjectKey === clicked) ?? null;
}

export function CursorProjectDock({
  title = "Projects",
  onHeaderDragStart,
  onContentHeightChange,
}: {
  title?: string;
  onHeaderDragStart?: (event: React.DragEvent) => void;
  onContentHeightChange?: (height: number) => void;
}) {
  const allProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: allProjects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [allProjects, projectOrder],
  );
  const projectGroupingSettings = useSettings((settings) => ({
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  }));
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((state) => state.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);
  const collapsed = useCursorLayoutStore((state) => state.projectDockCollapsed);
  const setCollapsed = useCursorLayoutStore((state) => state.setProjectDockCollapsed);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const sidebarProjects = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: orderedProjects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => {
          const runtime = savedEnvironmentRuntimeById[environmentId];
          const saved = savedEnvironmentRegistry[environmentId];
          return runtime?.descriptor?.label ?? saved?.label ?? null;
        },
      }),
    [
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      savedEnvironmentRegistry,
      savedEnvironmentRuntimeById,
    ],
  );
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const activeRouteThreadKey = useMemo(() => {
    if (routeTarget?.kind === "server") {
      return scopedThreadKey(routeTarget.threadRef);
    }
    if (routeTarget?.kind === "draft") {
      const draftSession = useComposerDraftStore.getState().getDraftSession(routeTarget.draftId);
      if (!draftSession) {
        return null;
      }
      return scopedThreadKey(scopeThreadRef(draftSession.environmentId, draftSession.threadId));
    }
    return null;
  }, [routeTarget]);
  const { handleNewThread } = useNewThreadHandler();
  const [isDropActive, setIsDropActive] = useState(false);
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const headerRef = useRef<HTMLDivElement | null>(null);
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const addExternalProjectsFromDrop = useCallback(
    async (event: React.DragEvent) => {
      if (!primaryEnvironmentId) {
        throw new Error("No local environment is available.");
      }
      const paths = getExternalFolderPathsFromDrop(event);
      if (paths.length === 0) {
        throw new Error("The desktop drag payload did not include a folder path.");
      }
      await Promise.all(
        paths.map((rawPath) =>
          ensureCursorProjectForPath({
            environmentId: primaryEnvironmentId,
            rawPath,
            projects: allProjects,
            pinToExplorer: true,
          }),
        ),
      );
      toastManager.add({
        type: "success",
        title: paths.length === 1 ? "Project added to Explorer" : "Projects added to Explorer",
      });
    },
    [allProjects, primaryEnvironmentId],
  );

  const expandThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectKey)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    if (!onContentHeightChange) {
      return;
    }

    let animationFrame = 0;
    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const headerHeight = headerRef.current?.offsetHeight ?? 0;
        const listHeight = collapsed
          ? 0
          : (listContentRef.current?.scrollHeight ?? 0) + PROJECT_DOCK_LIST_PADDING_PX;
        const footerHeight = footerRef.current?.offsetHeight ?? 0;
        onContentHeightChange(headerHeight + listHeight + footerHeight);
      });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(animationFrame);
    }

    const resizeObserver = new ResizeObserver(measure);
    if (headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }
    if (listContentRef.current) {
      resizeObserver.observe(listContentRef.current);
    }
    if (footerRef.current) {
      resizeObserver.observe(footerRef.current);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [collapsed, onContentHeightChange, sidebarProjects.length]);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-sidebar transition-colors",
        isDropActive ? "bg-accent/30" : "",
      )}
      onDragEnter={(event) => {
        if (hasExternalFolderDrop(event)) {
          event.preventDefault();
          setIsDropActive(true);
        }
      }}
      onDragOver={(event) => {
        if (hasExternalFolderDrop(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDropActive(false);
        }
      }}
      onDrop={(event) => {
        if (!hasExternalFolderDrop(event)) {
          return;
        }
        event.preventDefault();
        setIsDropActive(false);
        void addExternalProjectsFromDrop(event).catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not add dropped folder",
            description: error instanceof Error ? error.message : "The folder could not be added.",
          });
        });
      }}
    >
      <div
        ref={headerRef}
        className="flex h-10 min-h-10 cursor-grab items-center gap-2 px-3 active:cursor-grabbing"
        draggable={onHeaderDragStart !== undefined}
        onDragStart={onHeaderDragStart}
      >
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-6 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand projects" : "Collapse projects"}
        >
          {collapsed ? (
            <ChevronUpIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </Button>
        <div className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {title}
        </div>
        <AddProjectMenu
          title="添加项目"
          pinToCursorExplorer
          trigger={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="size-6 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              aria-label="添加项目"
            >
              <FolderPlusIcon className="size-3.5" />
            </Button>
          }
        />
      </div>

      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div ref={listContentRef}>
            {sidebarProjects.length > 0 ? (
              sidebarProjects.map((project) => (
                <CursorProjectDockRow
                  key={project.projectKey}
                  project={project}
                  activeRouteThreadKey={activeRouteThreadKey}
                  isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
                  onExpandThreadList={() => expandThreadListForProject(project.projectKey)}
                  onCollapseThreadList={() => collapseThreadListForProject(project.projectKey)}
                  onNewThread={handleNewThread}
                />
              ))
            ) : (
              <div className="px-3 py-3 text-xs text-muted-foreground">No projects</div>
            )}
          </div>
        </div>
      )}
      <div ref={footerRef} className="shrink-0">
        <SidebarChromeFooter />
      </div>
    </div>
  );
}

function CursorProjectDockRow({
  project,
  activeRouteThreadKey,
  isThreadListExpanded,
  onExpandThreadList,
  onCollapseThreadList,
  onNewThread,
}: {
  project: SidebarProjectSnapshot;
  activeRouteThreadKey: string | null;
  isThreadListExpanded: boolean;
  onExpandThreadList: () => void;
  onCollapseThreadList: () => void;
  onNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
}) {
  const navigate = useNavigate();
  const pinProject = useCursorLayoutStore((state) => state.pinProject);
  const toggleProject = useUiStateStore((state) => state.toggleProject);
  const setProjectOrder = useUiStateStore((state) => state.setProjectOrder);
  const setNewThreadScope = useUiStateStore((state) => state.setNewThreadScope);
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const { archiveThread } = useThreadActions();
  const { t } = useI18n();
  const { updateSettings } = useUpdateSettings();
  const projectExpanded = useUiStateStore(
    (state) => state.projectExpandedById[project.projectKey] ?? true,
  );
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const sidebarThreadPreviewCount = useSettings((settings) => settings.sidebarThreadPreviewCount);
  const sidebarThreads = useStore(
    useShallow(
      useMemo(
        () => createSidebarThreadsForProjectRefsSelector(project.memberProjectRefs),
        [project.memberProjectRefs],
      ),
    ),
  );
  const representativeProjectKey = scopedProjectKey(
    scopeProjectRef(project.environmentId, project.id),
  );

  const visibleProjectThreads = useMemo(
    () =>
      sortThreads(
        sidebarThreads.filter((thread) => thread.archivedAt === null),
        threadSortOrder,
      ),
    [sidebarThreads, threadSortOrder],
  );
  const projectStatus = useMemo(
    () =>
      resolveProjectStatusIndicator(
        visibleProjectThreads.map((thread) =>
          resolveThreadStatusPill({
            thread: {
              ...thread,
              lastVisitedAt:
                threadLastVisitedAtById[
                  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
                ],
            },
          }),
        ),
      ),
    [threadLastVisitedAtById, visibleProjectThreads],
  );
  const activeCollapsedThread = useMemo(() => {
    if (projectExpanded || !activeRouteThreadKey) {
      return null;
    }
    return (
      visibleProjectThreads.find(
        (thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeRouteThreadKey,
      ) ?? null
    );
  }, [activeRouteThreadKey, projectExpanded, visibleProjectThreads]);
  const hasOverflowingThreads = visibleProjectThreads.length > sidebarThreadPreviewCount;
  const previewThreads =
    isThreadListExpanded || !hasOverflowingThreads
      ? visibleProjectThreads
      : visibleProjectThreads.slice(0, sidebarThreadPreviewCount);
  const renderedThreads = activeCollapsedThread ? [activeCollapsedThread] : previewThreads;
  const shouldShowThreadPanel = projectExpanded || activeCollapsedThread !== null;

  const handlePin = useCallback(() => {
    pinProject(representativeProjectKey);
  }, [pinProject, representativeProjectKey]);

  const handlePinToTop = useCallback(() => {
    const draggedProjectIds = project.memberProjects.map((member) => member.physicalProjectKey);
    setProjectOrder([
      ...draggedProjectIds,
      ...projectOrder.filter((projectId) => !draggedProjectIds.includes(projectId)),
    ]);
    updateSettings({ sidebarProjectSortOrder: "manual" });
  }, [project.memberProjects, projectOrder, setProjectOrder, updateSettings]);

  const handleOpenInExplorer = useCallback(async () => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: t("sidebar.pathOpenFailed"),
        description: project.cwd,
      });
      return;
    }
    try {
      await api.shell.openPath(project.cwd);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("sidebar.pathOpenFailed"),
          description: error instanceof Error ? error.message : project.cwd,
        }),
      );
    }
  }, [project.cwd, t]);

  const handleArchiveProjectThreads = useCallback(async () => {
    const archiveTargets = visibleProjectThreads.filter((thread) => thread.archivedAt === null);
    if (archiveTargets.length === 0) {
      toastManager.add({ type: "info", title: t("sidebar.archiveProjectThreadsEmpty") });
      return;
    }
    try {
      for (const thread of archiveTargets) {
        await archiveThread(scopeThreadRef(thread.environmentId, thread.id));
      }
      toastManager.add({
        type: "success",
        title: t("sidebar.archiveProjectThreadsSuccess"),
      });
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("sidebar.archiveProjectThreadsFailed"),
          description: error instanceof Error ? error.message : "归档对话时发生错误。",
        }),
      );
    }
  }, [archiveThread, t, visibleProjectThreads]);

  const handleCreateThread = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      void chooseProjectMember(project.memberProjects, {
        x: event.clientX,
        y: event.clientY,
      }).then((member) => {
        if (member) {
          const projectRef = scopeProjectRef(member.environmentId, member.id);
          setNewThreadScope({ kind: "project", projectRef });
          void onNewThread(projectRef);
        }
      });
    },
    [onNewThread, project.memberProjects, setNewThreadScope],
  );

  return (
    <div className="rounded-md">
      <div className="group/project-header relative">
        <button
          type="button"
          draggable
          className="flex h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 pr-8 text-left text-xs outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring group-hover/project-header:bg-sidebar-accent group-hover/project-header:text-sidebar-accent-foreground"
          onClick={() => toggleProject(project.projectKey)}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(CURSOR_PROJECT_DRAG_TYPE, representativeProjectKey);
            event.dataTransfer.setData("text/plain", project.cwd);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            void showProjectContextMenu({
              project,
              position: { x: event.clientX, y: event.clientY },
              onPin: handlePin,
              onPinToTop: handlePinToTop,
              onOpenInExplorer: handleOpenInExplorer,
              onArchiveThreads: handleArchiveProjectThreads,
              labels: {
                pinProject: t("sidebar.pinProject"),
                addToFileTree: t("sidebar.addToFileTree"),
                openInExplorer: t("sidebar.openInExplorer"),
                copyProjectPath: t("sidebar.copyProjectPath"),
                archiveProjectThreads: t("sidebar.archiveProjectThreads"),
                removeProject: t("sidebar.removeProject"),
                pathCopied: t("sidebar.pathCopied"),
              },
            });
          }}
        >
          {!projectExpanded && projectStatus ? (
            <span
              aria-hidden="true"
              title={projectStatus.label}
              className={cn(
                "-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center",
                projectStatus.colorClass,
              )}
            >
              <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                <span
                  className={cn(
                    "size-[9px] rounded-full",
                    projectStatus.dotClass,
                    projectStatus.pulse ? "animate-pulse" : "",
                  )}
                />
              </span>
              <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
            </span>
          ) : (
            <ChevronRightIcon
              className={cn(
                "-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                projectExpanded ? "rotate-90" : "",
              )}
            />
          )}
          <ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground/90">
              {project.displayName}
            </span>
            {project.groupedProjectCount > 1 ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {project.groupedProjectCount} projects
              </span>
            ) : null}
          </span>
        </button>

        {project.environmentPresence === "remote-only" ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="pointer-events-none absolute top-1 right-1.5 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-opacity duration-150 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0" />
              }
            >
              <CloudIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              Remote environment: {project.remoteEnvironmentLabels.join(", ")}
            </TooltipPopup>
          </Tooltip>
        ) : null}

        <div className="pointer-events-none absolute top-1 right-1.5 inline-flex opacity-0 transition-opacity duration-150 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
          <button
            type="button"
            aria-label={`Create new thread in ${project.displayName}`}
            className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={handleCreateThread}
          >
            <SquarePenIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {shouldShowThreadPanel ? (
        <div className="mx-1 my-0 w-full translate-x-0 overflow-hidden px-1.5 py-0.5">
          {visibleProjectThreads.length === 0 && projectExpanded ? (
            <div className="flex h-6 w-full translate-x-0 items-center px-2 text-left text-[10px] text-muted-foreground/60">
              <span>No threads yet</span>
            </div>
          ) : null}
          {renderedThreads.map((thread) => (
            <CursorProjectThreadRow
              key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
              thread={thread}
              isActive={
                activeRouteThreadKey ===
                scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
              }
              lastVisitedAt={
                threadLastVisitedAtById[
                  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
                ]
              }
              onOpen={() => {
                const threadRef = scopeThreadRef(thread.environmentId, thread.id);
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(threadRef),
                });
              }}
            />
          ))}
          {projectExpanded && hasOverflowingThreads && !isThreadListExpanded ? (
            <button
              type="button"
              className="flex h-6 w-full translate-x-0 items-center justify-start rounded-lg px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
              onClick={onExpandThreadList}
            >
              展开显示
            </button>
          ) : null}
          {projectExpanded && hasOverflowingThreads && isThreadListExpanded ? (
            <button
              type="button"
              className="flex h-6 w-full translate-x-0 items-center justify-start rounded-lg px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
              onClick={onCollapseThreadList}
            >
              收起显示
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CursorProjectThreadRow({
  thread,
  isActive,
  lastVisitedAt,
  onOpen,
}: {
  thread: SidebarThreadSummary;
  isActive: boolean;
  lastVisitedAt: string | null | undefined;
  onOpen: () => void;
}) {
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      ...(lastVisitedAt ? { lastVisitedAt } : {}),
    },
  });
  return (
    <button
      type="button"
      data-thread-item
      className={resolveThreadRowClassName({
        isActive,
        isSelected: false,
      })}
      onClick={onOpen}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {threadStatus ? <ThreadStatusLabel status={threadStatus} compact /> : null}
        <span className="min-w-0 flex-1 truncate text-xs">{thread.title}</span>
      </span>
    </button>
  );
}

async function showProjectContextMenu({
  project,
  position,
  onPin,
  onPinToTop,
  onOpenInExplorer,
  onArchiveThreads,
  labels,
}: {
  project: Project;
  position: { x: number; y: number };
  onPin: () => void;
  onPinToTop: () => void;
  onOpenInExplorer: () => Promise<void>;
  onArchiveThreads: () => Promise<void>;
  labels: {
    pinProject: string;
    addToFileTree: string;
    openInExplorer: string;
    copyProjectPath: string;
    archiveProjectThreads: string;
    removeProject: string;
    pathCopied: string;
  };
}) {
  const api = readLocalApi();
  const items = [
    { id: "pin-top", label: labels.pinProject, icon: "pin" },
    { id: "pin", label: labels.addToFileTree, icon: "folder-open" },
    { id: "open-in-explorer", label: labels.openInExplorer, icon: "folder-open" },
    { id: "copy-path", label: labels.copyProjectPath, icon: "copy" },
    { id: "archive-threads", label: labels.archiveProjectThreads, icon: "archive" },
    { id: "remove", label: labels.removeProject, icon: "x", destructive: true },
  ] satisfies readonly ContextMenuItem<string>[];
  const action = api
    ? await api.contextMenu.show(items, position)
    : window.prompt("Type pin, copy, or remove")?.trim();

  if (!action) {
    return;
  }

  if (action === "pin-top") {
    onPinToTop();
    return;
  }

  if (action === "pin") {
    onPin();
    return;
  }

  if (action === "open-in-explorer") {
    await onOpenInExplorer();
    return;
  }

  if (action === "copy-path") {
    await navigator.clipboard?.writeText(project.cwd);
    toastManager.add({
      type: "success",
      title: labels.pathCopied,
      description: project.cwd,
    });
    return;
  }

  if (action === "archive-threads") {
    await onArchiveThreads();
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
