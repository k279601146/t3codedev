import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  DesktopBrowserAutomationState,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  CirclePlusIcon,
  CrosshairIcon,
  FileIcon,
  FileImageIcon,
  FolderOpenIcon,
  GlobeIcon,
  Maximize2Icon,
  MonitorIcon,
  MoreVerticalIcon,
  PanelRightCloseIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
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
import { rewriteMarkdownFileUriHref } from "../markdown-links";
import type { ActivePlanState, LatestProposedPlanState } from "../session-logic";
import type { RightPanelSurface } from "../rightPanelStore";
import DiffPanel, { DiffWorkerPoolProvider } from "./DiffPanel";
import PlanSidebar from "./PlanSidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

export type RightPanelArtifact = {
  id: string;
  name: string;
  type: "image" | "file";
  previewUrl?: string | undefined;
  filePath?: string | undefined;
  mimeType?: string | undefined;
};

type RightPanelTab = {
  id: string;
  surface: RightPanelSurface;
  title: string;
  icon: ReactNode;
  filePath?: string | undefined;
  artifactId?: string | undefined;
};

interface ThreadRightPanelProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  activeSurface: RightPanelSurface;
  artifacts?: RightPanelArtifact[] | undefined;
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
    case "computer":
      return "桌面";
    case "terminal":
      return "终端";
    case "summary":
      return "侧边聊天";
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
    case "computer":
      return <MonitorIcon className="size-3.5" />;
    case "terminal":
      return <SquareTerminalIcon className="size-3.5" />;
    case "summary":
      return <BotIcon className="size-3.5" />;
    case "home":
      return <FolderOpenIcon className="size-3.5" />;
  }
}

