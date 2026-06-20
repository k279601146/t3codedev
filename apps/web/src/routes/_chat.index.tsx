import { createFileRoute } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import ChatView from "../components/ChatView";
import { LazyCursorLayout } from "../components/layout/LazyCursorLayout";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { useComposerDraftStore } from "../composerDraftStore";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useSavedEnvironmentRegistryStore } from "../environments/runtime";
import { useSettings } from "../hooks/useSettings";
import { useUiStateStore } from "../uiStateStore";
import { APP_DISPLAY_NAME } from "~/branding";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const savedEnvironmentCount = useSavedEnvironmentRegistryStore(
    (state) => Object.keys(state.byId).length,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const layoutMode = useSettings((state) => state.layoutMode);
  const setNewThreadScope = useUiStateStore((store) => store.setNewThreadScope);
  const conversationDraftSession = useComposerDraftStore(
    useShallow((store) =>
      primaryEnvironmentId
        ? store.getConversationDraftSessionForEnvironment(primaryEnvironmentId)
        : null,
    ),
  );

  useEffect(() => {
    if (authGateState.status === "hosted-static" && savedEnvironmentCount === 0) {
      return;
    }
    setNewThreadScope({ kind: "conversation" });
    if (!primaryEnvironmentId) {
      return;
    }
    useComposerDraftStore.getState().ensureConversationDraftSession(primaryEnvironmentId);
  }, [
    authGateState.status,
    primaryEnvironmentId,
    savedEnvironmentCount,
    setNewThreadScope,
  ]);

  if (authGateState.status === "hosted-static" && savedEnvironmentCount === 0) {
    return <HostedStaticOnboardingState />;
  }

  if (!primaryEnvironmentId) {
    return null;
  }

  if (layoutMode === "cursor") {
    return <LazyCursorLayout />;
  }

  if (!conversationDraftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatView
        draftId={conversationDraftSession.draftId}
        environmentId={conversationDraftSession.environmentId}
        threadId={conversationDraftSession.threadId}
        routeKind="draft"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

function HostedStaticOnboardingState() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header className="border-b border-border px-3 py-2 sm:px-5 sm:py-3">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0 md:hidden" />
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </header>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle className="text-foreground text-xl">
                Connect an environment to get started
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                Open a pairing link from your Bahew desktop app or add a reachable backend
                manually. Your saved environments stay in this browser.
              </EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<a href="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Add environment
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
