import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type {
  ServerProcessDiagnosticsEntry,
  ServerProcessResourceHistorySummary,
  ServerProcessSignal,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { ensureLocalApi } from "../../localApi";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { formatRelativeTime } from "../../timestampFormat";
import { useServerAvailableEditors, useServerObservability } from "../../rpc/serverState";
import {
  useProcessDiagnostics,
  useProcessResourceHistory,
} from "../../lib/processDiagnosticsState";
import { useTraceDiagnostics } from "../../lib/traceDiagnosticsState";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsSection, useRelativeTimeTick } from "./settingsLayout";

const NUMBER_FORMAT = new Intl.NumberFormat();

const DIAGNOSTICS_COPY = {
  en: {
    ariaDetails: "details",
    checking: "Checking",
    checked: "Checked",
    copied: "Copied",
    copyTraceId: "Copy trace ID",
    copyFullTraceId: "Copy full trace ID",
    showFullError: "Show full error",
    showFullMessage: "Show full message",
    showLess: "Show less",
    noTraceRecords: "No trace records",
    openLogsFolder: "Open logs folder",
    openLogsNoEditor: "No available editors found.",
    openLogsFailed: "Unable to open logs folder.",
    processAlreadyExitedTitle: "Process already exited",
    processAlreadyExitedDescription:
      "The process is not a child of the T3 Server. It might already have exited.",
    signalFailedTitle: "Could not send {signal}",
    signalFailedFallback: "Failed to send {signal}.",
    confirmKill:
      "Send SIGKILL to process {pid}? This cannot be handled by the process.",
    processTypes: {
      agent: "Agent",
      process: "Process",
      subprocess: "Subprocess",
    },
    protocol: {
      title: "Diagnostics Overview",
      summary:
        "This page helps diagnose the local IDE runtime: child provider processes, resource history, and local trace records. Empty failure tables usually mean there are no recorded failures, not that data is broken.",
      headers: ["Area", "Protocol signal", "What to check"],
      rows: [
        {
          area: "Transport",
          signal: "JSON-RPC 2.0 over stdio, WebSocket, or Unix socket",
          check:
            "If provider startup fails, inspect live child processes and the first trace failures.",
        },
        {
          area: "Handshake",
          signal: "initialize request followed by initialized notification",
          check: "Initialization errors normally appear as provider or auth trace failures.",
        },
        {
          area: "Thread and turn",
          signal: "thread/start, thread/resume, turn/start, turn/interrupt",
          check: "Slow spans and repeated failures show where a request stalls or exits.",
        },
        {
          area: "Streaming",
          signal: "item/*, turn/*, account/*, mcpServer/* notifications",
          check: "Warning and error logs reveal dropped events, auth issues, or tool failures.",
        },
      ],
      footnote:
        "Based on the Codex app-server protocol shape used by rich clients: initialize the connection, start or resume a thread, begin a turn, then consume streamed notifications.",
    },
    live: {
      title: "Live Processes",
      refresh: "Refresh process diagnostics",
      childProcesses: "Child Processes",
      memory: "Memory",
      cpuTooltip:
        "Total CPU across live child processes of the current server process. The desktop shell and other parent processes are not included.",
      memoryTooltip:
        "Total resident memory across live child processes of the current server process. The desktop shell and other parent processes are not included.",
      serverPid: "Server PID",
      loading: "Loading live processes...",
      empty:
        "No live descendant processes found. This is normal before an agent/provider process starts.",
      headers: ["Name", "CPU", "Memory", "Command", "PID", "Type", "Signal"],
      collapse: "Collapse {name}",
      expand: "Expand {name}",
      sendSigint: "Send SIGINT",
      sendSigkill: "Send SIGKILL",
    },
    resource: {
      title: "Resource History",
      refresh: "Refresh resource history",
      cpuTime: "CPU Time",
      cpuTimeTooltip:
        "Approximate active CPU time for the T3 server root process and its descendants during the selected window. It grows only while sampled processes use CPU and older samples leave as the window moves.",
      samples: "Samples",
      samplesTooltip:
        "In-memory process samples retained by the server. This resets when the server restarts.",
      interval: "Interval",
      processes: "Processes",
      collecting: "Collecting process resource samples...",
      empty:
        "No process resource samples found for this window. Wait a few seconds or refresh after starting a task.",
      headers: [
        "Process",
        "CPU Time",
        "Current",
        "Average",
        "Peak",
        "Max Mem",
        "Command",
        "PID",
      ],
      rootProcess: "Root process {name}",
      childProcess: "Child process {name}",
      cpuTooltip: "Avg {avg}%, peak {peak}%",
      cpuAria: "Average CPU {avg}%, peak CPU {peak}%",
    },
    trace: {
      title: "Trace Diagnostics",
      refresh: "Refresh trace diagnostics",
      spans: "Spans",
      failures: "Failures",
      slowSpans: "Slow Spans",
      parseErrors: "Parse Errors",
      slowSpansTooltip: "Spans with a duration of {duration} or longer.",
      slowSpansFallback: "Spans at or above the configured slow-span threshold.",
      partial:
        "Some trace files could not be read, so diagnostics may be incomplete. {message}",
      details: "Trace Details",
      emptyDetails:
        "No trace spans have been recorded yet. Run a chat turn or provider operation, then refresh diagnostics.",
    },
    tables: {
      latestFailures: "Latest Failures",
      commonFailures: "Most Common Failures",
      slowestSpans: "Slowest Spans",
      spanLogs: "Span Logs",
      topSpanNames: "Top Span Names",
      span: "Span",
      cause: "Cause",
      duration: "Duration",
      ended: "Ended",
      count: "Count",
      lastSeen: "Last Seen",
      trace: "Trace",
      time: "Time",
      level: "Level",
      message: "Message",
      failures: "Failures",
      average: "Average",
      max: "Max",
      loadingFailures: "Loading failures...",
      noFailures: "No failed spans found.",
      loadingFailureGroups: "Loading failure groups...",
      noRepeatedFailures: "No repeated failures found.",
      loadingSlowSpans: "Loading slow spans...",
      noSpans: "No spans found.",
      loadingLogs: "Loading recent logs...",
      noWarnings: "No warnings or errors found.",
      loadingSpanNames: "Loading span names...",
    },
  },
  "zh-CN": {
    ariaDetails: "详情",
    checking: "检查中",
    checked: "已检查",
    copied: "已复制",
    copyTraceId: "复制 trace ID",
    copyFullTraceId: "复制完整 trace ID",
    showFullError: "展开完整错误",
    showFullMessage: "展开完整消息",
    showLess: "收起",
    noTraceRecords: "暂无 trace 记录",
    openLogsFolder: "打开日志文件夹",
    openLogsNoEditor: "未找到可用编辑器。",
    openLogsFailed: "无法打开日志文件夹。",
    processAlreadyExitedTitle: "进程已退出",
    processAlreadyExitedDescription:
      "该进程已不是 T3 Server 的子进程，可能已经退出。",
    signalFailedTitle: "无法发送 {signal}",
    signalFailedFallback: "发送 {signal} 失败。",
    confirmKill: "确定向进程 {pid} 发送 SIGKILL 吗？该信号不能被进程自行处理。",
    processTypes: {
      agent: "智能体",
      process: "进程",
      subprocess: "子进程",
    },
    protocol: {
      title: "诊断概览",
      summary:
        "这里用于排查本地 IDE 运行时：模型服务子进程、资源历史和本地 trace 记录。故障表为空通常表示当前没有记录到失败，不代表数据损坏。",
      headers: ["范围", "协议信号", "排查重点"],
      rows: [
        {
          area: "传输",
          signal: "基于 stdio、WebSocket 或 Unix socket 的 JSON-RPC 2.0",
          check: "模型服务启动失败时，先看实时子进程和首个 trace 失败。",
        },
        {
          area: "握手",
          signal: "initialize 请求后发送 initialized 通知",
          check: "初始化错误通常会出现在 provider 或认证相关 trace 里。",
        },
        {
          area: "会话与回合",
          signal: "thread/start、thread/resume、turn/start、turn/interrupt",
          check: "慢 span 和重复失败可以定位请求卡住或退出的位置。",
        },
        {
          area: "流式事件",
          signal: "item/*、turn/*、account/*、mcpServer/* 通知",
          check: "警告和错误日志可用于定位事件丢失、认证问题或工具失败。",
        },
      ],
      footnote:
        "依据 Codex app-server 富客户端协议形态整理：先初始化连接，再启动或恢复线程，随后开始 turn 并消费流式通知。",
    },
    live: {
      title: "实时进程",
      refresh: "刷新进程诊断",
      childProcesses: "子进程",
      memory: "内存",
      cpuTooltip:
        "当前 server 进程的存活子进程 CPU 合计，不包含桌面壳层和其他父进程。",
      memoryTooltip:
        "当前 server 进程的存活子进程常驻内存合计，不包含桌面壳层和其他父进程。",
      serverPid: "Server PID",
      loading: "正在加载实时进程...",
      empty: "暂无存活子进程。尚未启动智能体或模型服务进程时这是正常状态。",
      headers: ["名称", "CPU", "内存", "命令", "PID", "类型", "信号"],
      collapse: "折叠 {name}",
      expand: "展开 {name}",
      sendSigint: "发送 SIGINT",
      sendSigkill: "发送 SIGKILL",
    },
    resource: {
      title: "资源历史",
      refresh: "刷新资源历史",
      cpuTime: "CPU 时间",
      cpuTimeTooltip:
        "所选窗口内 T3 server 根进程及其子进程的近似活跃 CPU 时间。只有采样进程使用 CPU 时才会增长，旧采样会随窗口移动被移出。",
      samples: "采样",
      samplesTooltip: "server 内存中保留的进程采样；server 重启后会清空。",
      interval: "间隔",
      processes: "进程",
      collecting: "正在采集进程资源样本...",
      empty: "当前时间窗口内暂无进程资源样本。请等待几秒，或启动任务后刷新。",
      headers: ["进程", "CPU 时间", "当前", "平均", "峰值", "最大内存", "命令", "PID"],
      rootProcess: "根进程 {name}",
      childProcess: "子进程 {name}",
      cpuTooltip: "平均 {avg}%，峰值 {peak}%",
      cpuAria: "平均 CPU {avg}%，峰值 CPU {peak}%",
    },
    trace: {
      title: "Trace 诊断",
      refresh: "刷新 trace 诊断",
      spans: "Spans",
      failures: "失败",
      slowSpans: "慢 Span",
      parseErrors: "解析错误",
      slowSpansTooltip: "耗时达到 {duration} 或更长的 span。",
      slowSpansFallback: "达到或超过当前慢 span 阈值的 span。",
      partial: "部分 trace 文件无法读取，诊断结果可能不完整。{message}",
      details: "Trace 明细",
      emptyDetails:
        "当前还没有记录到 trace span。执行一次对话或模型服务操作后，再刷新诊断。",
    },
    tables: {
      latestFailures: "最近失败",
      commonFailures: "高频失败",
      slowestSpans: "最慢 Span",
      spanLogs: "Span 日志",
      topSpanNames: "Span 计数排行",
      span: "Span",
      cause: "原因",
      duration: "耗时",
      ended: "结束时间",
      count: "次数",
      lastSeen: "最后出现",
      trace: "Trace",
      time: "时间",
      level: "级别",
      message: "消息",
      failures: "失败",
      average: "平均",
      max: "最大",
      loadingFailures: "正在加载失败记录...",
      noFailures: "暂无失败 span。",
      loadingFailureGroups: "正在加载失败分组...",
      noRepeatedFailures: "暂无重复失败。",
      loadingSlowSpans: "正在加载慢 span...",
      noSpans: "暂无 span。",
      loadingLogs: "正在加载最近日志...",
      noWarnings: "暂无警告或错误。",
      loadingSpanNames: "正在加载 span 名称...",
    },
  },
} as const;

