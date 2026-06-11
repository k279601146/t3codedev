import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  type Automation,
  type AutomationRun,
  type AutomationSchedule,
  type AutomationTarget,
  type AutomationUpsertInput,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  BotIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  Clock3Icon,
  ExternalLinkIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  AUTOMATION_CHAT_CREATE_PROMPT,
  AUTOMATION_REVIEW_QUEUE_TEMPLATE,
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from "~/automations/automationTemplates";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { cn } from "~/lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectThreadShellsAcrossEnvironments,
  useStore,
} from "~/store";
import type { Project, ThreadShell } from "~/types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";

const AUTOMATIONS_QUERY = ["automations", "snapshot"] as const;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

type InboxFilter = "unread" | "all";
type ScheduleKind = AutomationSchedule["kind"];
type TargetKind = AutomationTarget["kind"];

interface AutomationDraft {
  readonly id?: Automation["id"];
  readonly title: string;
  readonly prompt: string;
  readonly status: Automation["status"];
  readonly scheduleKind: ScheduleKind;
  readonly intervalMinutes: string;
  readonly dailyTime: string;
  readonly weeklyWeekday: string;
  readonly weeklyTime: string;
  readonly cronExpression: string;
  readonly targetKind: TargetKind;
  readonly projectId: string;
  readonly threadId: string;
  readonly runMode: "worktree" | "local";
  readonly baseBranch: string;
  readonly modelInstanceId: string;
  readonly model: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

function automationsClient() {
  return getPrimaryEnvironmentConnection().client.automations;
}

function terminalRun(run: AutomationRun): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "skipped";
}

function formatDateTime(value: string | null): string {
  if (!value) return "未安排";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function scheduleLabel(schedule: AutomationSchedule): string {
  switch (schedule.kind) {
    case "interval":
      return `每 ${schedule.minutes} 分钟`;
    case "daily":
      return `每天 ${schedule.time}`;
    case "weekly":
      return `每${WEEKDAYS[schedule.weekday]} ${schedule.time}`;
    case "cron":
      return `cron: ${schedule.expression}`;
  }
}

function targetLabel(target: AutomationTarget, projects: readonly Project[], threads: readonly ThreadShell[]) {
  if (target.kind === "thread") {
    const thread = threads.find((item) => item.id === target.threadId);
    return thread ? `线程：${thread.title}` : `线程：${target.threadId}`;
  }
  const project = projects.find((item) => item.id === target.projectId);
  return project ? `项目：${project.name}` : `项目：${target.projectId}`;
}

function runStatusLabel(status: AutomationRun["status"]): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "skipped":
      return "已跳过";
  }
}

function runStatusVariant(status: AutomationRun["status"]): React.ComponentProps<typeof Badge>["variant"] {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "skipped":
      return "warning";
    case "running":
    case "queued":
      return "info";
  }
}

function defaultModelSelection(projects: readonly Project[], threads: readonly ThreadShell[]): ModelSelection {
  return (
    projects.find((project) => project.defaultModelSelection)?.defaultModelSelection ??
    threads[0]?.modelSelection ?? {
      instanceId: ProviderInstanceId.make("codex"),
      model: DEFAULT_MODEL,
    }
  );
}

function createEmptyDraft(projects: readonly Project[], threads: readonly ThreadShell[]): AutomationDraft {
  const firstProject = projects[0] ?? null;
  const firstThread = threads[0] ?? null;
  const modelSelection = firstProject?.defaultModelSelection ?? firstThread?.modelSelection ?? defaultModelSelection(projects, threads);
  return {
    title: "",
    prompt: "",
    status: "enabled",
    scheduleKind: "daily",
    intervalMinutes: "60",
    dailyTime: "09:00",
    weeklyWeekday: "1",
    weeklyTime: "09:00",
    cronExpression: "0 9 * * *",
    targetKind: firstProject ? "project" : "thread",
    projectId: firstProject?.id ?? "",
    threadId: firstThread?.id ?? "",
    runMode: "worktree",
    baseBranch: "",
    modelInstanceId: modelSelection.instanceId,
    model: modelSelection.model,
    runtimeMode: "auto-accept-edits",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  };
}

