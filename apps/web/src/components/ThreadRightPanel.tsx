import type { ReactNode } from "react";
import {
  BotIcon,
  FileBoxIcon,
  GlobeIcon,
  PanelRightCloseIcon,
  SquareTerminalIcon,
  TextSearchIcon,
} from "lucide-react";

import type { EnvironmentId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { cn } from "~/lib/utils";
import type { ActivePlanState, LatestProposedPlanState } from "../session-logic";
import type { RightPanelSurface } from "../rightPanelStore";
import DiffPanel, { DiffWorkerPoolProvider } from "./DiffPanel";
import PlanSidebar from "./PlanSidebar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface ThreadRightPanelSurface {
  id: RightPanelSurface;
  label: string;
  icon: ReactNode;
  available: boolean;
}

interface ThreadRightPanelProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  activeSurface: RightPanelSurface;
  environmentId: EnvironmentId;
  hasArtifacts: boolean;
  isGitRepo: boolean;
  markdownCwd: string | undefined;
  mode: "sidebar" | "sheet";
  planLabel: string;
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  onClose: () => void;
  onSurfaceChange: (surface: RightPanelSurface) => void;
}

function EmptySurface(props: { title: string; description: string; badge?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        {props.badge ? (
          <Badge
            variant="secondary"
            className="rounded-md px-1.5 py-0 text-[10px] font-semibold tracking-wide uppercase"
          >
            {props.badge}
          </Badge>
        ) : null}
        <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{props.title}</h3>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <p className="max-w-72 text-[13px] leading-relaxed text-muted-foreground/70">
          {props.description}
        </p>
      </div>
    </div>
  );
}

function surfaceTooltip(surface: ThreadRightPanelSurface): string {
  if (!surface.available) {
    return `${surface.label} 当前不可用`;
  }
  return surface.label;
}

export function ThreadRightPanel({
  activePlan,
  activeProposedPlan,
  activeSurface,
  environmentId,
  hasArtifacts,
  isGitRepo,
  markdownCwd,
  mode,
  planLabel,
  timestampFormat,
  workspaceRoot,
  onClose,
  onSurfaceChange,
}: ThreadRightPanelProps) {
  const surfaces: ThreadRightPanelSurface[] = [
    {
      id: "review",
      label: "审查",
      icon: <TextSearchIcon className="size-3.5" />,
      available: isGitRepo,
    },
    {
      id: "summary",
      label: "摘要",
      icon: <BotIcon className="size-3.5" />,
      available: true,
    },
    {
      id: "artifacts",
      label: "产物",
      icon: <FileBoxIcon className="size-3.5" />,
      available: hasArtifacts,
    },
    {
      id: "browser",
      label: "浏览器",
      icon: <GlobeIcon className="size-3.5" />,
      available: true,
    },
    {
      id: "terminal",
      label: "终端",
      icon: <SquareTerminalIcon className="size-3.5" />,
      available: true,
    },
  ];

  const content =
    activeSurface === "review" ? (
      isGitRepo ? (
        <DiffWorkerPoolProvider>
          <DiffPanel mode={mode} />
        </DiffWorkerPoolProvider>
      ) : (
        <EmptySurface
          badge="Review"
          title="当前项目不是 Git 仓库"
          description="Codex 风格审查面板需要 Git diff。初始化 Git 仓库后，这里会显示未提交变更、线程变更和审查结果。"
        />
      )
    ) : activeSurface === "summary" ? (
      <PlanSidebar
        activePlan={activePlan}
        activeProposedPlan={activeProposedPlan}
        label={planLabel}
        environmentId={environmentId}
        markdownCwd={markdownCwd}
        workspaceRoot={workspaceRoot}
        timestampFormat={timestampFormat}
        mode={mode}
        onClose={onClose}
      />
    ) : activeSurface === "artifacts" ? (
      <EmptySurface
        badge="Artifacts"
        title="产物预览"
        description={
          hasArtifacts
            ? "当前线程包含可预览附件。第一版会把图片、文档和生成文件统一收拢到这里。"
            : "当前线程还没有可预览产物。后续图片、PDF、表格和生成文件会出现在这里。"
        }
      />
    ) : activeSurface === "browser" ? (
      <EmptySurface
        badge="Browser"
        title="浏览器预览"
        description="这里预留 Codex App 风格的网页预览区域，后续可接入本地浏览器会话和视觉标注。"
      />
    ) : (
      <EmptySurface
        badge="Terminal"
        title="终端"
        description="终端仍保留在底部抽屉中运行。这里作为右侧统一入口，后续可以展示终端摘要和快捷切换。"
      />
    );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col border-l border-border/70 bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-2">
        <div className="flex min-w-0 items-center gap-1">
          {surfaces.map((surface) => (
            <Tooltip key={surface.id}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant={activeSurface === surface.id ? "secondary" : "ghost"}
                    className={cn("size-7 rounded-md", !surface.available && "opacity-45")}
                    aria-label={surface.label}
                    aria-pressed={activeSurface === surface.id}
                    disabled={!surface.available}
                    onClick={() => onSurfaceChange(surface.id)}
                  />
                }
              >
                {surface.icon}
              </TooltipTrigger>
              <TooltipPopup side="bottom">{surfaceTooltip(surface)}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-7 rounded-md text-muted-foreground/70 hover:text-foreground"
          aria-label="关闭右侧面板"
          onClick={onClose}
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  );
}

export default ThreadRightPanel;
