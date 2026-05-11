import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, ChevronDownIcon, PlusIcon, MicIcon, SparklesIcon } from "lucide-react";

import { APP_DISPLAY_NAME } from "../branding";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { resolveSidebarNewThreadEnvMode } from "./Sidebar.logic";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import { cn } from "~/lib/utils";
import { useComposerDraftStore } from "~/composerDraftStore";
import { createProjectSelectorByRef } from "~/storeSelectors";
import { useStore } from "~/store";

export function NoActiveThreadState() {
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const project = useStore(
    useMemo(() => createProjectSelectorByRef(defaultProjectRef), [defaultProjectRef]),
  );
  const projectLabel = project?.name?.trim() || APP_DISPLAY_NAME;
  const [prompt, setPrompt] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const launchThread = useCallback(
    async (nextPrompt: string) => {
      const trimmedPrompt = nextPrompt.trim();
      if (!defaultProjectRef || trimmedPrompt.length === 0 || isLaunching) {
        return;
      }

      setIsLaunching(true);
      try {
        await handleNewThread(defaultProjectRef, {
          envMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: defaultThreadEnvMode,
          }),
        });
        const draftThread = useComposerDraftStore
          .getState()
          .getDraftThreadByProjectRef(defaultProjectRef);
        if (draftThread) {
          useComposerDraftStore.getState().setPrompt(draftThread.draftId, trimmedPrompt);
        }
        if (isMountedRef.current) {
          setPrompt("");
        }
      } finally {
        if (isMountedRef.current) {
          setIsLaunching(false);
        }
      }
    },
    [defaultProjectRef, defaultThreadEnvMode, handleNewThread, isLaunching],
  );

  const canLaunch = Boolean(defaultProjectRef) && !isLaunching;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <main className="flex min-h-0 flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
          <div className="w-full max-w-[50rem]">
            <div className="mx-auto max-w-[36rem] text-center">
              <h1 className="text-[28px] font-medium tracking-tight text-foreground sm:text-[30px]">
                要在 {projectLabel} 中构建什么?
              </h1>
            </div>

            <form
              className="mx-auto mt-8 w-full max-w-[45rem]"
              onSubmit={(event) => {
                event.preventDefault();
                void launchThread(prompt);
              }}
            >
              <div className="rounded-[22px] border border-border/60 bg-card/65 shadow-[0_1px_0_rgba(0,0,0,0.02),0_10px_24px_rgba(0,0,0,0.03)] backdrop-blur">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="可向 Codex 询问任何事。输入 @ 使用插件或提及文件"
                  className={cn(
                    "block min-h-[118px] w-full resize-none rounded-[22px] bg-transparent px-4 pb-3 pt-4 text-[15px] leading-6",
                    "text-foreground placeholder:text-muted-foreground/35 focus:outline-none",
                  )}
                  disabled={!defaultProjectRef || isLaunching}
                  spellCheck={false}
                />

                <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-1">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground/70"
                      disabled={!defaultProjectRef || isLaunching}
                      aria-label="Add attachment"
                    >
                      <PlusIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="gap-1.5 px-2 text-muted-foreground/80"
                      disabled={!defaultProjectRef || isLaunching}
                    >
                      <SparklesIcon className="size-3.5" />
                      \u81ea\u5b9a\u4e49
                      <ChevronDownIcon className="size-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="gap-1.5 px-2 text-foreground/78"
                      disabled={!defaultProjectRef || isLaunching}
                    >
                      <span className="text-sm font-medium tabular-nums">5.5</span>
                      <span>\u4e2d</span>
                      <ChevronDownIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground/70"
                      disabled={!defaultProjectRef || isLaunching}
                      aria-label="Voice input"
                    >
                      <MicIcon className="size-3.5" />
                    </Button>
                    <button
                      type="submit"
                      disabled={!canLaunch || prompt.trim().length === 0}
                      aria-label="Send prompt"
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full border border-black/5 shadow-sm transition-all duration-150",
                        "bg-neutral-700 text-white hover:bg-neutral-800 hover:scale-105",
                        "disabled:pointer-events-none disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none disabled:hover:scale-100",
                        "dark:bg-neutral-200 dark:text-neutral-950 dark:hover:bg-white",
                      )}
                    >
                      <ArrowUpIcon className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </main>
      </div>
    </SidebarInset>
  );
}
