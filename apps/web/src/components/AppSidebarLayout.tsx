import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import ThreadSidebar from "./Sidebar";
import { CursorSidebar } from "./layout/CursorSidebar";
import { Skeleton } from "./ui/skeleton";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { useSettings } from "../hooks/useSettings";
import { useUiStateStore } from "../uiStateStore";
import { selectSidebarThreadSummaryByRef, useStore } from "../store";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

function PendingThreadOpenView() {
  const pendingOpenThreadRef = useUiStateStore((state) => state.pendingOpenThreadRef);
  const pendingThreadSummary = useStore((state) =>
    selectSidebarThreadSummaryByRef(state, pendingOpenThreadRef),
  );
  if (!pendingOpenThreadRef) {
    return null;
  }
  const title = pendingThreadSummary?.title?.trim() || "正在打开对话";

  return (
    <div
      className="absolute inset-0 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground"
      aria-busy="true"
      aria-label="正在打开对话"
    >
      <header className="relative z-30 flex h-[40px] shrink-0 items-center border-b border-border/70 bg-background/95 px-3 backdrop-blur sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-foreground/88">{title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">正在加载对话内容...</div>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <Skeleton className="size-6 rounded-md border border-border/50" />
          <Skeleton className="size-6 rounded-md border border-border/50" />
        </div>
      </header>
      <div className="h-0.5 shrink-0 overflow-hidden bg-muted/45">
        <div className="h-full w-1/3 animate-pulse bg-foreground/18" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-white px-4 sm:px-6 dark:bg-background">
        <div className="mx-auto flex h-full w-full max-w-[736px] flex-col gap-5 py-6">
          <div className="flex justify-end">
            <div className="w-[78%] max-w-xl rounded-md border border-border/45 bg-muted/45 p-4">
              <Skeleton className="h-3.5 w-11/12 rounded-full" />
              <Skeleton className="mt-3 h-3.5 w-7/12 rounded-full" />
            </div>
          </div>
          <div className="rounded-md border border-border/35 bg-background/80 p-4">
            <Skeleton className="h-3.5 w-24 rounded-full" />
            <Skeleton className="mt-3 h-3.5 w-full rounded-full" />
            <Skeleton className="mt-3 h-3.5 w-10/12 rounded-full" />
            <Skeleton className="mt-3 h-3.5 w-8/12 rounded-full" />
          </div>
          <div className="flex justify-end">
            <div className="w-[64%] max-w-lg rounded-md border border-border/40 bg-muted/40 p-4">
              <Skeleton className="h-3.5 w-full rounded-full" />
              <Skeleton className="mt-3 h-3.5 w-2/3 rounded-full" />
            </div>
          </div>
          <div className="rounded-md border border-border/35 bg-background/80 p-4">
            <Skeleton className="h-3.5 w-20 rounded-full" />
            <Skeleton className="mt-3 h-3.5 w-11/12 rounded-full" />
            <Skeleton className="mt-3 h-3.5 w-9/12 rounded-full" />
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-border/60 bg-background px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-[43.5rem]">
          <div className="rounded-lg border border-border/55 bg-muted/25 p-3">
            <Skeleton className="h-3.5 w-2/5 rounded-full" />
            <Skeleton className="mt-3 h-3.5 w-full rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const layoutMode = useSettings((state) => state.layoutMode);
  const isSettingsRoute = pathname.startsWith("/settings");
  const pendingOpenThreadRef = useUiStateStore((state) => state.pendingOpenThreadRef);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowKeyUp = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowBlur = () => {
      clearShortcutModifierState();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border/70 bg-sidebar text-foreground shadow-[1px_0_0_rgb(15_23_42/0.02)]"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {isSettingsRoute ? (
          <ThreadSidebar />
        ) : layoutMode === "cursor" ? (
          <CursorSidebar />
        ) : (
          <ThreadSidebar />
        )}
        <SidebarRail />
      </Sidebar>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
        {pendingOpenThreadRef && !isSettingsRoute ? <PendingThreadOpenView /> : null}
      </div>
    </SidebarProvider>
  );
}