type WidenDiagnosticsCopy<T> = T extends readonly (infer Item)[]
  ? ReadonlyArray<WidenDiagnosticsCopy<Item>>
  : T extends string
    ? string
    : T extends object
      ? { readonly [Key in keyof T]: WidenDiagnosticsCopy<T[Key]> }
      : T;

type DiagnosticsCopy = WidenDiagnosticsCopy<(typeof DIAGNOSTICS_COPY)["en"]>;

function formatCopy(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  let text = template;
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function useDiagnosticsCopy(): DiagnosticsCopy {
  const { locale } = useI18n();
  return DIAGNOSTICS_COPY[locale];
}

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatRelative(value: DateTime.Utc | null, copy: DiagnosticsCopy): string {
  if (!value) return copy.noTraceRecords;
  const relative = formatRelativeTime(DateTime.formatIso(value));
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}

function formatRelativeNoWrap(value: DateTime.Utc | null, copy: DiagnosticsCopy): string {
  return formatRelative(value, copy).replaceAll(" ", "\u00a0");
}

function shortenTraceId(traceId: string): string {
  if (traceId.length <= 32) return traceId;
  return `${traceId.slice(0, 18)}...${traceId.slice(-10)}`;
}

function isStaleProcessSignalMessage(message: string | undefined): boolean {
  return message?.includes("not a live descendant") ?? false;
}

function StatBlock({
  label,
  value,
  tooltip,
  tone = "default",
}: {
  label: string;
  value: string;
  tooltip?: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  const copy = useDiagnosticsCopy();
  return (
    <div className="min-w-0 border-border/60 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        <span className="min-w-0 truncate">{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
                  aria-label={`${label} ${copy.ariaDetails}`}
                >
                  <InfoIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup
              side="top"
              className="max-w-[min(300px,calc(100vw-2rem))] whitespace-normal text-left text-[11px] leading-relaxed text-wrap"
            >
              {tooltip}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid grid-cols-2 sm:grid-cols-4">
      <span
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border/60"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border/60 sm:hidden"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-1/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-3/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      {children}
    </div>
  );
}

function EmptyRows({ label }: { label: string }) {
  return <div className="px-4 py-4 text-xs text-muted-foreground sm:px-5">{label}</div>;
}

function ExpandableText({
  text,
  className,
  collapsedClassName = "line-clamp-3",
  expandLabel,
}: {
  text: string;
  className?: string;
  collapsedClassName?: string;
  expandLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const copy = useDiagnosticsCopy();
  const canExpand = text.length > 180 || text.includes("\n");
  const resolvedExpandLabel = expandLabel ?? copy.showFullError;

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "whitespace-pre-wrap break-words",
          !expanded && canExpand ? collapsedClassName : null,
        )}
      >
        {text}
      </div>
      {canExpand ? (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? copy.showLess : resolvedExpandLabel}
        </button>
      ) : null}
    </div>
  );
}

