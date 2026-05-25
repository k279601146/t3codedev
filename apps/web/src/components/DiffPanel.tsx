import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime";
import type { TurnId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  FileSearchIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PilcrowIcon,
  RefreshCwIcon,
  TextWrapIcon,
} from "lucide-react";
import {
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { useGitStatus } from "~/lib/gitStatusState";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { readEnvironmentApi } from "../environmentApi";
import { resolvePathLinkTarget } from "../terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { useSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import {
  getPatchDisplayPath,
  parseUnifiedDiff,
  type UnifiedDiffFilePatch,
  type UnifiedDiffHunk,
  type UnifiedDiffLine,
} from "../lib/unifiedDiff";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { ToggleGroup, Toggle } from "./ui/toggle-group";

type DiffScope = "unstaged" | "staged" | "thread";

type RenderablePatch =
  | {
      kind: "files";
      files: UnifiedDiffFilePatch[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

function getRenderablePatch(patch: string | undefined): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  const files = parseUnifiedDiff(normalizedPatch).filter((file) => file.hunks.length > 0);
  if (files.length > 0) {
    return { kind: "files", files };
  }

  return {
    kind: "raw",
    text: normalizedPatch,
    reason: "无法识别该 diff 格式，正在显示原始补丁。",
  };
}

function resolveFileDiffPath(fileDiff: UnifiedDiffFilePatch): string {
  return getPatchDisplayPath(fileDiff) ?? "未知文件";
}

function buildFileDiffRenderKey(fileDiff: UnifiedDiffFilePatch): string {
  return `${fileDiff.oldPath ?? "none"}:${fileDiff.newPath ?? "none"}`;
}

function countFilePatchLines(file: UnifiedDiffFilePatch, type: "add" | "remove"): number {
  return file.hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.type === type).length,
    0,
  );
}

function getHunkHiddenLineCount(hunk: UnifiedDiffHunk, index: number): number {
  if (index === 0) {
    return Math.max(0, hunk.newStart - 1);
  }
  return Math.max(0, hunk.oldStart - 1);
}

function DiffCodeLine(props: {
  line: UnifiedDiffLine;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  wrap: boolean;
}) {
  const lineClassName =
    props.line.type === "add"
      ? "border-l-2 border-emerald-500 bg-emerald-500/12"
      : props.line.type === "remove"
        ? "border-l-2 border-red-500 bg-red-500/10"
        : "border-l-2 border-transparent";
  const numberClassName =
    props.line.type === "add"
      ? "text-emerald-600"
      : props.line.type === "remove"
        ? "text-red-500"
        : "text-muted-foreground";
  const marker = props.line.type === "add" ? "+" : props.line.type === "remove" ? "-" : " ";

  return (
    <div className={cn("grid min-w-max grid-cols-[3.2rem_1rem_1fr] text-[11px]", lineClassName)}>
      <span
        className={cn(
          "select-none border-r border-border/50 bg-background/45 px-2 text-right font-mono leading-5",
          numberClassName,
        )}
      >
        {props.newLineNumber ?? props.oldLineNumber ?? ""}
      </span>
      <span className={cn("select-none px-1 text-center font-mono leading-5", numberClassName)}>
        {marker}
      </span>
      <code
        className={cn(
          "px-2 font-mono leading-5 text-foreground",
          props.wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        )}
      >
        {props.line.text.length > 0 ? props.line.text : " "}
      </code>
    </div>
  );
}

function DiffHunkView(props: { hunk: UnifiedDiffHunk; index: number; wrap: boolean }) {
  let oldLineNumber = props.hunk.oldStart;
  let newLineNumber = props.hunk.newStart;
  const hiddenLineCount = getHunkHiddenLineCount(props.hunk, props.index);

  return (
    <div className="min-w-max">
      <div className="grid min-w-max grid-cols-[3.2rem_1fr] bg-muted/70 text-[11px] text-muted-foreground">
        <span className="select-none border-r border-border/50 px-2 text-center leading-8">
          <ChevronDownIcon className="mx-auto size-3.5" />
        </span>
        <span className="px-3 leading-8">{hiddenLineCount} unchanged lines</span>
      </div>
      {props.hunk.lines.map((line, index) => {
        const oldDisplay = line.type === "add" ? null : oldLineNumber;
        const newDisplay = line.type === "remove" ? null : newLineNumber;

        if (line.type !== "add") {
          oldLineNumber += 1;
        }
        if (line.type !== "remove") {
          newLineNumber += 1;
        }

        return (
          <DiffCodeLine
            key={`${props.hunk.oldStart}:${props.hunk.newStart}:${index}`}
            line={line}
            oldLineNumber={oldDisplay}
            newLineNumber={newDisplay}
            wrap={props.wrap}
          />
        );
      })}
    </div>
  );
}