function draftFromAutomation(automation: Automation): AutomationDraft {
  const scheduleFields = (() => {
    switch (automation.schedule.kind) {
      case "interval":
        return {
          scheduleKind: "interval" as const,
          intervalMinutes: String(automation.schedule.minutes),
          dailyTime: "09:00",
          weeklyWeekday: "1",
          weeklyTime: "09:00",
          cronExpression: "0 9 * * *",
        };
      case "daily":
        return {
          scheduleKind: "daily" as const,
          intervalMinutes: "60",
          dailyTime: automation.schedule.time,
          weeklyWeekday: "1",
          weeklyTime: "09:00",
          cronExpression: "0 9 * * *",
        };
      case "weekly":
        return {
          scheduleKind: "weekly" as const,
          intervalMinutes: "60",
          dailyTime: "09:00",
          weeklyWeekday: String(automation.schedule.weekday),
          weeklyTime: automation.schedule.time,
          cronExpression: "0 9 * * *",
        };
      case "cron":
        return {
          scheduleKind: "cron" as const,
          intervalMinutes: "60",
          dailyTime: "09:00",
          weeklyWeekday: "1",
          weeklyTime: "09:00",
          cronExpression: automation.schedule.expression,
        };
    }
  })();

  return {
    id: automation.id,
    title: automation.title,
    prompt: automation.prompt,
    status: automation.status,
    ...scheduleFields,
    targetKind: automation.target.kind,
    projectId: automation.target.kind === "project" ? automation.target.projectId : "",
    threadId: automation.target.kind === "thread" ? automation.target.threadId : "",
    runMode: automation.target.kind === "project" ? automation.target.runMode : "worktree",
    baseBranch: automation.target.kind === "project" ? (automation.target.baseBranch ?? "") : "",
    modelInstanceId: automation.modelSelection.instanceId,
    model: automation.modelSelection.model,
    runtimeMode: automation.runtimeMode,
    interactionMode: automation.interactionMode,
  };
}

function draftFromTemplate(
  template: AutomationTemplate,
  projects: readonly Project[],
  threads: readonly ThreadShell[],
): AutomationDraft {
  const draft = createEmptyDraft(projects, threads);
  const weekly = template.id.includes("weekly");
  const interval = template.id.includes("ci") || template.id.includes("bug");
  return {
    ...draft,
    title: template.title,
    prompt: template.prompt.replace(/^创建一个自动化：/, ""),
    scheduleKind: weekly ? "weekly" : interval ? "interval" : "daily",
    intervalMinutes: interval ? "120" : draft.intervalMinutes,
  };
}

function buildSchedule(draft: AutomationDraft): AutomationSchedule {
  switch (draft.scheduleKind) {
    case "interval":
      return { kind: "interval", minutes: Math.max(1, Number(draft.intervalMinutes) || 60) };
    case "daily":
      return { kind: "daily", time: draft.dailyTime || "09:00" };
    case "weekly":
      return {
        kind: "weekly",
        weekday: Math.min(6, Math.max(0, Number(draft.weeklyWeekday) || 1)),
        time: draft.weeklyTime || "09:00",
      };
    case "cron":
      return { kind: "cron", expression: draft.cronExpression.trim() || "0 9 * * *" };
  }
}

function buildTarget(draft: AutomationDraft): AutomationTarget {
  if (draft.targetKind === "thread") {
    return {
      kind: "thread",
      threadId: ThreadId.make(draft.threadId),
    };
  }
  return {
    kind: "project",
    projectId: ProjectId.make(draft.projectId),
    runMode: draft.runMode,
    ...(draft.baseBranch.trim() ? { baseBranch: draft.baseBranch.trim() } : {}),
  };
}