function DiagnosticsTable({
  headers,
  children,
  minTableWidth = "min-w-[640px]",
  columnWidths,
}: {
  headers: ReadonlyArray<string>;
  children: ReactNode;
  minTableWidth?: string;
  columnWidths?: ReadonlyArray<string>;
}) {
  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="w-full max-w-full rounded-none"
    >
      <table
        className={cn("w-full text-left text-xs", minTableWidth, columnWidths && "table-fixed")}
      >
        {columnWidths ? (
          <colgroup>
            {headers.map((header, index) => (
              <col key={header} className={columnWidths[index]} />
            ))}
          </colgroup>
        ) : null}
        <thead className="border-b border-border/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                className={cn(
                  "whitespace-nowrap px-4 py-2.5 font-semibold first:sm:pl-5 last:sm:pr-5",
                  !columnWidths && index === headers.length - 1 && "w-px",
                )}
              >
                {header.replaceAll(" ", "\u00a0")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </ScrollArea>
  );
}

function TraceIdCell({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useDiagnosticsCopy();
  const copyTraceId = useCallback(() => {
    void navigator.clipboard
      ?.writeText(traceId)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_200);
      })
      .catch(() => undefined);
  }, [traceId]);

  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {shortenTraceId(traceId)}
            </span>
          }
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(520px,calc(100vw-2rem))] break-all font-mono text-[11px]"
        >
          {traceId}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={copied ? copy.copied : copy.copyTraceId}
              onClick={copyTraceId}
            >
              <CopyIcon className="size-3" />
            </button>
          }
        />
        <TooltipPopup side="top">{copied ? copy.copied : copy.copyFullTraceId}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function formatProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function formatProcessType(
  process: ServerProcessDiagnosticsEntry,
  copy: DiagnosticsCopy,
): string {
  if (process.depth > 0) return copy.processTypes.subprocess;
  if (/\b(codex|claude|opencode|cursor)\b/i.test(process.command)) {
    return copy.processTypes.agent;
  }
  return copy.processTypes.process;
}