function DiffFileRow(props: {
  file: UnifiedDiffFilePatch;
  expanded: boolean;
  wrap: boolean;
  onToggle: () => void;
  onOpenFile: () => void;
}) {
  const filePath = resolveFileDiffPath(props.file);
  const additions = countFilePatchLines(props.file, "add");
  const deletions = countFilePatchLines(props.file, "remove");

  return (
    <div className="border-b border-border/45 last:border-b-0" data-diff-file-path={filePath}>
      <div className="flex h-9 min-w-0 items-center gap-2 px-4 text-xs">
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={props.expanded ? `折叠 ${filePath}` : `展开 ${filePath}`}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          <ChevronDownIcon
            className={cn("size-4 transition-transform", props.expanded ? "" : "-rotate-90")}
          />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
          title={filePath}
          onClick={props.onOpenFile}
        >
          {filePath}
        </button>
        <span className="shrink-0 text-emerald-600">+{additions}</span>
        <span className="shrink-0 text-red-500">-{deletions}</span>
      </div>
      {props.expanded ? (
        <div className="overflow-x-auto px-2 pb-2">
          <div className="overflow-hidden rounded-md bg-background font-mono shadow-[inset_0_0_0_1px_var(--border)]">
            {props.file.hunks.map((hunk, index) => (
              <DiffHunkView
                key={`${hunk.oldStart}:${hunk.newStart}:${index}`}
                hunk={hunk}
                index={index}
                wrap={props.wrap}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface DiffPanelProps {
  mode?: DiffPanelMode;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({ mode = "inline" }: DiffPanelProps) {
  const navigate = useNavigate();
  const settings = useSettings();
  const [diffScope, setDiffScope] = useState<DiffScope>("unstaged");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [collapsedDiffFileKeys, setCollapsedDiffFileKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const turnStripRef = useRef<HTMLDivElement>(null);
  const previousDiffOpenRef = useRef(false);
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const diffOpen = diffSearch.diff === "1";
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd;
  const gitStatusQuery = useGitStatus({
    environmentId: activeThread?.environmentId ?? null,
    cwd: activeCwd ?? null,
  });
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  const selectedTurnId = diffSearch.diffTurnId ?? null;
  const selectedFilePath = selectedTurnId !== null ? (diffSearch.diffFilePath ?? null) : null;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      !selectedTurn && typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, selectedTurn],
  );
  const activeCheckpointRange = selectedTurn
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (selectedTurn || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [orderedTurnDiffSummaries, selectedTurn]);
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled: isGitRepo,
    }),
  );
  const workingTreeDiffQuery = useQuery({
    queryKey: [
      "vcs.diffWorkingTree",
      activeThread?.environmentId ?? null,
      activeCwd ?? null,
      diffScope,
      diffIgnoreWhitespace,
    ],
    enabled: Boolean(
      activeThread?.environmentId && activeCwd && isGitRepo && diffScope !== "thread",
    ),
    queryFn: async () => {
      if (!activeThread?.environmentId || !activeCwd) {
        return { diff: "" };
      }
      const api = readEnvironmentApi(activeThread.environmentId);
      if (!api) {
        throw new Error("环境连接不可用，无法读取 Git 差异。");
      }
      return await api.vcs.diffWorkingTree({
        cwd: activeCwd,
        staged: diffScope === "staged",
        ignoreWhitespace: diffIgnoreWhitespace,
      });
    },
  });
  const selectedTurnCheckpointDiff = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const conversationCheckpointDiff = selectedTurn
    ? undefined
    : activeCheckpointDiffQuery.data?.diff;
  const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading;
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? "加载检查点差异失败。"
        : null;

  const workingTreePatch = diffScope === "thread" ? undefined : workingTreeDiffQuery.data?.diff;
  const selectedPatch =
    diffScope === "thread"
      ? selectedTurn
        ? selectedTurnCheckpointDiff
        : conversationCheckpointDiff
      : workingTreePatch;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(() => getRenderablePatch(selectedPatch), [selectedPatch]);
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);

  useEffect(() => {
    if (renderableFiles.length === 0) {
      setCollapsedDiffFileKeys((current) => (current.size === 0 ? current : new Set()));
      return;
    }

    const visibleFileKeys = new Set(renderableFiles.map(buildFileDiffRenderKey));
    setCollapsedDiffFileKeys((current) => {
      const next = new Set([...current].filter((fileKey) => visibleFileKeys.has(fileKey)));
      return next.size === current.size ? current : next;
    });
  }, [renderableFiles]);

  useEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffWordWrap(settings.diffWordWrap);
      setDiffIgnoreWhitespace(settings.diffIgnoreWhitespace);
    }
    previousDiffOpenRef.current = diffOpen;
  }, [diffOpen, settings.diffIgnoreWhitespace, settings.diffWordWrap]);

  useEffect(() => {
    if (!selectedFilePath || !patchViewportRef.current) {
      return;
    }
    const target = Array.from(
      patchViewportRef.current.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
    ).find((element) => element.dataset.diffFilePath === selectedFilePath);
    target?.scrollIntoView({ block: "nearest" });
  }, [selectedFilePath, renderableFiles]);

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readLocalApi();
      if (!api) return;
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open diff file in editor.", error);
      });
    },
    [activeCwd],
  );
  const toggleDiffFileCollapsed = useCallback((fileKey: string) => {
    setCollapsedDiffFileKeys((current) => {
      const next = new Set(current);
      if (next.has(fileKey)) {
        next.delete(fileKey);
      } else {
        next.add(fileKey);
      }
      return next;
    });
  }, []);

  const selectTurn = (turnId: TurnId) => {
    if (!activeThread) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", diffTurnId: turnId };
      },
    });
  };
  const selectWholeConversation = () => {
    if (!activeThread) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  };
  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current;
    if (!element) {
      setCanScrollTurnStripLeft(false);
      setCanScrollTurnStripRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollTurnStripLeft(element.scrollLeft > 4);
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
  }, []);
  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current;
    if (!element) return;
    element.scrollBy({ left: offset, behavior: "smooth" });
  }, []);
  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, []);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    const onScroll = () => updateTurnStripScrollState();

    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState());
    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [updateTurnStripScrollState]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [orderedTurnDiffSummaries, selectedTurnId, updateTurnStripScrollState]);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']");
    selectedChip?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedTurn?.turnId, selectedTurnId]);

  const totalAdditions =
    diffScope === "thread"
      ? renderableFiles.reduce((total, file) => total + countFilePatchLines(file, "add"), 0)
      : (gitStatusQuery.data?.workingTree.insertions ?? 0);
  const totalDeletions =
    diffScope === "thread"
      ? renderableFiles.reduce((total, file) => total + countFilePatchLines(file, "remove"), 0)
      : (gitStatusQuery.data?.workingTree.deletions ?? 0);
  const fileCount =
    diffScope === "thread"
      ? renderableFiles.length
      : (gitStatusQuery.data?.workingTree.files.length ?? renderableFiles.length);
  const patchError =
    diffScope === "thread"
      ? checkpointDiffError
      : workingTreeDiffQuery.error instanceof Error
        ? workingTreeDiffQuery.error.message
        : workingTreeDiffQuery.error
          ? "加载 Git 差异失败。"
          : null;
  const isLoadingPatch =
    diffScope === "thread" ? isLoadingCheckpointDiff : workingTreeDiffQuery.isLoading;

  const threadTurnStrip = (
    <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
      <button
        type="button"
        className={cn(
          "absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
          canScrollTurnStripLeft
            ? "border-border/70 hover:border-border hover:text-foreground"
            : "cursor-not-allowed border-border/40 text-muted-foreground/40",
        )}
        onClick={() => scrollTurnStripBy(-180)}
        disabled={!canScrollTurnStripLeft}
        aria-label="Scroll turn list left"
      >
        <ChevronLeftIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={cn(
          "absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
          canScrollTurnStripRight
            ? "border-border/70 hover:border-border hover:text-foreground"
            : "cursor-not-allowed border-border/40 text-muted-foreground/40",
        )}
        onClick={() => scrollTurnStripBy(180)}
        disabled={!canScrollTurnStripRight}
        aria-label="Scroll turn list right"
      >
        <ChevronRightIcon className="size-3.5" />
      </button>
      <div
        ref={turnStripRef}
        className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
        style={
          canScrollTurnStripLeft || canScrollTurnStripRight
            ? {
                maskImage: `linear-gradient(to right, ${canScrollTurnStripLeft ? "transparent 24px, black 72px" : "black"}, ${canScrollTurnStripRight ? "black calc(100% - 72px), transparent calc(100% - 24px)" : "black"})`,
              }
            : undefined
        }
        onWheel={onTurnStripWheel}
      >
        <button
          type="button"
          className="shrink-0 rounded-md"
          onClick={selectWholeConversation}
          data-turn-chip-selected={selectedTurnId === null}
        >
          <div
            className={cn(
              "rounded-md border px-2 py-1 text-left transition-colors",
              selectedTurnId === null
                ? "border-border bg-accent text-accent-foreground"
                : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
            )}
          >
            <div className="text-[10px] leading-tight font-medium">All turns</div>
          </div>
        </button>
        {orderedTurnDiffSummaries.map((summary) => (
          <button
            key={summary.turnId}
            type="button"
            className="shrink-0 rounded-md"
            onClick={() => selectTurn(summary.turnId)}
            title={summary.turnId}
            data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                summary.turnId === selectedTurn?.turnId
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="flex items-center gap-1">
                <span className="text-[10px] leading-tight font-medium">
                  Turn{" "}
                  {summary.checkpointTurnCount ??
                    inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                    "?"}
                </span>
                <span className="text-[9px] leading-tight opacity-70">
                  {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const headerRow = (
    <div className="flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
      <ToggleGroup
        className="shrink-0"
        variant="default"
        size="xs"
        value={[diffScope]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "unstaged" || next === "staged" || next === "thread") {
            setDiffScope(next);
          }
        }}
      >
        <Toggle aria-label="查看未暂存差异" value="unstaged">
          未暂存
        </Toggle>
        <Toggle aria-label="查看已暂存差异" value="staged">
          已暂存
        </Toggle>
        <Toggle aria-label="查看线程差异" value="thread">
          线程
        </Toggle>
      </ToggleGroup>
      <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
        {fileCount}
      </span>
      <span className="shrink-0 text-xs text-emerald-600">+{totalAdditions}</span>
      <span className="shrink-0 text-xs text-red-500">-{totalDeletions}</span>
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
        <span className="inline-flex size-7 items-center justify-center rounded-md">
          <MoreHorizontalIcon className="size-4" />
        </span>
        <span className="inline-flex size-7 items-center justify-center rounded-md">
          <FileSearchIcon className="size-4" />
        </span>
        <span className="inline-flex size-7 items-center justify-center rounded-md">
          <Columns2Icon className="size-4" />
        </span>
        <span className="inline-flex size-7 items-center justify-center rounded-md">
          <FolderOpenIcon className="size-4" />
        </span>
        <span className="inline-flex size-7 items-center justify-center rounded-md">
          <RefreshCwIcon className="size-4" />
        </span>
        <Toggle
          aria-label={diffWordWrap ? "关闭自动换行" : "开启自动换行"}
          title={diffWordWrap ? "关闭自动换行" : "开启自动换行"}
          variant="default"
          size="xs"
          pressed={diffWordWrap}
          onPressedChange={(pressed) => {
            setDiffWordWrap(Boolean(pressed));
          }}
        >
          <TextWrapIcon className="size-3" />
        </Toggle>
        <Toggle
          aria-label={diffIgnoreWhitespace ? "显示空白变更" : "忽略空白变更"}
          title={diffIgnoreWhitespace ? "显示空白变更" : "忽略空白变更"}
          variant="default"
          size="xs"
          pressed={diffIgnoreWhitespace}
          onPressedChange={(pressed) => {
            setDiffIgnoreWhitespace(Boolean(pressed));
          }}
        >
          <PilcrowIcon className="size-3" />
        </Toggle>
      </div>
    </div>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : diffScope === "thread" && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <>
          {diffScope === "thread" ? (
            <div className="border-b border-border/60 px-3 py-2">{threadTurnStrip}</div>
          ) : null}
          <div
            ref={patchViewportRef}
            className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {patchError && !renderablePatch && (
              <div className="px-3">
                <p className="mb-2 text-[11px] text-red-500/80">{patchError}</p>
              </div>
            )}
            {!renderablePatch ? (
              isLoadingPatch ? (
                <DiffPanelLoadingState label="正在加载差异..." />
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                  <p>
                    {hasNoNetChanges
                      ? "当前范围没有净差异。"
                      : diffScope === "thread"
                        ? "当前线程没有可显示的差异。"
                        : "当前 Git 工作区没有可显示的差异。"}
                  </p>
                </div>
              )
            ) : renderablePatch.kind === "files" ? (
              <div className="h-full min-h-0 overflow-auto bg-background pb-3">
                {renderableFiles.map((fileDiff) => {
                  const filePath = resolveFileDiffPath(fileDiff);
                  const fileKey = buildFileDiffRenderKey(fileDiff);
                  const expanded = !collapsedDiffFileKeys.has(fileKey);
                  return (
                    <DiffFileRow
                      key={fileKey}
                      file={fileDiff}
                      expanded={expanded}
                      wrap={diffWordWrap}
                      onToggle={() => toggleDiffFileCollapsed(fileKey)}
                      onOpenFile={() => openDiffFileInEditor(filePath)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="h-full overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                  <pre
                    className={cn(
                      "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                      diffWordWrap
                        ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                        : "overflow-auto",
                    )}
                  >
                    {renderablePatch.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}
