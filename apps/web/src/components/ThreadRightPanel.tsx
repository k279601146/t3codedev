import { useMemo, useState, type ReactNode } from "react";
import {
  BotIcon,
  FileIcon,
  FileImageIcon,
  FolderOpenIcon,
  GlobeIcon,
  Maximize2Icon,
  PanelRightCloseIcon,
  PlusIcon,
  SearchIcon,
  SquareTerminalIcon,
  TextSearchIcon,
  XIcon,
} from "lucide-react";

import type { EnvironmentId, ProjectDirectoryTreeNode } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { cn } from "~/lib/utils";
import { useFileContent } from "../hooks/useFileContent";
import { useFileTree } from "../hooks/useFileTree";
import type { ActivePlanState, LatestProposedPlanState } from "../session-logic";
import type { ChatAttachment } from "../types";
import type { RightPanelSurface } from "../rightPanelStore";
import DiffPanel, { DiffWorkerPoolProvider } from "./DiffPanel";
import PlanSidebar from "./PlanSidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

type RightPanelTab = {
  id: string;
  surface: RightPanelSurface;
  title: string;
  icon: ReactNode;
  filePath?: string | undefined;
  imageUrl?: string | undefined;
};

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
  previewAttachments: ChatAttachment[];
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  onClose: () => void;
  onSurfaceChange: (surface: RightPanelSurface) => void;
}

function surfaceTitle(surface: RightPanelSurface): string {
  switch (surface) {
    case "review":
      return "审查";
    case "file":
      return "打开文件";
    case "image":
      return "图片";
    case "artifacts":
      return "产物";
    case "browser":
      return "浏览器";
    case "terminal":
      return "终端";
    case "summary":
      return "摘要";
    case "home":
      return "主页";
  }
}

function surfaceIcon(surface: RightPanelSurface): ReactNode {
  switch (surface) {
    case "review":
      return <TextSearchIcon className="size-3.5" />;
    case "file":
      return <FileIcon className="size-3.5" />;
    case "image":
    case "artifacts":
      return <FileImageIcon className="size-3.5" />;
    case "browser":
      return <GlobeIcon className="size-3.5" />;
    case "terminal":
      return <SquareTerminalIcon className="size-3.5" />;
    case "summary":
      return <BotIcon className="size-3.5" />;
    case "home":
      return <FolderOpenIcon className="size-3.5" />;
  }
}

