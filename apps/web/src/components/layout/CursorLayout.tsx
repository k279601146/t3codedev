import { useEffect, useMemo, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import ChatView from "../ChatView";
import { MonacoEditorPanel } from "../editor/MonacoEditorPanel";
import {
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  selectThreadByRef,
  useStore,
} from "../../store";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../../threadRoutes";
import { isConversationDraftThread, useComposerDraftStore } from "../../composerDraftStore";
import { useFileContent } from "../../hooks/useFileContent";
import { getEditorLanguage, useEditorStore } from "../../editorStore";
import { useTurnDiffSummaries } from "../../hooks/useTurnDiffSummaries";
import { SidebarInset } from "../ui/sidebar";
import { useShallow } from "zustand/react/shallow";
import { getLatestThreadForProject } from "../../lib/threadSort";
import { useSettings } from "../../hooks/useSettings";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { readEnvironmentApi } from "../../environmentApi";
import {
  getPatchDisplayPath,
  parseUnifiedDiff,
  reconstructOriginalFromModified,
} from "../../lib/unifiedDiff";

const LAST_RECORDED_CHECKPOINT_TURN_COUNT_BY_THREAD_ID = new Map<string, number>();

export function CursorLayout() {
  const navigate = useNavigate();
  const settings = useSettings();
  const { handleNewThread } = useNewThreadHandler();
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
  const conversationDraftSession = useComposerDraftStore(
    useShallow((state) => (routeTarget === null ? state.getConversationDraftSession() : null)),
  );
  const activeDraftSession = draftSession ?? conversationDraftSession;
  const activeDraftId = draftId ?? conversationDraftSession?.draftId ?? null;
  const isConversationDraft = isConversationDraftThread(activeDraftSession);
  const projectRef = useMemo(() => {
    if (serverThread) {
      return scopeProjectRef(serverThread.environmentId, serverThread.projectId);
    }
    if (activeDraftSession && !isConversationDraft) {
      return scopeProjectRef(activeDraftSession.environmentId, activeDraftSession.projectId);
    }
    return null;
  }, [activeDraftSession, isConversationDraft, serverThread]);
  const project = useStore((state) =>
    projectRef ? selectProjectByRef(state, projectRef) : undefined,
  );
  const environmentId = serverThread?.environmentId ?? activeDraftSession?.environmentId ?? null;
  const threadId = serverThread?.id ?? activeDraftSession?.threadId ?? null;
  const activeDraftWorkspaceRoot = isConversationDraft
    ? null
    : (activeDraftSession?.worktreePath ?? null);
  const workspaceRoot =
    serverThread?.worktreePath ?? activeDraftWorkspaceRoot ?? project?.cwd ?? null;
  const { fetchFile } = useFileContent(environmentId, workspaceRoot);
  const stageExternalChange = useEditorStore((state) => state.stageExternalChange);
  const openFile = useEditorStore((state) => state.openFile);
  const replaceFileContents = useEditorStore((state) => state.replaceFileContents);
  const queryClient = useQueryClient();
  const activeEditorTab = useEditorStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  );
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const activeThread = useStore((state) =>
    serverThreadRef ? selectThreadByRef(state, serverThreadRef) : undefined,
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const latestCheckpointTurnCount =
    activeThread?.turnDiffSummaries.at(-1)?.checkpointTurnCount ?? 0;
  const stagedTurnDiffKeysRef = useRef(new Set<string>());

  const activeEditorProject = useMemo(() => {
    if (!activeEditorTab) {
      return undefined;
    }
    return projects.find(
      (candidate) =>
        candidate.environmentId === activeEditorTab.environmentId &&
        candidate.cwd === activeEditorTab.workspaceRoot,
    );
  }, [activeEditorTab, projects]);

  useEffect(() => {
    if (!activeEditorProject) {
      return;
    }
    if (
      projectRef?.environmentId === activeEditorProject.environmentId &&
      projectRef.projectId === activeEditorProject.id
    ) {
      return;
    }

    const latestThread = getLatestThreadForProject(
      sidebarThreads.filter((thread) => thread.environmentId === activeEditorProject.environmentId),
      activeEditorProject.id,
      settings.sidebarThreadSortOrder,
    );
    if (latestThread) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(latestThread.environmentId, latestThread.id)),
      });
      return;
    }

    void handleNewThread(
      scopeProjectRef(activeEditorProject.environmentId, activeEditorProject.id),
      {
        envMode: settings.defaultThreadEnvMode,
      },
    );
  }, [
    activeEditorProject,
    handleNewThread,
    navigate,
    projectRef,
    settings.defaultThreadEnvMode,
    settings.sidebarThreadSortOrder,
    sidebarThreads,
  ]);

  useEffect(() => {
    if (!activeThread || !workspaceRoot || !environmentId) {
      return;
    }

    const summariesToStage = turnDiffSummaries.flatMap((summary) => {
      const checkpointTurnCount =
        summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
      if (typeof checkpointTurnCount !== "number" || checkpointTurnCount <= 0) {
        return [];
      }
      const key = `${environmentId}:${activeThread.id}:${summary.turnId}:${checkpointTurnCount}`;
      if (stagedTurnDiffKeysRef.current.has(key)) {
        return [];
      }
      return [{ key, checkpointTurnCount }];
    });
    if (summariesToStage.length === 0) {
      return;
    }

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      return;
    }
    void Promise.all(
      summariesToStage.map(async ({ key, checkpointTurnCount }) => {
        stagedTurnDiffKeysRef.current.add(key);
        try {
          const result = await api.orchestration.getTurnDiff({
            threadId: activeThread.id,
            fromTurnCount: Math.max(0, checkpointTurnCount - 1),
            toTurnCount: checkpointTurnCount,
            ignoreWhitespace: false,
          });
          const patches = parseUnifiedDiff(result.diff);
          void queryClient.invalidateQueries({
            queryKey: ["cursor-file-tree", environmentId, workspaceRoot],
          });
          const changedFiles = patches.flatMap((patch) => {
            const filePath = getPatchDisplayPath(patch);
            if (!filePath || patch.newPath === null || patch.hunks.length === 0) {
              return [];
            }
            return [{ patch, filePath }];
          });
          const editorUpdates = await Promise.all(
            changedFiles.map(async ({ patch, filePath }) => {
              const modifiedContents = await fetchFile(filePath).catch(() => "");
              const originalContents = reconstructOriginalFromModified(patch, modifiedContents);
              return { filePath, modifiedContents, originalContents };
            }),
          );

          for (const { filePath, modifiedContents, originalContents } of editorUpdates) {
            stageExternalChange(
              environmentId,
              workspaceRoot,
              filePath,
              originalContents,
              modifiedContents,
            );
            openFile({
              environmentId,
              workspaceRoot,
              filePath,
              fileName: filePath.split(/[\\/]/).at(-1) ?? filePath,
              language: getEditorLanguage(filePath),
              contents: modifiedContents,
            });
          }
        } catch {
          stagedTurnDiffKeysRef.current.delete(key);
        }
      }),
    );
  }, [
    activeThread,
    environmentId,
    fetchFile,
    inferredCheckpointTurnCountByTurnId,
    openFile,
    queryClient,
    stageExternalChange,
    turnDiffSummaries,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeThread || !environmentId || !workspaceRoot) {
      return;
    }

    const previousCheckpointTurnCount = LAST_RECORDED_CHECKPOINT_TURN_COUNT_BY_THREAD_ID.get(
      activeThread.id,
    );
    LAST_RECORDED_CHECKPOINT_TURN_COUNT_BY_THREAD_ID.set(
      activeThread.id,
      latestCheckpointTurnCount,
    );
    if (
      previousCheckpointTurnCount === undefined ||
      latestCheckpointTurnCount >= previousCheckpointTurnCount
    ) {
      return;
    }

    const openTabs = useEditorStore
      .getState()
      .tabs.filter(
        (tab) =>
          tab.environmentId === environmentId &&
          tab.workspaceRoot === workspaceRoot &&
          !tab.isDirty,
      );
    if (openTabs.length === 0) {
      return;
    }

    void Promise.all(
      openTabs.map(async (tab) => {
        try {
          const contents = await fetchFile(tab.filePath);
          replaceFileContents(environmentId, workspaceRoot, tab.filePath, contents);
        } catch {
          // Leave the tab untouched if the file can no longer be read.
        }
      }),
    );
  }, [
    activeThread,
    environmentId,
    fetchFile,
    latestCheckpointTurnCount,
    replaceFileContents,
    workspaceRoot,
  ]);

  if (!environmentId || !threadId) {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
          Open a thread to start editing.
        </div>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <Group id="cursor-layout-panels" className="h-full min-h-0" orientation="horizontal">
        <Panel defaultSize={70} minSize={30} className="min-h-0 overflow-hidden">
          <MonacoEditorPanel environmentId={environmentId} workspaceRoot={workspaceRoot} />
        </Panel>
        <Separator className="w-px bg-border transition-colors hover:bg-border/80" />
        <Panel defaultSize={30} minSize={24} className="min-h-0 overflow-hidden">
          {activeDraftId ? (
            <ChatView
              environmentId={environmentId}
              threadId={threadId}
              draftId={activeDraftId}
              routeKind="draft"
              compactHeaderActions
            />
          ) : (
            <ChatView
              environmentId={environmentId}
              threadId={threadId}
              routeKind="server"
              compactHeaderActions
            />
          )}
        </Panel>
      </Group>
    </SidebarInset>
  );
}