function ProcessNameCell({
  process,
  isExpanded,
  onToggle,
}: {
  process: ServerProcessDiagnosticsEntry;
  isExpanded: boolean;
  onToggle: (pid: number) => void;
}) {
  const name = formatProcessName(process.command);
  const copy = useDiagnosticsCopy();
  const hasChildren = process.childPids.length > 0;
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(process.depth, 6) * 10}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
                  className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={formatCopy(isExpanded ? copy.live.collapse : copy.live.expand, { name })}
          onClick={() => onToggle(process.pid)}
        >
          <ChevronIcon className="size-3.5" />
        </button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
        >
          {process.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessSignalActions({
  process,
  isSignaling,
  onSignal,
}: {
  process: ServerProcessDiagnosticsEntry;
  isSignaling: boolean;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
}) {
  const copy = useDiagnosticsCopy();
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={isSignaling}
              className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onSignal(process.pid, "SIGINT")}
            >
              INT
            </button>
          }
        />
        <TooltipPopup side="top">{copy.live.sendSigint}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={isSignaling}
              className="text-[11px] font-medium text-destructive underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onSignal(process.pid, "SIGKILL")}
            >
              KILL
            </button>
          }
        />
        <TooltipPopup side="top">{copy.live.sendSigkill}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessDiagnosticsTable({
  processes,
  signalingPid,
  onSignal,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
  signalingPid: number | null;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
  emptyLabel?: string;
}) {
  const copy = useDiagnosticsCopy();
  const [collapsedPids, setCollapsedPids] = useState<ReadonlySet<number>>(() => new Set());
  const visibleProcesses = useMemo(() => {
    const visible: ServerProcessDiagnosticsEntry[] = [];
    let hiddenChildDepth: number | null = null;

    for (const process of processes) {
      if (hiddenChildDepth !== null) {
        if (process.depth > hiddenChildDepth) continue;
        hiddenChildDepth = null;
      }

      visible.push(process);
      if (collapsedPids.has(process.pid)) {
        hiddenChildDepth = process.depth;
      }
    }

    return visible;
  }, [collapsedPids, processes]);

  const toggleProcess = useCallback((pid: number) => {
    setCollapsedPids((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  }, []);

  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="max-h-[min(64vh,44rem)] w-full max-w-full rounded-none border-t border-border/60"
    >
      <table className="w-full min-w-[1040px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[33%]" />
          <col className="w-[8%]" />
          <col className="w-[11%]" />
          <col className="w-[6%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">{copy.live.headers[0]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.live.headers[1]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.live.headers[2]}</th>
            <th className="px-3 py-2 font-semibold">{copy.live.headers[3]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.live.headers[4]}</th>
            <th className="px-3 py-2 font-semibold">{copy.live.headers[5]}</th>
            <th className="p-2 text-right font-semibold sm:pr-4">{copy.live.headers[6]}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {visibleProcesses.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                {emptyLabel ?? "No live descendant processes found."}
              </td>
            </tr>
          ) : null}
          {visibleProcesses.map((process) => (
            <tr key={process.pid} className="hover:bg-muted/20">
              <td className="px-4 py-2 align-middle sm:pl-5">
                <ProcessNameCell
                  process={process}
                  isExpanded={!collapsedPids.has(process.pid)}
                  onToggle={toggleProcess}
                />
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.cpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {formatBytes(process.rssBytes)}
              </td>
              <td className="px-3 py-2 align-middle text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="block truncate">{process.command}</span>}
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
                  >
                    {process.command}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground">
                {process.pid}
              </td>
              <td className="truncate px-3 py-2 align-middle text-muted-foreground">
                {formatProcessType(process, copy)}
              </td>
              <td className="p-2 align-middle sm:pr-4">
                <ProcessSignalActions
                  process={process}
                  isSignaling={signalingPid === process.pid}
                  onSignal={onSignal}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

const RESOURCE_HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 30_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 60_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 2 * 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 5 * 60_000 },
] as const;

function formatCpuTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

function formatShortProcessName(command: string): string {
  const name = formatProcessName(command);
  return name.length > 42 ? `${name.slice(0, 39)}...` : name;
}

function ResourceHistoryProcessNameCell({
  process,
  visualDepth,
}: {
  process: ServerProcessResourceHistorySummary;
  visualDepth: number;
}) {
  const name = formatShortProcessName(process.command);
  const copy = useDiagnosticsCopy();

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(visualDepth, 6) * 10}px` }}
      aria-label={formatCopy(
        process.isServerRoot ? copy.resource.rootProcess : copy.resource.childProcess,
        { name },
      )}
    >
      <span className="size-5 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          process.isServerRoot ? "bg-amber-500/90" : "bg-emerald-500/80",
        )}
      />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
        >
          {process.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<{
    readonly startedAt: DateTime.Utc;
    readonly avgCpuPercent: number;
    readonly maxCpuPercent: number;
  }>;
}) {
  const maxCpuPercent = Math.max(1, ...buckets.map((bucket) => bucket.maxCpuPercent));
  const copy = useDiagnosticsCopy();

  return (
    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
      <div className="flex h-28 items-end gap-1 overflow-hidden rounded-sm bg-muted/10 p-2">
        {buckets.map((bucket) => {
          const peakHeight = Math.max(2, (bucket.maxCpuPercent / maxCpuPercent) * 100);
          const averageHeight = Math.max(2, (bucket.avgCpuPercent / maxCpuPercent) * 100);
          return (
            <Tooltip key={DateTime.formatIso(bucket.startedAt)}>
              <TooltipTrigger
                render={
                  <div className="flex h-full min-w-1 flex-1 items-end">
                    <div
                      className="relative h-full w-full"
                      aria-label={formatCopy(copy.resource.cpuAria, {
                        avg: bucket.avgCpuPercent.toFixed(1),
                        peak: bucket.maxCpuPercent.toFixed(1),
                      })}
                    >
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/15 transition-colors"
                        style={{ height: `${peakHeight}%` }}
                      />
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/60 transition-colors"
                        style={{ height: `${averageHeight}%` }}
                      />
                    </div>
                  </div>
                }
              />
              <TooltipPopup side="top">
                {formatCopy(copy.resource.cpuTooltip, {
                  avg: bucket.avgCpuPercent.toFixed(1),
                  peak: bucket.maxCpuPercent.toFixed(1),
                })}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function ResourceHistoryWindowSelector({
  selectedWindowMs,
  onSelect,
}: {
  selectedWindowMs: number;
  onSelect: (windowMs: number) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-border/60 p-0.5">
      {RESOURCE_HISTORY_WINDOWS.map((option) => (
        <button
          key={option.windowMs}
          type="button"
          className={cn(
            "h-6 rounded-sm px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground",
            selectedWindowMs === option.windowMs && "bg-muted text-foreground",
          )}
          onClick={() => onSelect(option.windowMs)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ProcessResourceHistoryTable({
  processes,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessResourceHistorySummary>;
  emptyLabel: string;
}) {
  const copy = useDiagnosticsCopy();
  const shallowestChildDepth = processes.reduce<number | null>((minDepth, process) => {
    if (process.isServerRoot) return minDepth;
    return minDepth === null ? process.depth : Math.min(minDepth, process.depth);
  }, null);

  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="max-h-[min(64vh,44rem)] w-full max-w-full border-t border-border/60"
    >
      <table className="w-full min-w-[980px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[16%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">{copy.resource.headers[0]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.resource.headers[1]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.resource.headers[2]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.resource.headers[3]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.resource.headers[4]}</th>
            <th className="px-3 py-2 text-right font-semibold">{copy.resource.headers[5]}</th>
            <th className="px-3 py-2 font-semibold">{copy.resource.headers[6]}</th>
            <th className="px-3 py-2 text-right font-semibold sm:pr-5">
              {copy.resource.headers[7]}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {processes.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                {emptyLabel}
              </td>
            </tr>
          ) : null}
          {processes.map((process) => (
            <tr key={process.processKey} className="hover:bg-muted/20">
              <td className="px-4 py-2 align-middle sm:pl-5">
                <ResourceHistoryProcessNameCell
                  process={process}
                  visualDepth={
                    process.isServerRoot || shallowestChildDepth === null
                      ? 0
                      : Math.max(1, process.depth - shallowestChildDepth + 1)
                  }
                />
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {formatCpuTime(process.cpuSecondsApprox)}
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.currentCpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.avgCpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.maxCpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {formatBytes(process.maxRssBytes)}
              </td>
              <td className="px-3 py-2 align-middle text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="block truncate">{process.command}</span>}
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
                  >
                    {process.command}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground sm:pr-5">
                {process.pid}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function DiagnosticsLastChecked({ checkedAt }: { checkedAt: DateTime.Utc | null }) {
  useRelativeTimeTick();
  const copy = useDiagnosticsCopy();
  const relative = checkedAt ? formatRelativeTime(DateTime.formatIso(checkedAt)) : null;

  if (!relative) {
    return <span className="text-[11px] text-muted-foreground/50">{copy.checking}</span>;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {relative.suffix ? (
        <>
          {copy.checked} <span className="font-mono tabular-nums">{relative.value}</span>{" "}
          {relative.suffix}
        </>
      ) : (
        <>{copy.checked} {relative.value}</>
      )}
    </span>
  );
}

function DiagnosticsRefreshButton({
  isPending,
  label,
  onClick,
}: {
  isPending: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            disabled={isPending}
            onClick={onClick}
            aria-label={label}
          >
            <RefreshCwIcon className={cn("size-3", isPending && "animate-spin")} />
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ProtocolDiagnosticsOverview() {
  const copy = useDiagnosticsCopy();

  return (
    <SettingsSection title={copy.protocol.title}>
      <div className="border-b border-border/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
        {copy.protocol.summary}
      </div>
      <DiagnosticsTable
        headers={copy.protocol.headers}
        minTableWidth="min-w-[840px]"
        columnWidths={["w-[18%]", "w-[34%]", "w-[48%]"]}
      >
        {copy.protocol.rows.map((row) => (
          <tr key={row.area}>
            <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
              {row.area}
            </td>
            <td className="px-4 py-3 align-top font-mono text-[11px] text-muted-foreground">
              {row.signal}
            </td>
            <td className="px-4 py-3 align-top text-muted-foreground last:sm:pr-5">
              {row.check}
            </td>
          </tr>
        ))}
      </DiagnosticsTable>
      <div className="border-t border-border/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
        {copy.protocol.footnote}
      </div>
    </SettingsSection>
  );
}

export function DiagnosticsSettingsPanel() {
  const copy = useDiagnosticsCopy();
  const observability = useServerObservability();
  const availableEditors = useServerAvailableEditors();
  const [resourceWindowMs, setResourceWindowMs] = useState(15 * 60_000);
  const selectedResourceWindow =
    RESOURCE_HISTORY_WINDOWS.find((option) => option.windowMs === resourceWindowMs) ??
    RESOURCE_HISTORY_WINDOWS[1];
  const { data, error, isPending, refresh } = useTraceDiagnostics();
  const {
    data: processData,
    error: processError,
    isPending: isProcessPending,
    refresh: refreshProcesses,
  } = useProcessDiagnostics();
  const {
    data: resourceData,
    error: resourceError,
    isPending: isResourcePending,
    refresh: refreshResources,
  } = useProcessResourceHistory({
    windowMs: selectedResourceWindow.windowMs,
    bucketMs: selectedResourceWindow.bucketMs,
  });
  const [isOpeningLogsDirectory, setIsOpeningLogsDirectory] = useState(false);
  const [openLogsDirectoryError, setOpenLogsDirectoryError] = useState<string | null>(null);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);

  const openLogsDirectory = useCallback(() => {
    const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
    if (!logsDirectoryPath) return;

    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenLogsDirectoryError(copy.openLogsNoEditor);
      return;
    }

    setIsOpeningLogsDirectory(true);
    setOpenLogsDirectoryError(null);
    void ensureLocalApi()
      .shell.openInEditor(logsDirectoryPath, editor)
      .catch((error: unknown) => {
        setOpenLogsDirectoryError(
          error instanceof Error ? error.message : copy.openLogsFailed,
        );
      })
      .finally(() => {
        setIsOpeningLogsDirectory(false);
      });
  }, [availableEditors, copy.openLogsFailed, copy.openLogsNoEditor, observability?.logsDirectoryPath]);

  const isInitialLoading = isPending && data === null;
  const isProcessInitialLoading = isProcessPending && processData === null;
  const signalProcess = useCallback(
    (pid: number, signal: ServerProcessSignal) => {
      if (
        signal === "SIGKILL" &&
        !window.confirm(formatCopy(copy.confirmKill, { pid }))
      ) {
        return;
      }

      setSignalingPid(pid);
      void ensureLocalApi()
        .server.signalProcess({ pid, signal })
        .then((result) => {
          if (!result.signaled) {
            const message = Option.getOrUndefined(result.message);
            refreshProcesses();
            if (isStaleProcessSignalMessage(message)) {
              toastManager.add({
                type: "info",
                title: copy.processAlreadyExitedTitle,
                description: copy.processAlreadyExitedDescription,
              });
              return;
            }

            toastManager.add({
              type: "error",
              title: formatCopy(copy.signalFailedTitle, { signal }),
              description: message ?? formatCopy(copy.signalFailedFallback, { signal }),
            });
            return;
          }
          refreshProcesses();
        })
        .catch((error: unknown) => {
          toastManager.add({
          type: "error",
          title: formatCopy(copy.signalFailedTitle, { signal }),
          description:
            error instanceof Error
              ? error.message
              : formatCopy(copy.signalFailedFallback, { signal }),
        });
        })
        .finally(() => {
          setSignalingPid(null);
        });
    },
    [copy, refreshProcesses],
  );

  const processDiagnosticsError = processData ? Option.getOrNull(processData.error) : null;
  const processResourceError = resourceData ? Option.getOrNull(resourceData.error) : null;
  const traceDiagnosticsError = data ? Option.getOrNull(data.error) : null;
  const traceDiagnosticsPartialFailure = data
    ? Option.getOrElse(data.partialFailure, () => false)
    : false;
  const hasTraceDetails =
    isInitialLoading ||
    (data !== null &&
      (data.recordCount > 0 ||
        data.latestFailures.length > 0 ||
        data.commonFailures.length > 0 ||
        data.slowestSpans.length > 0 ||
        data.latestWarningAndErrorLogs.length > 0 ||
        data.topSpansByCount.length > 0));

  return (
    <SettingsPageContainer>
      <ProtocolDiagnosticsOverview />
      <SettingsSection
        title={copy.live.title}
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={processData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              isPending={isProcessPending}
              label={copy.live.refresh}
              onClick={refreshProcesses}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label={copy.live.childProcesses}
            value={processData ? formatCount(processData.processCount) : "..."}
          />
          <StatBlock
            label="CPU"
            value={processData ? `${processData.totalCpuPercent.toFixed(1)}%` : "..."}
            tooltip={copy.live.cpuTooltip}
          />
          <StatBlock
            label={copy.live.memory}
            value={processData ? formatBytes(processData.totalRssBytes) : "..."}
            tooltip={copy.live.memoryTooltip}
          />
          <StatBlock
            label={copy.live.serverPid}
            value={processData ? String(processData.serverPid) : "..."}
          />
        </StatsGrid>
        {processDiagnosticsError || processError ? (
          <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            {processDiagnosticsError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{processDiagnosticsError.message}</span>
              </div>
            ) : null}
            {processError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{processError}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <ProcessDiagnosticsTable
          processes={processData?.processes ?? []}
          signalingPid={signalingPid}
          onSignal={signalProcess}
          emptyLabel={
            isProcessInitialLoading
              ? copy.live.loading
              : copy.live.empty
          }
        />
      </SettingsSection>

      <SettingsSection
        title={copy.resource.title}
        headerAction={
          <div className="flex items-center gap-1.5">
            <ResourceHistoryWindowSelector
              selectedWindowMs={resourceWindowMs}
              onSelect={setResourceWindowMs}
            />
            <DiagnosticsLastChecked checkedAt={resourceData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              isPending={isResourcePending}
              label={copy.resource.refresh}
              onClick={refreshResources}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label={copy.resource.cpuTime}
            value={resourceData ? formatCpuTime(resourceData.totalCpuSecondsApprox) : "..."}
            tooltip={copy.resource.cpuTimeTooltip}
          />
          <StatBlock
            label={copy.resource.samples}
            value={resourceData ? formatCount(resourceData.retainedSampleCount) : "..."}
            tooltip={copy.resource.samplesTooltip}
          />
          <StatBlock
            label={copy.resource.interval}
            value={resourceData ? formatDuration(resourceData.sampleIntervalMs) : "..."}
          />
          <StatBlock
            label={copy.resource.processes}
            value={resourceData ? formatCount(resourceData.topProcesses.length) : "..."}
          />
        </StatsGrid>
        {processResourceError || resourceError ? (
          <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            {processResourceError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{processResourceError.message}</span>
              </div>
            ) : null}
            {resourceError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{resourceError}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <ProcessResourceHistoryChart buckets={resourceData?.buckets ?? []} />
        <ProcessResourceHistoryTable
          processes={resourceData?.topProcesses ?? []}
          emptyLabel={
            isResourcePending && resourceData === null
              ? copy.resource.collecting
              : copy.resource.empty
          }
        />
      </SettingsSection>

      <SettingsSection
        title={copy.trace.title}
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={data?.readAt ?? null} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={!observability?.logsDirectoryPath || isOpeningLogsDirectory}
                    onClick={openLogsDirectory}
                    aria-label={copy.openLogsFolder}
                  >
                    <FolderOpenIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">{copy.openLogsFolder}</TooltipPopup>
            </Tooltip>
            <DiagnosticsRefreshButton
              isPending={isPending}
              label={copy.trace.refresh}
              onClick={refresh}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock label={copy.trace.spans} value={data ? formatCount(data.recordCount) : "..."} />
          <StatBlock
            label={copy.trace.failures}
            value={data ? formatCount(data.failureCount) : "..."}
            tone={data && data.failureCount > 0 ? "danger" : "default"}
          />
          <StatBlock
            label={copy.trace.slowSpans}
            value={data ? formatCount(data.slowSpanCount) : "..."}
            tooltip={
              data
                ? formatCopy(copy.trace.slowSpansTooltip, {
                    duration: formatDuration(data.slowSpanThresholdMs),
                  })
                : copy.trace.slowSpansFallback
            }
            tone={data && data.slowSpanCount > 0 ? "warning" : "default"}
          />
          <StatBlock
            label={copy.trace.parseErrors}
            value={data ? formatCount(data.parseErrorCount) : "..."}
            tone={data && data.parseErrorCount > 0 ? "warning" : "default"}
          />
        </StatsGrid>
        {openLogsDirectoryError || traceDiagnosticsError || error ? (
          <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            {openLogsDirectoryError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{openLogsDirectoryError}</span>
              </div>
            ) : null}
            {traceDiagnosticsError ? (
              <div
                className={cn(
                  "flex items-start gap-2",
                  traceDiagnosticsPartialFailure
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-destructive",
                )}
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {traceDiagnosticsPartialFailure
                    ? formatCopy(copy.trace.partial, { message: traceDiagnosticsError.message })
                    : traceDiagnosticsError.message}
                </span>
              </div>
            ) : null}
            {error ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      {hasTraceDetails ? (
        <>
      <SettingsSection title={copy.tables.latestFailures}>
        {data && data.latestFailures.length > 0 ? (
          <DiagnosticsTable
            headers={[
              copy.tables.span,
              copy.tables.cause,
              copy.tables.duration,
              copy.tables.ended,
            ]}
          >
            {data.latestFailures.map((failure) => (
              <tr key={`${failure.traceId}:${failure.spanId}`}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {failure.name}
                </td>
                <td className="max-w-[360px] px-4 py-3 align-top text-muted-foreground">
                  <ExpandableText text={failure.cause} />
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">
                  {formatDuration(failure.durationMs)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                  {formatRelativeNoWrap(failure.endedAt, copy)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={isInitialLoading ? copy.tables.loadingFailures : copy.tables.noFailures}
          />
        )}
      </SettingsSection>

      <SettingsSection title={copy.tables.commonFailures}>
        {data && data.commonFailures.length > 0 ? (
          <DiagnosticsTable
            headers={[
              copy.tables.span,
              copy.tables.count,
              copy.tables.cause,
              copy.tables.lastSeen,
            ]}
            minTableWidth="min-w-[760px]"
          >
            {data.commonFailures.map((failure) => (
              <tr key={`${failure.name}:${failure.cause}`}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {failure.name}
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">
                  {formatCount(failure.count)}
                </td>
                <td className="max-w-[360px] px-4 py-3 align-top text-muted-foreground">
                  <ExpandableText text={failure.cause} />
                </td>
                <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                  {formatRelativeNoWrap(failure.lastSeenAt, copy)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={
              isInitialLoading
                ? copy.tables.loadingFailureGroups
                : copy.tables.noRepeatedFailures
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title={copy.tables.slowestSpans}>
        {data && data.slowestSpans.length > 0 ? (
          <DiagnosticsTable
            headers={[
              copy.tables.span,
              copy.tables.duration,
              copy.tables.ended,
              copy.tables.trace,
            ]}
            minTableWidth="min-w-[900px]"
            columnWidths={["w-[44%]", "w-[14%]", "w-[12%]", "w-[30%]"]}
          >
            {data.slowestSpans.map((span) => (
              <tr key={`${span.traceId}:${span.spanId}`}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {span.name}
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">
                  {formatDuration(span.durationMs)}
                </td>
                <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground">
                  {formatRelativeNoWrap(span.endedAt, copy)}
                </td>
                <td className="min-w-0 whitespace-nowrap px-4 py-3 align-top text-muted-foreground last:sm:pr-5">
                  <TraceIdCell traceId={span.traceId} />
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={isInitialLoading ? copy.tables.loadingSlowSpans : copy.tables.noSpans}
          />
        )}
      </SettingsSection>

      <SettingsSection title={copy.tables.spanLogs}>
        {data && data.latestWarningAndErrorLogs.length > 0 ? (
          <ScrollArea
            chainVerticalScroll
            scrollFade
            hideScrollbars
            className="w-full max-w-full rounded-none"
          >
            <table className="w-full min-w-[920px] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[11%]" />
                <col className="w-[9%]" />
                <col className="w-[24%]" />
                <col className="w-[26%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead className="border-b border-border/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold sm:pl-5">
                    {copy.tables.time}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold">
                    {copy.tables.level}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold">
                    {copy.tables.span}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold">
                    {copy.tables.message}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold sm:pr-5">
                    {copy.tables.trace}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.latestWarningAndErrorLogs.map((event) => (
                  <tr
                    key={`${event.traceId}:${event.spanId}:${DateTime.formatIso(event.seenAt)}:${event.message}`}
                    className="hover:bg-muted/15"
                  >
                    <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground sm:pl-5">
                      {formatRelativeNoWrap(event.seenAt, copy)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase text-foreground/80">
                        {event.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="truncate font-medium text-foreground">{event.spanName}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      <ExpandableText
                        collapsedClassName="line-clamp-2"
                        expandLabel={copy.showFullMessage}
                        text={event.message}
                      />
                    </td>
                    <td className="min-w-0 whitespace-nowrap px-4 py-3 align-top text-muted-foreground sm:pr-5">
                      <TraceIdCell traceId={event.traceId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <EmptyRows
            label={isInitialLoading ? copy.tables.loadingLogs : copy.tables.noWarnings}
          />
        )}
      </SettingsSection>

      <SettingsSection title={copy.tables.topSpanNames}>
        {data && data.topSpansByCount.length > 0 ? (
          <DiagnosticsTable
            headers={[
              copy.tables.span,
              copy.tables.count,
              copy.tables.failures,
              copy.tables.average,
              copy.tables.max,
            ]}
            minTableWidth="min-w-[760px]"
            columnWidths={["w-[48%]", "w-[13%]", "w-[13%]", "w-[13%]", "w-[13%]"]}
          >
            {data.topSpansByCount.map((span) => (
              <tr key={span.name}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {span.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {formatCount(span.count)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {formatCount(span.failureCount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {formatDuration(span.averageDurationMs)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums last:sm:pr-5">
                  {formatDuration(span.maxDurationMs)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={isInitialLoading ? copy.tables.loadingSpanNames : copy.tables.noSpans}
          />
        )}
      </SettingsSection>
        </>
      ) : (
        <SettingsSection title={copy.trace.details}>
          <EmptyRows label={copy.trace.emptyDetails} />
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}
