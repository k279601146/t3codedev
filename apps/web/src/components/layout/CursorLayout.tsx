import { useEffect, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime";
import ChatView from "../ChatView";
import { MonacoEditorPanel } from "../editor/MonacoEditorPanel";
import { selectProjectByRef, selectThreadByRef, useStore } from "../../store";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useFileContent } from "../../hooks/useFileContent";
import { useEditorStore } from "../../editorStore";
import { useTurnDiffSummaries } from "../../hooks/useTurnDiffSummaries";
import { SidebarInset } from "../ui/sidebar";

export function CursorLayout() {
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
  const projectRef = useMemo(() => {
    if (serverThread) {
      return scopeProjectRef(serverThread.environmentId, serverThread.projectId);
    }
    if (draftSession) {
      return scopeProjectRef(draftSession.environmentId, draftSession.projectId);
    }
    return null;
  }, [draftSession, serverThread]);
  const project = useStore((state) =>
    projectRef ? selectProjectByRef(state, projectRef) : undefined,
  );
  const environmentId = serverThread?.environmentId ?? draftSession?.environmentId ?? null;
  const threadId = serverThread?.id ?? draftSession?.threadId ?? null;
  const workspaceRoot =
    serverThread?.worktreePath ?? draftSession?.worktreePath ?? project?.cwd ?? null;
  const { fetchFile } = useFileContent(environmentId, workspaceRoot);
  const replaceFileContents = useEditorStore((state) => state.replaceFileContents);
  const activeThread = useStore((state) =>
    serverThreadRef ? selectThreadByRef(state, serverThreadRef) : undefined,
  );
  const { turnDiffSummaries } = useTurnDiffSummaries(activeThread);

  useEffect(() => {
    if (!activeThread || !workspaceRoot || !environmentId) {
      return;
    }

    const changedPaths = new Set(
      turnDiffSummaries.flatMap((summary) => summary.files.map((file) => file.path)),
    );
    if (changedPaths.size === 0) {
      return;
    }

    const openTabs = useEditorStore.getState().tabs;
    void Promise.all(
      [...changedPaths].flatMap((filePath) => {
        const openTab = openTabs.find(
          (tab) =>
            tab.environmentId === environmentId &&
            tab.workspaceRoot === workspaceRoot &&
            tab.filePath === filePath,
        );
        if (
          !openTab ||
          openTab.environmentId !== environmentId ||
          openTab.workspaceRoot !== workspaceRoot ||
          openTab.isDirty
        ) {
          return [];
        }

        return [
          fetchFile(filePath)
            .then((contents) => {
              replaceFileContents(environmentId, workspaceRoot, filePath, contents);
            })
            .catch(() => undefined),
        ];
      }),
    );
  }, [
    activeThread,
    environmentId,
    fetchFile,
    replaceFileContents,
    turnDiffSummaries,
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
        <Panel defaultSize={42} minSize={28}>
          <MonacoEditorPanel environmentId={environmentId} workspaceRoot={workspaceRoot} />
        </Panel>
        <Separator className="w-px bg-border transition-colors hover:bg-border/80" />
        <Panel defaultSize={58} minSize={34}>
          {routeTarget?.kind === "draft" && draftId ? (
            <ChatView
              environmentId={environmentId}
              threadId={threadId}
              draftId={draftId}
              routeKind="draft"
              reserveTitleBarControlInset
            />
          ) : (
            <ChatView
              environmentId={environmentId}
              threadId={threadId}
              routeKind="server"
              reserveTitleBarControlInset
            />
          )}
        </Panel>
      </Group>
    </SidebarInset>
  );
}