function createTab(surface: RightPanelSurface, input?: Partial<RightPanelTab>): RightPanelTab {
  const title = input?.title ?? surfaceTitle(surface);
  return {
    id: input?.id ?? `${surface}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    surface,
    title,
    icon: input?.icon ?? surfaceIcon(surface),
    ...(input?.filePath ? { filePath: input.filePath } : {}),
    ...(input?.imageUrl ? { imageUrl: input.imageUrl } : {}),
  };
}

function HomeTile(props: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-32 flex-col items-center justify-center rounded-xl bg-muted/60 px-4 text-center transition-colors hover:bg-muted"
      onClick={props.onClick}
    >
      <span className="mb-3 text-muted-foreground">{props.icon}</span>
      <span className="text-sm font-semibold text-foreground">{props.title}</span>
      <span className="mt-1 text-xs text-muted-foreground">{props.description}</span>
    </button>
  );
}

function EmptyState(props: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center px-8 text-center">
      <div className="mb-3 text-muted-foreground">{props.icon}</div>
      <div className="text-sm font-semibold text-foreground">{props.title}</div>
      <div className="mt-2 max-w-72 text-xs leading-relaxed text-muted-foreground">
        {props.description}
      </div>
    </div>
  );
}

function FilePanel(props: {
  environmentId: EnvironmentId;
  workspaceRoot: string | undefined;
  filePath: string | undefined;
  onOpenFile: (filePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [openDirectories, setOpenDirectories] = useState<ReadonlySet<string>>(() => new Set());
  const { fetchFile } = useFileContent(props.environmentId, props.workspaceRoot ?? null);
  const treeQuery = useFileTree(props.environmentId, props.workspaceRoot ?? null);
  const root = treeQuery.data?.tree ?? null;
  const fileContentQuery = useMemo(() => {
    if (!props.filePath) return null;
    return fetchFile(props.filePath).catch(() => null);
  }, [fetchFile, props.filePath]);
  const [loadedFile, setLoadedFile] = useState<{ path: string; content: string } | null>(null);

  useMemo(() => {
    if (!props.filePath || !fileContentQuery) return;
    void fileContentQuery.then((content) => {
      if (content !== null) {
        setLoadedFile({ path: props.filePath!, content });
      }
    });
  }, [fileContentQuery, props.filePath]);

  const visibleNodes = useMemo(() => {
    const children = root?.children ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return children;
    return children.filter((node) => node.name.toLowerCase().includes(normalizedQuery));
  }, [query, root?.children]);

  return (
    <div className="flex h-full min-h-0 bg-background">
      <div className="flex min-w-0 flex-1 flex-col border-r border-border/60">
        {loadedFile ? (
          <>
            <div className="shrink-0 border-b border-border/60 px-4 py-3 text-xs text-muted-foreground">
              {loadedFile.path}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <pre className="p-4 font-mono text-xs leading-6 text-foreground">
                {loadedFile.content}
              </pre>
            </ScrollArea>
          </>
        ) : (
          <EmptyState
            icon={<FolderOpenIcon className="size-7" />}
            title="打开文件"
            description="从工作区目录树中选择文件。"
          />
        )}
      </div>
      <div className="flex w-72 shrink-0 flex-col">
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 rounded-lg pl-8 text-xs"
              placeholder="筛选文件..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {visibleNodes.length > 0 ? (
              visibleNodes.map((node) => (
                <FileTreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  openDirectories={openDirectories}
                  onToggleDirectory={(path) =>
                    setOpenDirectories((current) => {
                      const next = new Set(current);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                  onOpenFile={props.onOpenFile}
                />
              ))
            ) : (
              <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                {treeQuery.isLoading ? "正在加载文件..." : "没有找到文件"}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function FileTreeRow(props: {
  node: ProjectDirectoryTreeNode;
  depth: number;
  openDirectories: ReadonlySet<string>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isDirectory = props.node.kind === "directory";
  const isOpen = isDirectory && props.openDirectories.has(props.node.path);
  return (
    <>
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        style={{ paddingLeft: 8 + props.depth * 14 }}
        onClick={() => {
          if (isDirectory) {
            props.onToggleDirectory(props.node.path);
          } else {
            props.onOpenFile(props.node.path);
          }
        }}
      >
        {isDirectory ? (
          <FolderOpenIcon className="size-3.5 shrink-0" />
        ) : (
          <FileIcon className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 truncate">{props.node.name}</span>
      </button>
      {isOpen
        ? (props.node.children ?? []).map((child: ProjectDirectoryTreeNode) => (
            <FileTreeRow
              key={child.path}
              node={child}
              depth={props.depth + 1}
              openDirectories={props.openDirectories}
              onToggleDirectory={props.onToggleDirectory}
              onOpenFile={props.onOpenFile}
            />
          ))
        : null}
    </>
  );
}

function ImagePanel(props: { attachment: ChatAttachment | undefined }) {
  if (!props.attachment?.previewUrl) {
    return (
      <EmptyState
        icon={<FileImageIcon className="size-7" />}
        title="没有图片"
        description="线程里出现可预览图片后，可以从首页推荐或标签页打开。"
      />
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <div className="mb-3 truncate text-xs text-muted-foreground">{props.attachment.name}</div>
        <img
          src={props.attachment.previewUrl}
          alt={props.attachment.name}
          className="w-full rounded-lg border border-border/60 object-contain"
        />
      </div>
    </ScrollArea>
  );
}

function BrowserPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Button size="icon-xs" variant="ghost" className="size-7 rounded-md" disabled>
          ←
        </Button>
        <Button size="icon-xs" variant="ghost" className="size-7 rounded-md" disabled>
          →
        </Button>
        <Button size="icon-xs" variant="ghost" className="size-7 rounded-md" disabled>
          ↻
        </Button>
        <div className="flex h-8 flex-1 items-center justify-center rounded-lg bg-muted/50 text-xs text-muted-foreground">
          输入 URL
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-10">
        <div className="w-full max-w-md space-y-2">
          <div className="mb-3 text-xs font-medium text-muted-foreground">本地</div>
          {["Sub2API - AI API Gateway", "localhost:8080", "OpenHarness", "localhost:8000"].map(
            (label) => (
              <button
                key={label}
                type="button"
                className="flex h-16 w-full items-center gap-3 rounded-xl border border-border/70 px-3 text-left hover:bg-muted/50"
              >
                <div className="flex size-11 items-center justify-center rounded-lg bg-muted">
                  <GlobeIcon className="size-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{label}</div>
                  <div className="truncate text-xs text-muted-foreground">localhost</div>
                </div>
                <span className="size-2 rounded-full bg-emerald-500" />
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
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
  previewAttachments,
  timestampFormat,
  workspaceRoot,
  onClose,
  onSurfaceChange,
}: ThreadRightPanelProps) {
  const recommendedImage = previewAttachments.find(
    (attachment) => attachment.type === "image" && attachment.previewUrl,
  );
  const [tabs, setTabs] = useState<RightPanelTab[]>(() => [createTab(activeSurface)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? createTab("home");

  const openTab = (surface: RightPanelSurface, input?: Partial<RightPanelTab>) => {
    const tab = createTab(surface, input);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    onSurfaceChange(surface);
  };

  const closeTab = (tabId: string) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next.at(-1)?.id ?? "");
        onSurfaceChange(next.at(-1)?.surface ?? "home");
      }
      return next.length > 0 ? next : [createTab("home")];
    });
  };

  const openFile = (filePath: string) => {
    openTab("file", {
      title: filePath.split(/[\\/]/).at(-1) ?? filePath,
      filePath,
      icon: <FileIcon className="size-3.5" />,
    });
  };

  const content =
    activeTab.surface === "home" ? (
      <ScrollArea className="h-full">
        <div className="flex min-h-full flex-col justify-center p-6">
          <div className="grid grid-cols-2 gap-3">
            <HomeTile
              icon={<FolderOpenIcon className="size-6" />}
              title="文件"
              description="浏览项目文件"
              onClick={() => openTab("file", { title: "打开文件" })}
            />
            <HomeTile
              icon={<BotIcon className="size-6" />}
              title="侧边聊天"
              description="发起侧边对话"
              onClick={() => openTab("summary", { title: planLabel })}
            />
            <HomeTile
              icon={<GlobeIcon className="size-6" />}
              title="浏览器"
              description="打开网站"
              onClick={() => openTab("browser")}
            />
            <HomeTile
              icon={<SquareTerminalIcon className="size-6" />}
              title="终端"
              description="启动交互式 shell"
              onClick={() => openTab("terminal")}
            />
          </div>
          <div className="mt-8">
            <div className="mb-3 text-xs font-semibold text-muted-foreground">推荐</div>
            {recommendedImage ? (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted/60"
                onClick={() =>
                  openTab("image", {
                    title: recommendedImage.name,
                    imageUrl: recommendedImage.previewUrl,
                    icon: <FileImageIcon className="size-3.5" />,
                  })
                }
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <FileImageIcon className="size-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {recommendedImage.name}
                  </div>
                  <div className="text-xs text-muted-foreground">图片</div>
                </div>
              </button>
            ) : (
              <div className="text-xs text-muted-foreground">暂无推荐内容</div>
            )}
          </div>
        </div>
      </ScrollArea>
    ) : activeTab.surface === "review" ? (
      isGitRepo ? (
        <DiffWorkerPoolProvider>
          <DiffPanel mode={mode} />
        </DiffWorkerPoolProvider>
      ) : (
        <EmptyState
          icon={<TextSearchIcon className="size-7" />}
          title="当前项目不是 Git 仓库"
          description="初始化 Git 仓库后，这里会显示未提交变更、线程变更和审查结果。"
        />
      )
    ) : activeTab.surface === "file" ? (
      <FilePanel
        environmentId={environmentId}
        workspaceRoot={workspaceRoot}
        filePath={activeTab.filePath}
        onOpenFile={openFile}
      />
    ) : activeTab.surface === "image" || activeTab.surface === "artifacts" ? (
      <ImagePanel
        attachment={
          previewAttachments.find((attachment) => attachment.previewUrl === activeTab.imageUrl) ??
          recommendedImage
        }
      />
    ) : activeTab.surface === "browser" ? (
      <BrowserPanel />
    ) : activeTab.surface === "summary" ? (
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
    ) : (
      <EmptyState
        icon={<SquareTerminalIcon className="size-7" />}
        title="终端"
        description="终端仍保留在底部抽屉中运行，这里作为右侧统一入口。"
      />
    );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col border-l border-border/70 bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "group flex h-8 max-w-40 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors",
                tab.id === activeTab.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
              onClick={() => {
                setActiveTabId(tab.id);
                onSurfaceChange(tab.surface);
              }}
            >
              {tab.icon}
              <span className="min-w-0 truncate">{tab.title}</span>
              {tabs.length > 1 ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="ml-1 rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <XIcon className="size-3" />
                </span>
              ) : null}
            </button>
          ))}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="size-7 shrink-0 rounded-md text-muted-foreground"
            aria-label="新增标签页"
            onClick={() => openTab("home")}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-7 rounded-md text-muted-foreground/70 hover:text-foreground"
          aria-label="最大化右侧面板"
        >
          <Maximize2Icon className="size-3.5" />
        </Button>
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