function createTab(surface: RightPanelSurface, input?: Partial<RightPanelTab>): RightPanelTab {
  return {
    id: input?.id ?? `${surface}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    surface,
    title: input?.title ?? surfaceTitle(surface),
    icon: input?.icon ?? surfaceIcon(surface),
    ...(input?.filePath ? { filePath: input.filePath } : {}),
    ...(input?.artifactId ? { artifactId: input.artifactId } : {}),
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
      className="flex min-h-28 flex-col items-center justify-center rounded-xl bg-muted/60 px-3 py-4 text-center transition-colors hover:bg-muted"
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
  const [loadedFile, setLoadedFile] = useState<{ path: string; content: string } | null>(null);
  const { fetchFile } = useFileContent(props.environmentId, props.workspaceRoot ?? null);
  const treeQuery = useFileTree(props.environmentId, props.workspaceRoot ?? null);
  const root = treeQuery.data?.tree ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!props.filePath) {
      setLoadedFile(null);
      return;
    }
    void fetchFile(props.filePath)
      .then((content) => {
        if (!cancelled) setLoadedFile(content === null ? null : { path: props.filePath!, content });
      })
      .catch(() => {
        if (!cancelled) setLoadedFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchFile, props.filePath]);

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
            description="从工作区目录树或产物列表中选择文件后，这里会显示内容预览。"
          />
        )}
      </div>
      <div className="flex w-[min(18rem,45%)] min-w-40 shrink-0 flex-col">
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
          if (isDirectory) props.onToggleDirectory(props.node.path);
          else props.onOpenFile(props.node.path);
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

function ImagePanel(props: { artifact: RightPanelArtifact | undefined }) {
  const src = props.artifact?.previewUrl
    ? (rewriteMarkdownFileUriHref(props.artifact.previewUrl) ?? props.artifact.previewUrl)
    : undefined;
  if (!props.artifact || !src) {
    return (
      <EmptyState
        icon={<FileImageIcon className="size-7" />}
        title="没有可预览图片"
        description="线程里出现 AI 生成图片或上传图片后，可以从主页产物列表打开。"
      />
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <div className="mb-3 truncate text-xs text-muted-foreground">{props.artifact.name}</div>
        <img
          src={src}
          alt={props.artifact.name}
          className="w-full rounded-lg border border-border/60 object-contain"
        />
      </div>
    </ScrollArea>
  );
}

function formatBrowserAddress(url: string | undefined): string {
  if (!url) {
    return "";
  }
  if (url === "about:blank") {
    return "about:blank";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

function BrowserPanel(props: { onTitleChange?: (title: string) => void }) {
  const [state, setState] = useState<DesktopBrowserAutomationState | null>(null);
  const [addressDraft, setAddressDraft] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const embedRef = useRef<HTMLDivElement | null>(null);
  const { onTitleChange } = props;

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    let cancelled = false;
    void bridge?.getBrowserAutomationState?.().then((next) => {
      if (!cancelled) setState(next);
    });
    const unsubscribe = bridge?.onBrowserAutomationState?.((next) => setState(next));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    const sendBounds = () => {
      const element = embedRef.current;
      if (!element || !bridge?.setBrowserAutomationBounds) return;
      const rect = element.getBoundingClientRect();
      void bridge.setBrowserAutomationBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0,
      });
    };

    sendBounds();
    const observer = new ResizeObserver(sendBounds);
    if (embedRef.current) {
      observer.observe(embedRef.current);
    }
    window.addEventListener("resize", sendBounds);
    const frame = window.setInterval(sendBounds, 500);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
      window.clearInterval(frame);
      void bridge?.setBrowserAutomationBounds?.({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
      });
    };
  }, []);

  const selectedTab = state?.tabs.find((tab) => tab.id === state.selectedTabId) ?? state?.tabs[0];
  const browserTitle = selectedTab?.title?.trim() || "浏览器";
  const browserAddress = formatBrowserAddress(selectedTab?.url);

  useEffect(() => {
    if (!addressFocused) {
      setAddressDraft(browserAddress);
    }
  }, [addressFocused, browserAddress]);

  useEffect(() => {
    onTitleChange?.(browserTitle);
  }, [browserTitle, onTitleChange]);

  const runBrowserControl = useCallback(
    async (
      action: (
        bridge: NonNullable<typeof window.desktopBridge>,
      ) => Promise<DesktopBrowserAutomationState>,
    ) => {
      const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
      if (!bridge) {
        setNavigationError("桌面浏览器桥接不可用。");
        return;
      }
      setNavigationPending(true);
      setNavigationError(null);
      try {
        const next = await action(bridge);
        setState(next);
      } catch (error) {
        setNavigationError(error instanceof Error ? error.message : String(error));
      } finally {
        setNavigationPending(false);
      }
    },
    [],
  );

  const submitAddress = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const url = addressDraft.trim();
      if (!url) {
        return;
      }
      void runBrowserControl(async (bridge) => {
        if (!bridge.navigateBrowserAutomation) {
          throw new Error("当前桌面端不支持浏览器地址栏导航。");
        }
        return bridge.navigateBrowserAutomation(url);
      });
    },
    [addressDraft, runBrowserControl],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-3">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-7 rounded-md text-muted-foreground/70"
          disabled={!selectedTab?.canGoBack || navigationPending}
          aria-label="后退"
          onClick={() => {
            void runBrowserControl(async (bridge) => {
              if (!bridge.goBackBrowserAutomation) {
                throw new Error("当前桌面端不支持浏览器后退。");
              }
              return bridge.goBackBrowserAutomation();
            });
          }}
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-7 rounded-md text-muted-foreground/70"
          disabled={!selectedTab?.canGoForward || navigationPending}
          aria-label="前进"
          onClick={() => {
            void runBrowserControl(async (bridge) => {
              if (!bridge.goForwardBrowserAutomation) {
                throw new Error("当前桌面端不支持浏览器前进。");
              }
              return bridge.goForwardBrowserAutomation();
            });
          }}
        >
          <ArrowRightIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-8 rounded-lg bg-muted/60 text-muted-foreground"
          disabled={!selectedTab || navigationPending}
          aria-label="刷新"
          onClick={() => {
            void runBrowserControl(async (bridge) => {
              if (!bridge.reloadBrowserAutomation) {
                throw new Error("当前桌面端不支持浏览器刷新。");
              }
              return bridge.reloadBrowserAutomation();
            });
          }}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
        <form className="min-w-0 flex-1" onSubmit={submitAddress}>
          <Input
            aria-label="浏览器地址"
            className="h-8 rounded-lg border-0 bg-muted/30 px-3 text-center text-xs text-foreground shadow-none transition-colors focus-visible:bg-background focus-visible:text-left focus-visible:ring-1 focus-visible:ring-ring"
            value={addressDraft}
            disabled={navigationPending}
            placeholder="输入网址"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onFocus={(event) => {
              setAddressFocused(true);
              window.requestAnimationFrame(() => event.currentTarget.select());
            }}
            onBlur={() => {
              setAddressFocused(false);
              if (!addressDraft.trim()) {
                setAddressDraft(browserAddress);
              }
            }}
            onChange={(event) => setAddressDraft(event.currentTarget.value)}
          />
        </form>
        <Button
          size="icon-xs"
          variant="ghost"
          className="size-7 rounded-md text-muted-foreground/70"
          disabled
          aria-label="定位页面"
        >
          <CrosshairIcon className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="size-7 rounded-md text-muted-foreground/70"
          disabled
          aria-label="缩放"
        >
          <CirclePlusIcon className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="size-7 rounded-md text-muted-foreground/70"
          disabled
          aria-label="更多"
        >
          <MoreVerticalIcon className="size-3.5" />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {navigationError || state?.lastError ? (
          <div className="absolute left-3 right-3 top-3 z-10 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
            {navigationError ?? state?.lastError}
          </div>
        ) : null}
        <div ref={embedRef} className="absolute inset-0 overflow-hidden bg-background">
          {!selectedTab ? (
            <EmptyState
              icon={<GlobeIcon className="size-7" />}
              title="浏览器就绪"
              description="模型调用内置浏览器工具后，页面会直接显示在这里。"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ComputerPanel() {
  const [state, setState] = useState<DesktopComputerAutomationState | null>(null);
  const [pendingPaused, setPendingPaused] = useState<boolean | null>(null);

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    let cancelled = false;
    void bridge?.getComputerAutomationState?.().then((next) => {
      if (!cancelled) setState(next);
    });
    const unsubscribe = bridge?.onComputerAutomationState?.((next) => setState(next));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const paused = pendingPaused ?? state?.paused ?? false;
  const setPaused = (nextPaused: boolean) => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    if (!bridge?.setComputerAutomationPaused) return;
    setPendingPaused(nextPaused);
    void bridge
      .setComputerAutomationPaused(nextPaused)
      .then((next) => setState(next))
      .finally(() => setPendingPaused(null));
  };

  const virtualScreen = state?.virtualScreen
    ? `${state.virtualScreen.x},${state.virtualScreen.y} ${state.virtualScreen.width}x${state.virtualScreen.height}`
    : "-";
  const cursor = state?.cursor ? `${state.cursor.x},${state.cursor.y}` : "-";
  const foreground = state?.foregroundWindow
    ? state.foregroundWindow.title || state.foregroundWindow.processName || "未知窗口"
    : "-";
  const selectedWindow = state?.selectedWindow
    ? state.selectedWindow.title || state.selectedWindow.processName || state.selectedWindow.id
    : "-";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">桌面控制</div>
            <div className="truncate text-xs text-muted-foreground">
              {state?.available
                ? paused
                  ? "已暂停"
                  : "运行中，控制时会让出前台"
                : "仅 Windows 可用"}
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={paused ? "default" : "outline"}
          className="h-8 gap-1.5 px-2.5 text-xs"
          disabled={!state?.available || pendingPaused !== null}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
          {paused ? "继续" : "暂停"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border border-border/60 p-2">
            <div className="text-muted-foreground">坐标系</div>
            <div className="mt-1 truncate font-medium text-foreground">{virtualScreen}</div>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <div className="text-muted-foreground">光标</div>
            <div className="mt-1 truncate font-medium text-foreground">{cursor}</div>
          </div>
          <div className="col-span-2 rounded-md border border-border/60 p-2">
            <div className="text-muted-foreground">前台窗口</div>
            <div className="mt-1 truncate font-medium text-foreground">{foreground}</div>
          </div>
          <div className="col-span-2 rounded-md border border-border/60 p-2">
            <div className="text-muted-foreground">选中窗口</div>
            <div className="mt-1 truncate font-medium text-foreground">{selectedWindow}</div>
          </div>
        </div>
        {state?.lastError ? (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {state.lastError}
          </div>
        ) : null}
        <div className="mt-3 overflow-hidden rounded-md border border-border/60 bg-muted/20">
          {state?.lastScreenshotDataUrl ? (
            <img
              src={state.lastScreenshotDataUrl}
              alt="桌面截图"
              className="h-auto w-full object-contain"
            />
          ) : (
            <EmptyState
              icon={<MonitorIcon className="size-7" />}
              title="等待桌面截图"
              description="模型调用 computer_screenshot 后，最新截图会显示在这里；执行桌面控制时 T3 会让出前台。"
            />
          )}
        </div>
        {state?.lastAction ? (
          <div className="mt-3 text-xs text-muted-foreground">最后动作：{state.lastAction}</div>
        ) : null}
      </div>
    </div>
  );
}

function ArtifactList(props: {
  artifacts: RightPanelArtifact[];
  onOpenArtifact: (artifact: RightPanelArtifact) => void;
}) {
  if (props.artifacts.length === 0) {
    return <div className="text-xs text-muted-foreground">暂无产物</div>;
  }
  return (
    <div className="space-y-1">
      {props.artifacts.map((artifact) => (
        <button
          key={artifact.id}
          type="button"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted/60"
          onClick={() => props.onOpenArtifact(artifact)}
        >
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            {artifact.type === "image" ? (
              <FileImageIcon className="size-5 text-muted-foreground" />
            ) : (
              <FileIcon className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{artifact.name}</div>
            <div className="text-xs text-muted-foreground">
              {artifact.type === "image" ? "图片" : "文件"}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function ThreadRightPanel({
  activePlan,
  activeProposedPlan,
  activeSurface,
  artifacts,
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
  const panelArtifacts = artifacts ?? [];
  const [tabs, setTabs] = useState<RightPanelTab[]>(() => [createTab(activeSurface)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? createTab("home");
  const firstImageArtifact = panelArtifacts.find((artifact) => artifact.type === "image");

  useEffect(() => {
    let nextActiveTabId: string | null = null;
    setTabs((current) => {
      const existingTab = current.find((tab) => tab.surface === activeSurface);
      if (existingTab) {
        nextActiveTabId = existingTab.id;
        return current;
      }

      const tab = createTab(activeSurface);
      nextActiveTabId = tab.id;
      return [...current, tab];
    });
    if (nextActiveTabId !== null) {
      setActiveTabId(nextActiveTabId);
    }
  }, [activeSurface]);

  const openTab = (surface: RightPanelSurface, input?: Partial<RightPanelTab>) => {
    const tab = createTab(surface, input);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    onSurfaceChange(surface);
  };

  const closeTab = (tabId: string) => {
    const closedTabIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (closedTabIndex === -1) {
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    if (nextTabs.length === 0) {
      const homeTab = createTab("home");
      setTabs([homeTab]);
      setActiveTabId(homeTab.id);
      onSurfaceChange(homeTab.surface);
      onClose();
      return;
    }

    setTabs(nextTabs);
    if (activeTabId === tabId) {
      const nextActiveTab = nextTabs[Math.min(closedTabIndex, nextTabs.length - 1)]!;
      setActiveTabId(nextActiveTab.id);
      onSurfaceChange(nextActiveTab.surface);
    }
  };

  const openFile = (filePath: string) => {
    openTab("file", {
      title: filePath.split(/[\\/]/).at(-1) ?? filePath,
      filePath,
      icon: <FileIcon className="size-3.5" />,
    });
  };

  const openArtifact = (artifact: RightPanelArtifact) => {
    if (artifact.type === "image") {
      openTab("image", {
        title: artifact.name,
        artifactId: artifact.id,
        icon: <FileImageIcon className="size-3.5" />,
      });
      return;
    }
    openTab("file", {
      title: artifact.name,
      filePath: artifact.filePath,
      artifactId: artifact.id,
      icon: <FileIcon className="size-3.5" />,
    });
  };

  const activeArtifact =
    panelArtifacts.find((artifact) => artifact.id === activeTab.artifactId) ?? firstImageArtifact;

  const content =
    activeTab.surface === "home" ? (
      <ScrollArea className="h-full">
        <div className="flex min-h-full flex-col justify-center p-6">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-3">
            <HomeTile
              icon={<FolderOpenIcon className="size-6" />}
              title="文件"
              description="浏览项目文件"
              onClick={() => openTab("file", { title: "打开文件" })}
            />
            <HomeTile
              icon={<BotIcon className="size-6" />}
              title="侧边聊天"
              description="查看计划与活动"
              onClick={() => openTab("summary", { title: planLabel })}
            />
            {isGitRepo ? (
              <HomeTile
                icon={<TextSearchIcon className="size-6" />}
                title="审查"
                description="查看代码变更"
                onClick={() => openTab("review")}
              />
            ) : null}
            <HomeTile
              icon={<GlobeIcon className="size-6" />}
              title="浏览器"
              description="打开网站预览"
              onClick={() => openTab("browser")}
            />
            <HomeTile
              icon={<MonitorIcon className="size-6" />}
              title="桌面"
              description="查看 computer_use"
              onClick={() => openTab("computer")}
            />
            <HomeTile
              icon={<SquareTerminalIcon className="size-6" />}
              title="终端"
              description="打开终端入口"
              onClick={() => openTab("terminal")}
            />
          </div>
          <div className="mt-8">
            <div className="mb-3 text-xs font-semibold text-muted-foreground">产物</div>
            {hasArtifacts ? (
              <ArtifactList artifacts={panelArtifacts} onOpenArtifact={openArtifact} />
            ) : (
              <div className="text-xs text-muted-foreground">暂无产物</div>
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
      <ImagePanel artifact={activeArtifact} />
    ) : activeTab.surface === "browser" ? (
      <BrowserPanel
        onTitleChange={(title) => {
          setTabs((current) => {
            let changed = false;
            const next = current.map((tab) => {
              if (tab.surface !== "browser" || tab.title === title) {
                return tab;
              }
              changed = true;
              return { ...tab, title };
            });
            return changed ? next : current;
          });
        }}
      />
    ) : activeTab.surface === "computer" ? (
      <ComputerPanel />
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
              <span
                role="button"
                tabIndex={0}
                aria-label={`关闭 ${tab.title} 标签`}
                className="ml-1 rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-60 group-focus-within:opacity-60 hover:bg-background hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <XIcon className="size-3" />
              </span>
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
