import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";
import ChatView from "../components/ChatView";
import { LazyCursorLayout } from "../components/layout/LazyCursorLayout";
import { threadHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import { useSettings } from "../hooks/useSettings";
import { isLatestTurnSettled } from "../session-logic";

function DraftChatThreadRouteView() {
  const layoutMode = useSettings((state) => state.layoutMode);
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const candidateServerThreadId = draftSession?.threadId ?? ThreadId.make(draftId);
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(candidateServerThreadId),
      [candidateServerThreadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const serverThreadSettled = isLatestTurnSettled(
    serverThread?.latestTurn ?? null,
    serverThread?.session ?? null,
  );
  const canonicalThreadRef = useMemo(() => {
    if (draftSession?.promotedTo) {
      return serverThreadStarted ? draftSession.promotedTo : null;
    }
    if (draftSession) {
      return null;
    }
    return serverThread
      ? {
          environmentId: serverThread.environmentId,
          threadId: serverThread.id,
        }
      : null;
  }, [draftSession, draftSession?.promotedTo, serverThread, serverThreadStarted]);
  const shouldRenderCanonicalThread = Boolean(canonicalThreadRef);
  const startedAsLiveDraftRef = useRef(Boolean(draftSession && !draftSession.promotedTo));
  const shouldCanonicalizeStaleDraft = Boolean(
    canonicalThreadRef && serverThreadSettled && !startedAsLiveDraftRef.current,
  );

  useEffect(() => {
    if (!canonicalThreadRef || !shouldCanonicalizeStaleDraft) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate, shouldCanonicalizeStaleDraft]);

  useEffect(() => {
    if (
      !startedAsLiveDraftRef.current ||
      !draftSession?.promotedTo ||
      !serverThreadStarted ||
      !serverThreadSettled
    ) {
      return;
    }
    useComposerDraftStore.getState().finalizePromotedDraftThread(draftId);
  }, [draftId, draftSession?.promotedTo, serverThreadSettled, serverThreadStarted]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (canonicalThreadRef && shouldRenderCanonicalThread) {
    if (layoutMode === "cursor") {
      return <LazyCursorLayout />;
    }
    if (draftSession) {
      return (
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            draftId={draftId}
            environmentId={canonicalThreadRef.environmentId}
            threadId={canonicalThreadRef.threadId}
            routeKind="draft"
          />
        </SidebarInset>
      );
    }
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  if (layoutMode === "cursor") {
    return <LazyCursorLayout />;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
