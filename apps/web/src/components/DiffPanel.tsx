import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LegendList } from "@legendapp/list/react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import type {
  GitStackedAction,
  TurnId,
  VcsCommitSummary,
  VcsFileOperationInput,
} from "@t3tools/contracts";
import {
  AlignLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  CopyIcon,
  EyeIcon,
  FileCode2Icon,
  FileSearchIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  ListTreeIcon,
  MoreHorizontalIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TextWrapIcon,
  Undo2Icon,
} from "lucide-react";
import {
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { refreshGitStatus, useGitStatus } from "~/lib/gitStatusState";
import { gitRunStackedActionMutationOptions } from "~/lib/gitReactQuery";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { readEnvironmentApi } from "../environmentApi";
import { resolvePathLinkTarget } from "../terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useStore } from "../store";
import { createProjectCwdSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
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
import {
  buildDiffRenderRows,
  buildFileDiffRenderKey,
  countExpandedDiffLines,
  parseRenderableUnifiedDiff,
  type DiffRenderRow,
} from "./DiffPanel.logic";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { Button } from "./ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { resolveQuickAction } from "./GitActionsControl.logic";

type DiffScope = "unstaged" | "staged" | "commit" | "turn";

const DIFF_VIRTUALIZATION_LINE_THRESHOLD = 800;

const DIFF_SCOPE_LABELS = {
  unstaged: "未暂存",
  staged: "已暂存",
  commit: "提交",
  turn: "上轮对话",
} satisfies Record<DiffScope, string>;

function countPatchLines(files: ReadonlyArray<UnifiedDiffFilePatch>, type: "add" | "remove") {
  return files.reduce((total, file) => total + countFilePatchLines(file, type), 0);
}

function IconButton(props: {
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-45",
              props.active ? "bg-muted text-foreground" : "",
            )}
            disabled={props.disabled}
            aria-label={props.label}
            onClick={props.onClick}
          >
            {props.children}
          </button>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function FileRowActionButton(props: {
  label: string;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-70 transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35 group-hover:opacity-100"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          >
            {props.children}
          </button>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

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

  const files = parseRenderableUnifiedDiff(normalizedPatch);
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

function buildFileOperationInput(
  cwd: string,
  fileDiff: UnifiedDiffFilePatch,
): VcsFileOperationInput {
  const path = getPatchDisplayPath(fileDiff) ?? fileDiff.oldPath ?? fileDiff.newPath ?? "";
  return {
    cwd,
    path,
    ...(fileDiff.oldPath && fileDiff.oldPath !== path ? { oldPath: fileDiff.oldPath } : {}),
  };
}

function formatCommitMenuLabel(commit: VcsCommitSummary): string {
  return `${commit.shortSha} ${commit.subject}`;
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
        <span className="px-3 leading-8">{hiddenLineCount} 行未变更</span>
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

function DiffHunkHeaderRow(props: { hunk: UnifiedDiffHunk; index: number }) {
  const hiddenLineCount = getHunkHiddenLineCount(props.hunk, props.index);
  return (
    <div className="grid min-w-max grid-cols-[3.2rem_1fr] bg-muted/70 text-[11px] text-muted-foreground">
      <span className="select-none border-r border-border/50 px-2 text-center leading-8">
        <ChevronDownIcon className="mx-auto size-3.5" />
      </span>
      <span className="px-3 leading-8">{hiddenLineCount} 琛屾湭鍙樻洿</span>
    </div>
  );
}

function VirtualizedDiffFileBody(props: { file: UnifiedDiffFilePatch; wrap: boolean }) {
  const rows = useMemo(() => buildDiffRenderRows(props.file), [props.file]);
  const renderRow = useCallback(
    ({ item }: { item: DiffRenderRow }) =>
      item.kind === "hunk" ? (
        <DiffHunkHeaderRow hunk={item.hunk} index={item.index} />
      ) : (
        <DiffCodeLine
          line={item.line}
          oldLineNumber={item.oldLineNumber}
          newLineNumber={item.newLineNumber}
          wrap={props.wrap}
        />
      ),
    [props.wrap],
  );
  const keyExtractor = useCallback((item: DiffRenderRow) => item.id, []);

  return (
    <LegendList<DiffRenderRow>
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderRow}
      estimatedItemSize={20}
      className="max-h-[72vh] min-w-max overflow-auto"
    />
  );
}

function DiffFileRow(props: {
  file: UnifiedDiffFilePatch;
  expanded: boolean;
  wrap: boolean;
  virtualized: boolean;
  diffScope: DiffScope;
  operationPending?: boolean | undefined;
  onToggle: () => void;
  onOpenFile: () => void;
  onStageFile?: (() => void) | undefined;
  onUnstageFile?: (() => void) | undefined;
  onRestoreFile?: (() => void) | undefined;
}) {
  const filePath = resolveFileDiffPath(props.file);
  const additions = countFilePatchLines(props.file, "add");
  const deletions = countFilePatchLines(props.file, "remove");

  return (
    <div className="border-b border-border/35 last:border-b-0" data-diff-file-path={filePath}>
      <div className="group flex h-9 min-w-0 items-center gap-1.5 px-3 text-xs">
        <button
          type="button"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={props.expanded ? `折叠 ${filePath}` : `展开 ${filePath}`}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", props.expanded ? "" : "-rotate-90")}
          />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-foreground"
          title={filePath}
          onClick={props.onToggle}
        >
          <span className="truncate">{filePath}</span>
          {/\.(test|spec)\.[cm]?[jt]sx?$/u.test(filePath) ? (
            <span className="ml-1 inline-block size-1.5 rounded-full bg-sky-500 align-middle" />
          ) : null}
        </button>
        <span className="min-w-10 shrink-0 text-right text-emerald-600">+{additions}</span>
        <span className="min-w-7 shrink-0 text-right text-red-500">-{deletions}</span>
        {props.diffScope === "unstaged" && props.onStageFile ? (
          <FileRowActionButton
            label={`暂存 ${filePath}`}
            disabled={props.operationPending}
            onClick={props.onStageFile}
          >
            <PlusIcon className="size-3.5" />
          </FileRowActionButton>
        ) : null}
        {props.diffScope === "staged" && props.onUnstageFile ? (
          <FileRowActionButton
            label={`取消暂存 ${filePath}`}
            disabled={props.operationPending}
            onClick={props.onUnstageFile}
          >
            <MinusIcon className="size-3.5" />
          </FileRowActionButton>
        ) : null}
        {props.diffScope === "unstaged" && props.onRestoreFile ? (
          <FileRowActionButton
            label={`还原 ${filePath}`}
            disabled={props.operationPending}
            onClick={props.onRestoreFile}
          >
            <Undo2Icon className="size-3.5" />
          </FileRowActionButton>
        ) : null}
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-70 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
          aria-label={`在编辑器中打开 ${filePath}`}
          onClick={props.onOpenFile}
        >
          <FileSearchIcon className="size-3.5" />
        </button>
      </div>
      {props.expanded ? (
        <div className="overflow-x-auto px-2 pb-2">
          <div className="overflow-hidden rounded-md bg-background font-mono shadow-[inset_0_0_0_1px_var(--border)]">
            {props.virtualized ? (
              <VirtualizedDiffFileBody file={props.file} wrap={props.wrap} />
            ) : (
              props.file.hunks.map((hunk, index) => (
                <DiffHunkView
                  key={`${hunk.oldStart}:${hunk.newStart}:${index}`}
                  hunk={hunk}
                  index={index}
                  wrap={props.wrap}
                />
              ))
            )}
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
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [diffScope, setDiffScope] = useState<DiffScope>("unstaged");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [loadFullFile, setLoadFullFile] = useState(false);
  const [richTextPreview, setRichTextPreview] = useState(false);
  const [wordDiffEnabled, setWordDiffEnabled] = useState(false);
  const [hideWhitespaceChars, setHideWhitespaceChars] = useState(true);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const previousVisibleFileKeysRef = useRef<ReadonlySet<string>>(new Set());
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
  const activeProjectRef =
    activeThread && activeProjectId
      ? { environmentId: activeThread.environmentId, projectId: activeProjectId }
      : null;
  const activeProjectCwd = useStore(
    useMemo(() => createProjectCwdSelectorByRef(activeProjectRef), [activeProjectRef]),
  );
  const activeCwd = activeProjectCwd
    ? projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({
      environmentId: activeThread?.environmentId ?? null,
      cwd: activeCwd ?? null,
      queryClient,
    }),
  );
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
  const activeTurnDiffSummary = selectedTurn ?? orderedTurnDiffSummaries[0];
  const selectedCheckpointTurnCount =
    activeTurnDiffSummary &&
    (activeTurnDiffSummary.checkpointTurnCount ??
      inferredCheckpointTurnCountByTurnId[activeTurnDiffSummary.turnId]);
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
  const activeCheckpointRange = selectedCheckpointRange;
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: activeTurnDiffSummary ? `turn:${activeTurnDiffSummary.turnId}` : null,
      enabled: isGitRepo && diffScope === "turn",
    }),
  );
  const commitListQuery = useQuery({
    queryKey: ["vcs.listCommits", activeThread?.environmentId ?? null, activeCwd ?? null],
    enabled: Boolean(activeThread?.environmentId && activeCwd && isGitRepo),
    queryFn: async () => {
      if (!activeThread?.environmentId || !activeCwd) {
        return { commits: [], isRepo: false, nextCursor: null, totalCount: 0 };
      }
      const api = readEnvironmentApi(activeThread.environmentId);
      if (!api) {
        throw new Error("环境连接不可用，无法读取提交列表。");
      }
      return await api.vcs.listCommits({ cwd: activeCwd, limit: 30 });
    },
  });
  const commits = commitListQuery.data?.commits ?? [];
  const selectedCommit =
    selectedCommitSha === null
      ? null
      : (commits.find((commit) => commit.sha === selectedCommitSha) ?? null);
  const commitDiffQuery = useQuery({
    queryKey: [
      "vcs.diffCommit",
      activeThread?.environmentId ?? null,
      activeCwd ?? null,
      selectedCommitSha,
      diffIgnoreWhitespace,
    ],
    enabled: Boolean(
      activeThread?.environmentId &&
      activeCwd &&
      isGitRepo &&
      diffScope === "commit" &&
      selectedCommitSha,
    ),
    queryFn: async () => {
      if (!activeThread?.environmentId || !activeCwd || !selectedCommitSha) {
        return { diff: "" };
      }
      const api = readEnvironmentApi(activeThread.environmentId);
      if (!api) {
        throw new Error("环境连接不可用，无法读取提交差异。");
      }
      return await api.vcs.diffCommit({
        cwd: activeCwd,
        commitSha: selectedCommitSha,
        ignoreWhitespace: diffIgnoreWhitespace,
      });
    },
  });
  useEffect(() => {
    if (diffScope !== "commit") return;
    if (commits.length === 0) {
      setSelectedCommitSha((current) => (current === null ? current : null));
      return;
    }
    setSelectedCommitSha((current) =>
      current && commits.some((commit) => commit.sha === current) ? current : commits[0]!.sha,
    );
  }, [commits, diffScope]);
  const workingTreeDiffQuery = useQuery({
    queryKey: [
      "vcs.diffWorkingTree",
      activeThread?.environmentId ?? null,
      activeCwd ?? null,
      diffScope,
      diffIgnoreWhitespace,
    ],
    enabled: Boolean(
      activeThread?.environmentId &&
      activeCwd &&
      isGitRepo &&
      (diffScope === "unstaged" || diffScope === "staged"),
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
  const activeTurnCheckpointDiff = activeTurnDiffSummary
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading;
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? "加载检查点差异失败。"
        : null;

  const workingTreePatch =
    diffScope === "unstaged" || diffScope === "staged"
      ? workingTreeDiffQuery.data?.diff
      : undefined;
  const selectedPatch =
    diffScope === "turn"
      ? (selectedTurnCheckpointDiff ?? activeTurnCheckpointDiff)
      : diffScope === "commit"
        ? commitDiffQuery.data?.diff
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
      previousVisibleFileKeysRef.current = new Set();
      return;
    }

    const visibleFileKeys = new Set(renderableFiles.map(buildFileDiffRenderKey));
    setCollapsedDiffFileKeys((current) => {
      const previousVisibleFileKeys = previousVisibleFileKeysRef.current;
      const next = new Set([...current].filter((fileKey) => visibleFileKeys.has(fileKey)));
      for (const fileKey of visibleFileKeys) {
        if (!previousVisibleFileKeys.has(fileKey)) {
          next.add(fileKey);
        }
      }
      return next.size === current.size ? current : next;
    });
    previousVisibleFileKeysRef.current = visibleFileKeys;
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

  const totalAdditions = renderableFiles.length > 0 ? countPatchLines(renderableFiles, "add") : 0;
  const totalDeletions =
    renderableFiles.length > 0 ? countPatchLines(renderableFiles, "remove") : 0;
  const fileCount = renderableFiles.length > 0 ? renderableFiles.length : 0;
  const expandedDiffLineCount = useMemo(
    () => countExpandedDiffLines(renderableFiles, collapsedDiffFileKeys),
    [collapsedDiffFileKeys, renderableFiles],
  );
  const shouldVirtualizeDiffRows =
    expandedDiffLineCount > DIFF_VIRTUALIZATION_LINE_THRESHOLD;
  const patchError =
    diffScope === "turn"
      ? checkpointDiffError
      : diffScope === "commit"
        ? commitDiffQuery.error instanceof Error
          ? commitDiffQuery.error.message
          : commitDiffQuery.error
            ? "加载提交差异失败。"
            : commitListQuery.error instanceof Error
              ? commitListQuery.error.message
              : commitListQuery.error
                ? "加载提交列表失败。"
                : null
        : workingTreeDiffQuery.error instanceof Error
          ? workingTreeDiffQuery.error.message
          : workingTreeDiffQuery.error
            ? "加载 Git 差异失败。"
            : null;
  const isLoadingPatch =
    diffScope === "turn"
      ? isLoadingCheckpointDiff
      : diffScope === "commit"
        ? commitListQuery.isLoading || commitDiffQuery.isLoading
        : workingTreeDiffQuery.isLoading;
  const quickGitAction = resolveQuickAction(
    gitStatusQuery.data,
    gitActionMutation.isPending,
    gitStatusQuery.data?.isDefaultRef ?? false,
    gitStatusQuery.data?.hasPrimaryRemote ?? true,
  );
  const canRunPrimaryGitAction =
    quickGitAction.kind === "run_action" &&
    !quickGitAction.disabled &&
    Boolean(quickGitAction.action);

  const refreshReview = useCallback(
    (options?: { clearNotice?: boolean }) => {
      if (options?.clearNotice !== false) {
        setReviewNotice(null);
      }
      void workingTreeDiffQuery.refetch();
      void activeCheckpointDiffQuery.refetch();
      void commitListQuery.refetch();
      void commitDiffQuery.refetch();
      void refreshGitStatus({
        environmentId: activeThread?.environmentId ?? null,
        cwd: activeCwd ?? null,
      });
    },
    [
      activeCheckpointDiffQuery,
      activeCwd,
      activeThread?.environmentId,
      commitDiffQuery,
      commitListQuery,
      workingTreeDiffQuery,
    ],
  );
  const initRepositoryMutation = useMutation({
    mutationFn: async () => {
      if (!activeThread?.environmentId || !activeCwd) {
        throw new Error("当前没有可初始化的项目路径。");
      }
      const api = readEnvironmentApi(activeThread.environmentId);
      if (!api) {
        throw new Error("环境连接不可用，无法初始化 Git 仓库。");
      }
      return await api.vcs.init({ cwd: activeCwd, kind: "git" });
    },
    onSuccess: () => {
      setReviewNotice("已初始化 Git 仓库。");
      refreshReview({ clearNotice: false });
    },
    onError: (error) => {
      setReviewNotice(error instanceof Error ? error.message : String(error));
    },
  });
  const fileOperationMutation = useMutation({
    mutationFn: async (input: {
      operation: "stage" | "unstage" | "restore";
      file: UnifiedDiffFilePatch;
    }) => {
      if (!activeThread?.environmentId || !activeCwd) {
        throw new Error("环境连接不可用，无法执行 Git 操作。");
      }
      const api = readEnvironmentApi(activeThread.environmentId);
      if (!api) {
        throw new Error("环境连接不可用，无法执行 Git 操作。");
      }
      const payload = buildFileOperationInput(activeCwd, input.file);
      if (input.operation === "stage") {
        return await api.vcs.stageFile(payload);
      }
      if (input.operation === "unstage") {
        return await api.vcs.unstageFile(payload);
      }
      return await api.vcs.restoreFile(payload);
    },
    onSuccess: (_result, variables) => {
      const filePath = resolveFileDiffPath(variables.file);
      const message =
        variables.operation === "stage"
          ? `已暂存 ${filePath}。`
          : variables.operation === "unstage"
            ? `已取消暂存 ${filePath}。`
            : `已还原 ${filePath} 的未暂存变更。`;
      setReviewNotice(message);
      refreshReview({ clearNotice: false });
    },
    onError: (error) => {
      setReviewNotice(error instanceof Error ? error.message : String(error));
    },
  });

  const runFileOperation = useCallback(
    (operation: "stage" | "unstage" | "restore", file: UnifiedDiffFilePatch) => {
      setReviewNotice(null);
      fileOperationMutation.mutate({ operation, file });
    },
    [fileOperationMutation],
  );

  const setAllFilesExpanded = useCallback(
    (expanded: boolean) => {
      const visibleFileKeys = renderableFiles.map(buildFileDiffRenderKey);
      setCollapsedDiffFileKeys(expanded ? new Set() : new Set(visibleFileKeys));
    },
    [renderableFiles],
  );

  const copyGitApplyCommand = useCallback(() => {
    if (!selectedPatch?.trim()) {
      setReviewNotice("当前没有可复制的补丁。");
      return;
    }
    const command = `git apply --3way <<'PATCH'\n${selectedPatch.trimEnd()}\nPATCH`;
    void navigator.clipboard
      ?.writeText(command)
      .then(() => setReviewNotice("已复制 git apply 命令。"))
      .catch(() => setReviewNotice("复制失败，请检查浏览器剪贴板权限。"));
  }, [selectedPatch]);

  const runStackedAction = useCallback(
    (action: GitStackedAction) => {
      setReviewNotice(null);
      gitActionMutation.mutate(
        {
          action,
          actionId: `review-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        },
        {
          onSuccess: (result) => {
            setReviewNotice(result.toast.description ?? result.toast.title);
            refreshReview({ clearNotice: false });
          },
          onError: (error) => {
            setReviewNotice(error instanceof Error ? error.message : String(error));
          },
        },
      );
    },
    [gitActionMutation, refreshReview],
  );

  const runPrimaryGitAction = useCallback(() => {
    if (quickGitAction.kind === "run_action" && quickGitAction.action) {
      runStackedAction(quickGitAction.action);
      return;
    }
    if (quickGitAction.hint) {
      setReviewNotice(quickGitAction.hint);
    }
  }, [quickGitAction, runStackedAction]);

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
        aria-label="向左滚动对话列表"
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
        aria-label="向右滚动对话列表"
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
            <div className="text-[10px] leading-tight font-medium">最近</div>
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
                  第{" "}
                  {summary.checkpointTurnCount ??
                    inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                    "?"}
                  轮
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
    <div className="flex min-w-0 flex-1 items-center gap-1.5 [-webkit-app-region:no-drag]">
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="xs" />}
          className="h-8 shrink-0 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted"
        >
          <span>{DIFF_SCOPE_LABELS[diffScope]}</span>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
            {fileCount}
          </span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </MenuTrigger>
        <MenuPopup align="start" sideOffset={6} className="w-[210px]">
          <MenuRadioGroup
            value={diffScope}
            onValueChange={(value) => {
              if (value === "unstaged" || value === "staged" || value === "turn") {
                setDiffScope(value);
              }
            }}
          >
            <MenuRadioItem value="unstaged">
              <span className="flex min-w-0 items-center gap-2">
                <FileCode2Icon className="size-3.5 text-muted-foreground" />
                未暂存
              </span>
            </MenuRadioItem>
            <MenuRadioItem value="staged">
              <span className="flex min-w-0 items-center gap-2">
                <CheckIcon className="size-3.5 text-muted-foreground" />
                已暂存
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSub>
            <MenuSubTrigger disabled>
              <GitCommitHorizontalIcon className="size-3.5 text-muted-foreground" />
              提交
            </MenuSubTrigger>
            <MenuSubPopup className="w-40">
              <MenuItem disabled>暂无可选提交</MenuItem>
            </MenuSubPopup>
          </MenuSub>
          <MenuItem disabled>
            <GitBranchIcon className="size-3.5 text-muted-foreground" />
            分支
          </MenuItem>
          <MenuRadioGroup
            value={diffScope}
            onValueChange={(value) => {
              if (value === "turn") {
                setDiffScope("turn");
              }
            }}
          >
            <MenuRadioItem value="turn">
              <span className="flex min-w-0 items-center gap-2">
                <ListTreeIcon className="size-3.5 text-muted-foreground" />
                上轮对话
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      <span className="shrink-0 text-xs text-emerald-600">+{totalAdditions.toLocaleString()}</span>
      <span className="shrink-0 text-xs text-red-500">-{totalDeletions.toLocaleString()}</span>
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
                aria-label="更多审查操作"
              />
            }
          >
            <MoreHorizontalIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" sideOffset={6} className="w-[208px]">
            <MenuItem onClick={() => refreshReview()}>
              <RefreshCwIcon className="size-3.5" />
              刷新
            </MenuItem>
            <MenuCheckboxItem
              checked={diffWordWrap}
              onCheckedChange={(checked) => setDiffWordWrap(Boolean(checked))}
            >
              <span className="flex items-center gap-2">
                <TextWrapIcon className="size-3.5" />
                启用自动换行
              </span>
            </MenuCheckboxItem>
            <MenuItem onClick={() => setAllFilesExpanded(true)}>
              <ListTreeIcon className="size-3.5" />
              展开全部差异
            </MenuItem>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={!loadFullFile}
              onCheckedChange={(checked) => setLoadFullFile(!Boolean(checked))}
            >
              <span className="flex items-center gap-2">
                <FileCode2Icon className="size-3.5" />
                不加载完整文件
              </span>
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={richTextPreview}
              onCheckedChange={(checked) => setRichTextPreview(Boolean(checked))}
            >
              <span className="flex items-center gap-2">
                <SparklesIcon className="size-3.5" />
                启用富文本预览
              </span>
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={wordDiffEnabled}
              onCheckedChange={(checked) => setWordDiffEnabled(Boolean(checked))}
            >
              <span className="flex items-center gap-2">
                <AlignLeftIcon className="size-3.5" />
                启用文字差异
              </span>
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={hideWhitespaceChars}
              onCheckedChange={(checked) => setHideWhitespaceChars(Boolean(checked))}
            >
              <span className="flex items-center gap-2">
                <EyeIcon className="size-3.5" />
                隐藏空白字符
              </span>
            </MenuCheckboxItem>
            <MenuItem onClick={copyGitApplyCommand}>
              <CopyIcon className="size-3.5" />
              复制 git apply 命令
            </MenuItem>
          </MenuPopup>
        </Menu>
        <IconButton label="搜索变更文件">
          <FileSearchIcon className="size-4" />
        </IconButton>
        <IconButton
          label="切换并排差异"
          active={wordDiffEnabled}
          onClick={() => setWordDiffEnabled((value) => !value)}
        >
          <Columns2Icon className="size-4" />
        </IconButton>
        <IconButton
          label="打开工作区文件夹"
          disabled={!activeCwd}
          onClick={() => {
            const api = readLocalApi();
            if (!api || !activeCwd) return;
            void api.shell.openPath(activeCwd).catch((error) => {
              setReviewNotice(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          <FolderOpenIcon className="size-4" />
        </IconButton>
        <IconButton label="刷新" onClick={refreshReview}>
          <RefreshCwIcon className={cn("size-4", isLoadingPatch ? "animate-spin" : "")} />
        </IconButton>
        <IconButton
          label="提交或推送"
          active={canRunPrimaryGitAction}
          disabled={gitActionMutation.isPending}
          onClick={runPrimaryGitAction}
        >
          {quickGitAction.action === "commit" ? (
            <GitCommitHorizontalIcon className="size-4" />
          ) : quickGitAction.action === "create_pr" ||
            quickGitAction.action === "commit_push_pr" ? (
            <GitPullRequestIcon className="size-4" />
          ) : (
            <SlidersHorizontalIcon className="size-4" />
          )}
        </IconButton>
        <IconButton label="分支审查暂不可用" disabled>
          <GitBranchIcon className="size-4" />
        </IconButton>
      </div>
    </div>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          选择一个线程以查看对话差异。
        </div>
      ) : gitStatusQuery.isPending && gitStatusQuery.data === null ? (
        <DiffPanelLoadingState label="正在检测 Git 仓库状态" />
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground/70">
          <div className="flex max-w-sm flex-col items-center gap-3">
            <FileSearchIcon className="size-8 text-muted-foreground/60" />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground">当前路径不是 Git 仓库</div>
              <div>初始化 Git 仓库后，这里会显示未提交变更、提交差异和审查操作。</div>
            </div>
            {activeCwd ? (
              <div
                className="max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
                title={activeCwd}
              >
                {activeCwd}
              </div>
            ) : null}
            {reviewNotice ? (
              <div className="text-[11px] text-muted-foreground">{reviewNotice}</div>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="default"
                disabled={initRepositoryMutation.isPending || !activeCwd}
                onClick={() => initRepositoryMutation.mutate()}
              >
                <GitBranchIcon className="size-3.5" />
                初始化 Git
              </Button>
              <Button size="xs" variant="ghost" onClick={() => refreshReview()}>
                <RefreshCwIcon
                  className={cn("size-3.5", gitStatusQuery.isPending ? "animate-spin" : "")}
                />
                刷新
              </Button>
            </div>
          </div>
        </div>
      ) : diffScope === "turn" && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          暂无已完成的上轮对话。
        </div>
      ) : (
        <>
          {reviewNotice ? (
            <div className="border-b border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
              {reviewNotice}
            </div>
          ) : null}
          {diffScope === "turn" ? (
            <div className="border-b border-border/50 px-3 py-2">{threadTurnStrip}</div>
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
                      : diffScope === "turn"
                        ? "上轮对话没有可显示的差异。"
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
                  const operationPending =
                    fileOperationMutation.isPending && fileOperationMutation.variables
                      ? buildFileDiffRenderKey(fileOperationMutation.variables.file) === fileKey
                      : false;
                  return (
                    <DiffFileRow
                      key={fileKey}
                      file={fileDiff}
                      expanded={expanded}
                      wrap={diffWordWrap}
                      virtualized={shouldVirtualizeDiffRows}
                      diffScope={diffScope}
                      operationPending={operationPending}
                      onToggle={() => toggleDiffFileCollapsed(fileKey)}
                      onOpenFile={() => openDiffFileInEditor(filePath)}
                      onStageFile={
                        diffScope === "unstaged"
                          ? () => runFileOperation("stage", fileDiff)
                          : undefined
                      }
                      onUnstageFile={
                        diffScope === "staged"
                          ? () => runFileOperation("unstage", fileDiff)
                          : undefined
                      }
                      onRestoreFile={
                        diffScope === "unstaged"
                          ? () => {
                              if (
                                window.confirm(
                                  `还原 ${filePath} 的未暂存变更？这会丢弃该文件当前工作区改动。`,
                                )
                              ) {
                                runFileOperation("restore", fileDiff);
                              }
                            }
                          : undefined
                      }
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