function buildUpsertInput(draft: AutomationDraft): AutomationUpsertInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    status: draft.status,
    schedule: buildSchedule(draft),
    target: buildTarget(draft),
    modelSelection: {
      instanceId: ProviderInstanceId.make(draft.modelInstanceId.trim() || "codex"),
      model: draft.model.trim() || DEFAULT_MODEL,
    },
    runtimeMode: draft.runtimeMode,
    interactionMode: draft.interactionMode,
  };
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectThreadShellsAcrossEnvironments));
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("unread");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);

  const query = useQuery({
    queryKey: AUTOMATIONS_QUERY,
    queryFn: () => automationsClient().list({ inbox: "all" }),
    staleTime: 10_000,
  });

  useEffect(() => {
    return automationsClient().subscribe((event) => {
      queryClient.setQueryData(AUTOMATIONS_QUERY, event.snapshot);
    });
  }, [queryClient]);

  const automations = query.data?.automations ?? [];
  const runs = query.data?.runs ?? [];

  const inboxRuns = useMemo(
    () =>
      runs.filter((run) => {
        if (!terminalRun(run) || run.archivedAt !== null) return false;
        if (inboxFilter === "unread" && run.readAt !== null) return false;
        return true;
      }),
    [inboxFilter, runs],
  );

  const runByAutomationId = useMemo(() => {
    const map = new Map<Automation["id"], AutomationRun>();
    for (const run of runs) {
      if (!map.has(run.automationId)) {
        map.set(run.automationId, run);
      }
    }
    return map;
  }, [runs]);

  const refreshSnapshot = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY });
  }, [queryClient]);

  const upsertMutation = useMutation({
    mutationFn: (input: AutomationUpsertInput) => automationsClient().upsert(input),
    onSuccess: () => {
      setDraft(null);
      refreshSnapshot();
      toastManager.add({ type: "success", title: "自动化已保存" });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "保存自动化失败",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (automation: Automation) => automationsClient().runNow({ id: automation.id }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(AUTOMATIONS_QUERY, snapshot);
      toastManager.add({ type: "success", title: "自动化已开始运行" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (run: AutomationRun) => automationsClient().archiveRun({ runId: run.id }),
    onSuccess: (snapshot) => queryClient.setQueryData(AUTOMATIONS_QUERY, snapshot),
  });

  const markReadMutation = useMutation({
    mutationFn: (run: AutomationRun) => automationsClient().markRunRead({ runId: run.id }),
    onSuccess: (snapshot) => queryClient.setQueryData(AUTOMATIONS_QUERY, snapshot),
  });

  const deleteMutation = useMutation({
    mutationFn: (automation: Automation) => automationsClient().delete({ id: automation.id }),
    onSuccess: () => {
      refreshSnapshot();
      toastManager.add({ type: "success", title: "自动化已删除" });
    },
  });

  const openCreate = useCallback(() => {
    setDraft(createEmptyDraft(projects, threads));
  }, [projects, threads]);

  const openChatDraft = useCallback(() => {
    setDraft({
      ...createEmptyDraft(projects, threads),
      title: "新的自动化",
      prompt: AUTOMATION_CHAT_CREATE_PROMPT,
    });
  }, [projects, threads]);

  const openTemplateDraft = useCallback(
    (template: AutomationTemplate) => {
      setDraft(draftFromTemplate(template, projects, threads));
      setTemplatesOpen(false);
    },
    [projects, threads],
  );

  const toggleAutomation = useCallback(
    (automation: Automation) => {
      const nextStatus = automation.status === "enabled" ? "paused" : "enabled";
      upsertMutation.mutate({
        id: automation.id,
        title: automation.title,
        prompt: automation.prompt,
        status: nextStatus,
        schedule: automation.schedule,
        target: automation.target,
        modelSelection: automation.modelSelection,
        runtimeMode: automation.runtimeMode,
        interactionMode: automation.interactionMode,
      });
    },
    [upsertMutation],
  );

  const openResultThread = useCallback(
    (run: AutomationRun) => {
      if (!run.resultThreadId) return;
      const thread = threads.find((item) => item.id === run.resultThreadId);
      if (!thread) {
        toastManager.add({ type: "warning", title: "结果线程暂不可用" });
        return;
      }
      markReadMutation.mutate(run);
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: thread.environmentId, threadId: thread.id },
      });
    },
    [markReadMutation, navigate, threads],
  );

  const submitDraft = useCallback(() => {
    if (!draft) return;
    if (!draft.title.trim() || !draft.prompt.trim()) {
      toastManager.add({ type: "warning", title: "请填写标题和任务内容" });
      return;
    }
    if (draft.targetKind === "project" && !draft.projectId) {
      toastManager.add({ type: "warning", title: "请选择项目目标" });
      return;
    }
    if (draft.targetKind === "thread" && !draft.threadId) {
      toastManager.add({ type: "warning", title: "请选择线程目标" });
      return;
    }
    upsertMutation.mutate(buildUpsertInput(draft));
  }, [draft, upsertMutation]);

  const hasTargets = projects.length > 0 || threads.length > 0;
  const loading = query.isLoading;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5">
        <div className="flex min-w-0 items-center gap-2">
          <BotIcon className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">自动化</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => setTemplatesOpen(true)}>
            模板
          </Button>
          <Button size="xs" variant="outline" onClick={openChatDraft}>
            <BotIcon className="size-3.5" />
            通过聊天创建
          </Button>
          <Button size="xs" onClick={openCreate} disabled={!hasTargets}>
            <PlusIcon className="size-3.5" />
            新建
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto w-full max-w-6xl px-6 py-8">
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-normal">自动化管理</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    管理定时运行、线程心跳、Triage 收件箱和运行记录。
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 rounded-md border border-border/70 px-4 py-8 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  正在加载自动化
                </div>
              ) : automations.length === 0 ? (
                <Empty className="min-h-80 rounded-md border border-border/70">
                  <EmptyHeader>
                    <BotIcon className="mb-4 size-14 stroke-[1.7] text-muted-foreground" />
                    <EmptyTitle className="text-base">还没有自动化</EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent className="flex-row justify-center gap-2">
                    <Button size="sm" onClick={openCreate} disabled={!hasTargets}>
                      <PlusIcon className="size-4" />
                      创建自动化
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>
                      查看模板
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <div className="space-y-2">
                  {automations.map((automation) => (
                    <AutomationRow
                      key={automation.id}
                      automation={automation}
                      latestRun={runByAutomationId.get(automation.id)}
                      projects={projects}
                      threads={threads}
                      running={runNowMutation.isPending}
                      onRunNow={() => runNowMutation.mutate(automation)}
                      onEdit={() => setDraft(draftFromAutomation(automation))}
                      onToggle={() => toggleAutomation(automation)}
                      onDelete={() => deleteMutation.mutate(automation)}
                    />
                  ))}
                </div>
              )}
            </div>

            <aside className="min-w-0 space-y-5">
              <section className="rounded-md border border-border/70 bg-card/30">
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-medium">Triage</h2>
                    <p className="text-xs text-muted-foreground">运行完成后进入收件箱</p>
                  </div>
                  <div className="flex rounded-md border border-border/70 p-0.5">
                    {(["unread", "all"] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className={cn(
                          "h-6 rounded-[calc(var(--radius-md)-2px)] px-2 text-xs transition",
                          inboxFilter === filter
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                        onClick={() => setInboxFilter(filter)}
                      >
                        {filter === "unread" ? "未读" : "全部"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[22rem] overflow-y-auto p-2">
                  {inboxRuns.length === 0 ? (
                    <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                      暂无待处理运行
                    </div>
                  ) : (
                    inboxRuns.map((run) => (
                      <RunInboxItem
                        key={run.id}
                        run={run}
                        automation={automations.find((item) => item.id === run.automationId)}
                        onOpen={() => openResultThread(run)}
                        onArchive={() => archiveMutation.mutate(run)}
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-md border border-border/70 bg-card/30">
                <div className="border-b border-border/60 px-4 py-3">
                  <h2 className="text-sm font-medium">运行历史</h2>
                  <p className="text-xs text-muted-foreground">最近 200 条运行记录</p>
                </div>
                <div className="max-h-[28rem] overflow-y-auto p-2">
                  {runs.length === 0 ? (
                    <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                      暂无运行记录
                    </div>
                  ) : (
                    runs.map((run) => (
                      <RunHistoryItem
                        key={run.id}
                        run={run}
                        automation={automations.find((item) => item.id === run.automationId)}
                        onOpen={() => openResultThread(run)}
                      />
                    ))
                  )}
                </div>
              </section>
            </aside>
          </section>
        </main>
      </ScrollArea>

      <AutomationFormDialog
        draft={draft}
        projects={projects}
        threads={threads}
        saving={upsertMutation.isPending}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSubmit={submitDraft}
      />
      <AutomationTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onChooseTemplate={openTemplateDraft}
        onManualSetup={openCreate}
      />
    </div>
  );
}

function AutomationRow({
  automation,
  latestRun,
  projects,
  threads,
  running,
  onRunNow,
  onEdit,
  onToggle,
  onDelete,
}: {
  readonly automation: Automation;
  readonly latestRun: AutomationRun | undefined;
  readonly projects: readonly Project[];
  readonly threads: readonly ThreadShell[];
  readonly running: boolean;
  readonly onRunNow: () => void;
  readonly onEdit: () => void;
  readonly onToggle: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <article className="rounded-md border border-border/70 bg-card/35 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-medium">{automation.title}</h2>
            <Badge variant={automation.status === "enabled" ? "success" : "outline"}>
              {automation.status === "enabled" ? "启用" : "暂停"}
            </Badge>
            {latestRun ? (
              <Badge variant={runStatusVariant(latestRun.status)}>
                {runStatusLabel(latestRun.status)}
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClockIcon className="size-3.5" />
              {scheduleLabel(automation.schedule)}
            </span>
            <span>{targetLabel(automation.target, projects, threads)}</span>
            <span>下次：{formatDateTime(automation.nextRunAt)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {automation.prompt}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon-xs" variant="ghost" title="立即运行" onClick={onRunNow} disabled={running}>
            {running ? <Loader2Icon className="size-3.5 animate-spin" /> : <PlayIcon />}
          </Button>
          <Button size="icon-xs" variant="ghost" title="编辑" onClick={onEdit}>
            <PencilIcon />
          </Button>
          <Button size="icon-xs" variant="ghost" title={automation.status === "enabled" ? "暂停" : "启用"} onClick={onToggle}>
            {automation.status === "enabled" ? <PauseIcon /> : <CheckCircle2Icon />}
          </Button>
          <Button size="icon-xs" variant="ghost" title="删除" onClick={onDelete}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
    </article>
  );
}

function RunInboxItem({
  run,
  automation,
  onOpen,
  onArchive,
}: {
  readonly run: AutomationRun;
  readonly automation: Automation | undefined;
  readonly onOpen: () => void;
  readonly onArchive: () => void;
}) {
  return (
    <div className="rounded-md px-2 py-2 hover:bg-accent/35">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{automation?.title ?? "自动化运行"}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={runStatusVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
            <span>{formatDateTime(run.completedAt ?? run.startedAt)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {run.summary ?? run.error ?? "运行完成。"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon-xs" variant="ghost" title="打开结果线程" onClick={onOpen} disabled={!run.resultThreadId}>
            <ExternalLinkIcon />
          </Button>
          <Button size="icon-xs" variant="ghost" title="归档" onClick={onArchive}>
            <ArchiveIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

function RunHistoryItem({
  run,
  automation,
  onOpen,
}: {
  readonly run: AutomationRun;
  readonly automation: Automation | undefined;
  readonly onOpen: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-accent/35">
      <div className="min-w-0">
        <div className="truncate text-sm">{automation?.title ?? run.automationId}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={runStatusVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
          <span>{run.trigger === "manual" ? "手动" : "计划"}</span>
          <span>{formatDateTime(run.completedAt ?? run.startedAt)}</span>
        </div>
      </div>
      <Button size="icon-xs" variant="ghost" title="打开结果线程" onClick={onOpen} disabled={!run.resultThreadId}>
        <ExternalLinkIcon />
      </Button>
    </div>
  );
}

function AutomationFormDialog({
  draft,
  projects,
  threads,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  readonly draft: AutomationDraft | null;
  readonly projects: readonly Project[];
  readonly threads: readonly ThreadShell[];
  readonly saving: boolean;
  readonly onChange: (draft: AutomationDraft | null) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}) {
  const update = useCallback(
    <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) => {
      if (!draft) return;
      onChange({ ...draft, [key]: value });
    },
    [draft, onChange],
  );

  if (!draft) return null;

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-3xl rounded-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle className="text-lg">{draft.id ? "编辑自动化" : "新建自动化"}</DialogTitle>
          <DialogDescription>保存后由本地 T3 Code 服务按计划触发运行。</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="标题">
              <Input value={draft.title} onChange={(event) => update("title", event.target.value)} />
            </Field>
            <Field label="状态">
              <NativeSelect value={draft.status} onChange={(event) => update("status", event.target.value as Automation["status"])}>
                <option value="enabled">启用</option>
                <option value="paused">暂停</option>
              </NativeSelect>
            </Field>
          </div>

          <Field label="任务内容">
            <Textarea
              value={draft.prompt}
              onChange={(event) => update("prompt", event.target.value)}
              className="min-h-32"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="计划类型">
              <NativeSelect value={draft.scheduleKind} onChange={(event) => update("scheduleKind", event.target.value as ScheduleKind)}>
                <option value="interval">分钟间隔</option>
                <option value="daily">每日</option>
                <option value="weekly">每周</option>
                <option value="cron">Cron</option>
              </NativeSelect>
            </Field>
            <ScheduleFields draft={draft} update={update} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="目标类型">
              <NativeSelect value={draft.targetKind} onChange={(event) => update("targetKind", event.target.value as TargetKind)}>
                <option value="project">独立项目自动化</option>
                <option value="thread">线程自动化</option>
              </NativeSelect>
            </Field>
            {draft.targetKind === "project" ? (
              <Field label="项目">
                <NativeSelect value={draft.projectId} onChange={(event) => update("projectId", event.target.value)}>
                  <option value="" disabled>
                    选择项目
                  </option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <Field label="线程">
                <NativeSelect value={draft.threadId} onChange={(event) => update("threadId", event.target.value)}>
                  <option value="" disabled>
                    选择线程
                  </option>
                  {threads.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {thread.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>

          {draft.targetKind === "project" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Git 运行方式">
                <NativeSelect value={draft.runMode} onChange={(event) => update("runMode", event.target.value as "worktree" | "local")}>
                  <option value="worktree">独立 worktree</option>
                  <option value="local">项目目录</option>
                </NativeSelect>
              </Field>
              <Field label="基础分支">
                <Input
                  value={draft.baseBranch}
                  onChange={(event) => update("baseBranch", event.target.value)}
                  placeholder="留空自动使用当前分支"
                />
              </Field>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Provider 实例">
              <Input value={draft.modelInstanceId} onChange={(event) => update("modelInstanceId", event.target.value)} />
            </Field>
            <Field label="模型">
              <Input value={draft.model} onChange={(event) => update("model", event.target.value)} />
            </Field>
            <Field label="运行模式">
              <NativeSelect value={draft.runtimeMode} onChange={(event) => update("runtimeMode", event.target.value as RuntimeMode)}>
                <option value="auto-accept-edits">自动接受编辑</option>
                <option value="approval-required">需要确认</option>
                <option value="full-access">Full access</option>
              </NativeSelect>
            </Field>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ScheduleFields({
  draft,
  update,
}: {
  readonly draft: AutomationDraft;
  readonly update: <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) => void;
}) {
  switch (draft.scheduleKind) {
    case "interval":
      return (
        <Field label="间隔分钟">
          <Input
            type="number"
            min={1}
            value={draft.intervalMinutes}
            onChange={(event) => update("intervalMinutes", event.target.value)}
          />
        </Field>
      );
    case "daily":
      return (
        <Field label="每日时间">
          <Input type="time" value={draft.dailyTime} onChange={(event) => update("dailyTime", event.target.value)} />
        </Field>
      );
    case "weekly":
      return (
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <Field label="星期">
            <NativeSelect value={draft.weeklyWeekday} onChange={(event) => update("weeklyWeekday", event.target.value)}>
              {WEEKDAYS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="时间">
            <Input type="time" value={draft.weeklyTime} onChange={(event) => update("weeklyTime", event.target.value)} />
          </Field>
        </div>
      );
    case "cron":
      return (
        <Field label="Cron 表达式">
          <Input value={draft.cronExpression} onChange={(event) => update("cronExpression", event.target.value)} />
        </Field>
      );
  }
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NativeSelect(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs/5 outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:opacity-64",
        props.className,
      )}
    />
  );
}

function AutomationTemplatesDialog({
  open,
  onOpenChange,
  onChooseTemplate,
  onManualSetup,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChooseTemplate: (template: AutomationTemplate) => void;
  readonly onManualSetup: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-h-[min(76dvh,42rem)] max-w-[50rem] rounded-xl border-border/70" showCloseButton>
        <DialogHeader className="flex-row items-center justify-between gap-3 px-5 py-4">
          <DialogTitle className="text-base font-semibold">自动化模板</DialogTitle>
          <Button size="sm" variant="outline" className="mr-9" onClick={onManualSetup}>
            手动设置
          </Button>
        </DialogHeader>
        <DialogPanel className="px-5 pb-5 pt-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[AUTOMATION_REVIEW_QUEUE_TEMPLATE, ...AUTOMATION_TEMPLATES].map((template) => (
              <button
                key={template.id}
                type="button"
                className="group flex min-h-32 w-full flex-col items-start rounded-md border border-border/70 bg-card/35 px-4 py-4 text-left transition hover:border-border hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChooseTemplate(template)}
              >
                <span
                  className={cn(
                    "mb-3 flex size-7 items-center justify-center rounded-md shadow-sm",
                    template.iconClassName,
                  )}
                  aria-hidden
                >
                  <template.icon className="size-4" />
                </span>
                <span className="text-sm font-medium text-foreground">{template.title}</span>
                <span className="mt-1 text-xs leading-5 text-muted-foreground">
                  {template.description}
                </span>
              </button>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
