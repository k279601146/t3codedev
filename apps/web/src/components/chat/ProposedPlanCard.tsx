import { memo, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
} from "../../proposedPlan";
import ChatMarkdown from "../ChatMarkdown";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { MarkdownFileLinkMeta } from "../../markdown-links";

function buildVisiblePlanPreviewMarkdown(planMarkdown: string, maxVisibleLines: number): string {
  const lines = planMarkdown
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const previewLines: string[] = [];
  let visibleLineCount = 0;

  for (const line of lines) {
    const isVisibleLine = line.trim().length > 0;
    if (isVisibleLine && visibleLineCount >= maxVisibleLines) {
      break;
    }
    previewLines.push(line);
    if (isVisibleLine) {
      visibleLineCount += 1;
    }
  }

  while (previewLines.at(-1)?.trim().length === 0) {
    previewLines.pop();
  }

  return previewLines.join("\n");
}

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  environmentId,
  cwd,
  workspaceRoot,
  onOpenFile,
}: {
  planMarkdown: string;
  environmentId: EnvironmentId;
  cwd: string | undefined;
  workspaceRoot: string | undefined;
  onOpenFile?: ((file: MarkdownFileLinkMeta) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy plan",
          description: error instanceof Error ? error.message : "An error occurred while copying.",
        }),
      );
    },
  });
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = planMarkdown.trim();
  const collapsedPreview = canCollapse ? buildVisiblePlanPreviewMarkdown(planMarkdown, 11) : null;
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  return (
    <div
      className="proposed-plan-card overflow-hidden rounded-[10px] border border-transparent bg-[#f4f4f5] px-4 pb-4 pt-3 text-[#18181b] shadow-none dark:border-border/45 dark:bg-muted/25 dark:text-foreground sm:px-5"
      data-environment-id={environmentId}
      data-workspace-root={workspaceRoot ?? undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[14px] font-medium leading-5 text-[#09090b] dark:text-foreground/92">
          计划
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[#71717a] dark:text-muted-foreground">
          <Button
            aria-label="下载计划"
            title="下载计划"
            size="icon-xs"
            variant="ghost"
            className="size-7 rounded-md border-transparent bg-transparent text-inherit shadow-none hover:bg-black/5 hover:text-[#3f3f46] dark:hover:bg-white/8 dark:hover:text-foreground"
            onClick={handleDownload}
          >
            <DownloadIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            aria-label={isCopied ? "已复制计划" : "复制计划"}
            title={isCopied ? "已复制" : "复制计划"}
            size="icon-xs"
            variant="ghost"
            className="size-7 rounded-md border-transparent bg-transparent text-inherit shadow-none hover:bg-black/5 hover:text-[#3f3f46] dark:hover:bg-white/8 dark:hover:text-foreground"
            onClick={handleCopyPlan}
          >
            {isCopied ? (
              <CheckIcon aria-hidden="true" className="size-3.5" />
            ) : (
              <CopyIcon aria-hidden="true" className="size-3.5" />
            )}
          </Button>
          {canCollapse ? (
            <Button
              aria-label={expanded ? "收起计划" : "展开计划"}
              title={expanded ? "收起计划" : "展开计划"}
              size="icon-xs"
              variant="ghost"
              className="size-7 rounded-md border-transparent bg-transparent text-inherit shadow-none hover:bg-black/5 hover:text-[#3f3f46] dark:hover:bg-white/8 dark:hover:text-foreground"
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <ChevronUpIcon aria-hidden="true" className="size-3.5" />
              ) : (
                <ChevronDownIcon aria-hidden="true" className="size-3.5" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-5">
        <div
          className={cn("relative", canCollapse && !expanded && "max-h-[340px] overflow-hidden")}
        >
          {canCollapse && !expanded ? (
            <ChatMarkdown
              text={collapsedPreview ?? ""}
              cwd={cwd}
              isStreaming={false}
              enableCodeHighlight={false}
              onOpenFile={onOpenFile}
            />
          ) : (
            <ChatMarkdown
              text={displayedPlanMarkdown}
              cwd={cwd}
              isStreaming={false}
              enableCodeHighlight={false}
              onOpenFile={onOpenFile}
            />
          )}
          {canCollapse && !expanded ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-[#f4f4f5] via-[#f4f4f5]/88 to-transparent dark:from-[color-mix(in_srgb,var(--muted)_25%,var(--background))] dark:via-background/65" />
          ) : null}
        </div>
        {canCollapse ? (
          <div className={cn("flex justify-center", expanded ? "mt-4" : "-mt-10 relative z-10")}>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-full bg-[#18181b] px-3 text-[13px] font-medium text-white shadow-[0_10px_24px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#27272a] dark:bg-foreground dark:text-background"
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "收起计划" : "展开计划"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
