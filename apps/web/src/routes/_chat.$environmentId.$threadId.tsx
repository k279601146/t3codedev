import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import {
  findDraftSessionEntryByRef,
  finalizePromotedDraftThreadByRef,
  useComposerDraftStore,
} from "../composerDraftStore";
import { type DiffRouteSearch, parseDiffRouteSearch } from "../diffRouteSearch";
import { useSettings } from "../hooks/useSettings";
import {
  selectEnvironmentState,
  selectSidebarThreadSummaryByRef,
  selectThreadExistsByRef,
  useStore,
} from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";
import { LazyCursorLayout } from "../components/layout/LazyCursorLayout";
import { SidebarInset } from "~/components/ui/sidebar";

function ChatThreadRouteView() {
  const layoutMode = useSettings((state) => state.layoutMode);
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const sidebarThreadExists = useStore(
    (store) => selectSidebarThreadSummaryByRef(store, threadRef) !== undefined,
  );
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadEntry = useMemo(
    () => findDraftSessionEntryByRef(draftThreadsByThreadKey, threadRef),
    [draftThreadsByThreadKey, threadRef],
  );
  const draftThreadExists = draftThreadEntry !== null;
  const draftThread = draftThreadEntry?.draftSession ?? null;
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || sidebarThreadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const canRenderDraftFallback = draftThread !== null && !serverThreadStarted;
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const markDiffOpened = useCallback(() => undefined, []);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  if (layoutMode === "cursor") {
    return <LazyCursorLayout />;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {canRenderDraftFallback && draftThreadEntry ? (
        <ChatView
          draftId={draftThreadEntry.draftId}
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markDiffOpened}
          routeKind="draft"
        />
      ) : (
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markDiffOpened}
          routeKind="server"
        />
      )}
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
