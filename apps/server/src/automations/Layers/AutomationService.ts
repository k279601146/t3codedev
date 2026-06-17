import {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  AutomationServiceError,
  CONVERSATION_PROJECT_ID,
  CommandId,
  MessageId,
  ThreadId,
  type AutomationListResult,
  type AutomationRunStatus,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type ThreadTurnStartBootstrap,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { AutomationRepository } from "../Services/AutomationRepository.ts";
import {
  AutomationService,
  type AutomationServiceShape,
} from "../Services/AutomationService.ts";
import { computeNextRunAt } from "../schedule.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodeAutomation = Schema.decodeUnknownEffect(Automation);
const decodeAutomationRun = Schema.decodeUnknownEffect(AutomationRun);

function serviceError(message: string, cause?: unknown): AutomationServiceError {
  return new AutomationServiceError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function formatCause(cause: Cause.Cause<unknown>): string {
  return Cause.pretty(cause).slice(0, 4_000);
}

function filterListResult(
  result: AutomationListResult,
  inbox: "unread" | "all" | undefined,
): AutomationListResult {
  if (inbox === undefined) {
    return result;
  }
  const visibleRuns = result.runs.filter((run) => {
    if (run.archivedAt !== null) return false;
    if (inbox === "unread" && run.readAt !== null) return false;
    return run.status === "completed" || run.status === "failed" || run.status === "skipped";
  });
  return {
    automations: result.automations,
    runs: visibleRuns,
  };
}

const make = Effect.gen(function* () {
  const repository = yield* AutomationRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const changes = yield* PubSub.unbounded<void>();
  const revision = yield* Ref.make(0);

  const publishChange = Effect.gen(function* () {
    yield* Ref.update(revision, (value) => value + 1);
    yield* PubSub.publish(changes, undefined);
  });

  const listRaw = repository.list;

  const list: AutomationServiceShape["list"] = (input) =>
    listRaw().pipe(
      Effect.map((result) => filterListResult(result, input.inbox)),
      Effect.mapError((cause) => serviceError("加载自动化失败", cause)),
    );

  const get: AutomationServiceShape["get"] = (input) =>
    Effect.gen(function* () {
      const automation = yield* repository.get(input.id);
      if (!automation) {
        return yield* serviceError("自动化不存在");
      }
      const runs = yield* repository.listRuns(input.id);
      return { automation, runs: Array.from(runs) };
    }).pipe(Effect.mapError((cause) => (Schema.is(AutomationServiceError)(cause) ? cause : serviceError("加载自动化失败", cause))));

  const upsert: AutomationServiceShape["upsert"] = (input) =>
    Effect.gen(function* () {
      const existing = input.id ? yield* repository.get(input.id) : null;
      const createdAt = existing?.createdAt ?? (yield* nowIso);
      const updatedAt = yield* nowIso;
      const nextRunAt = input.status === "enabled" ? computeNextRunAt(input.schedule) : null;
      const automation = yield* decodeAutomation({
        id: input.id ?? AutomationId.make(crypto.randomUUID()),
        title: input.title,
        prompt: input.prompt,
        status: input.status,
        schedule: input.schedule,
        target: input.target,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        nextRunAt,
        lastRunAt: existing?.lastRunAt ?? null,
        createdAt,
        updatedAt,
      }).pipe(Effect.mapError((cause) => serviceError("自动化配置无效", cause)));
      const saved = yield* repository.upsert(automation);
      yield* publishChange;
      return saved;
    }).pipe(Effect.mapError((cause) => (Schema.is(AutomationServiceError)(cause) ? cause : serviceError("保存自动化失败", cause))));

  const deleteAutomation: AutomationServiceShape["delete"] = (input) =>
    Effect.gen(function* () {
      yield* repository.delete(input.id, yield* nowIso);
      yield* publishChange;
    }).pipe(Effect.mapError((cause) => serviceError("删除自动化失败", cause)));

  const insertRun = (input: {
    readonly automationId: AutomationId;
    readonly trigger: "scheduled" | "manual";
    readonly status: AutomationRunStatus;
    readonly now: string;
    readonly completedAt?: string | null;
    readonly resultThreadId?: ThreadId | null;
    readonly summary?: string | null;
    readonly error?: string | null;
  }) =>
    decodeAutomationRun({
      id: AutomationRunId.make(crypto.randomUUID()),
      automationId: input.automationId,
      status: input.status,
      trigger: input.trigger,
      startedAt: input.now,
      completedAt: input.completedAt ?? null,
      resultThreadId: input.resultThreadId ?? null,
      summary: input.summary ?? null,
      error: input.error ?? null,
      archivedAt: null,
      readAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    }).pipe(
      Effect.mapError((cause) => serviceError("自动化运行记录无效", cause)),
      Effect.flatMap(repository.insertRun),
    );

  const completeRun = (input: {
    readonly runId: AutomationRunId;
    readonly status: "completed" | "failed" | "skipped";
    readonly summary?: string | null;
    readonly error?: string | null;
    readonly completedAt: string;
  }) =>
    repository.updateRun({
      runId: input.runId,
      status: input.status,
      completedAt: input.completedAt,
      summary: input.summary ?? null,
      error: input.error ?? null,
      updatedAt: input.completedAt,
    });

  const dispatchAutomationRun = (automation: Automation, run: AutomationRun) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso;
      const threadId =
        automation.target.kind === "thread"
          ? automation.target.threadId
          : ThreadId.make(crypto.randomUUID());
      const messageId = MessageId.make(crypto.randomUUID());
      const commandId = CommandId.make(`automation:${automation.id}:${run.id}`);

      let bootstrap: ThreadTurnStartBootstrap | undefined;

      if (automation.target.kind === "project") {
        const project = yield* projectionSnapshotQuery.getProjectShellById(automation.target.projectId);
        if (Option.isNone(project)) {
          return yield* serviceError("自动化目标项目不存在");
        }

        const projectValue = project.value;
        let baseBranch = automation.target.baseBranch ?? "HEAD";
        let runMode = automation.target.runMode;
        if (runMode === "worktree") {
          const status = yield* gitWorkflow
            .status({ cwd: projectValue.workspaceRoot })
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!status?.isRepo || !status.refName) {
            runMode = "local";
          } else {
            baseBranch = status.refName;
          }
        }

        bootstrap = {
          createThread: {
            projectId: automation.target.projectId,
            title: `自动化: ${automation.title}`,
            modelSelection: automation.modelSelection,
            runtimeMode: automation.runtimeMode,
            interactionMode: automation.interactionMode,
            branch: null,
            worktreePath: null,
            createdAt,
          },
          ...(runMode === "worktree"
            ? {
                prepareWorktree: {
                  projectCwd: projectValue.workspaceRoot,
                  baseBranch,
                  branch: `t3/automation/${String(automation.id).slice(0, 8)}-${String(run.id).slice(0, 8)}`,
                },
              }
            : {}),
        };
      }

      if (automation.target.kind === "conversation") {
        bootstrap = {
          createThread: {
            projectId: CONVERSATION_PROJECT_ID,
            title: `自动化: ${automation.title}`,
            modelSelection: automation.modelSelection,
            runtimeMode: automation.runtimeMode,
            interactionMode: automation.interactionMode,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        };
      }

      yield* repository.updateRun({
        runId: run.id,
        status: "running",
        resultThreadId: threadId,
        updatedAt: createdAt,
      });

      const command: Extract<OrchestrationCommand, { type: "thread.turn.start" }> = {
        type: "thread.turn.start",
        commandId,
        threadId,
        message: {
          messageId,
          role: "user",
          text: automation.prompt,
          attachments: [],
        },
        modelSelection: automation.modelSelection,
        titleSeed: automation.title,
        runtimeMode: automation.runtimeMode,
        interactionMode: automation.interactionMode,
        ...(bootstrap ? { bootstrap } : {}),
        createdAt,
      };

      yield* orchestrationEngine.dispatch(command);
    });

  const runAutomation = (automation: Automation, trigger: "scheduled" | "manual") =>
    Effect.gen(function* () {
      const current = yield* repository.getRunningRunByAutomationId(automation.id);
      const startedAt = yield* nowIso;
      if (current) {
        yield* insertRun({
          automationId: automation.id,
          trigger,
          status: "skipped",
          now: startedAt,
          completedAt: startedAt,
          summary: "上一次运行尚未结束，本次已跳过。",
        });
        yield* publishChange;
        return;
      }

      const run = yield* insertRun({
        automationId: automation.id,
        trigger,
        status: "queued",
        now: startedAt,
      });

      yield* dispatchAutomationRun(automation, run).pipe(
        Effect.catchCause((cause) =>
          completeRun({
            runId: run.id,
            status: "failed",
            completedAt: startedAt,
            error: formatCause(cause),
          }),
        ),
      );
      yield* publishChange;
    });

  const reschedule = (automation: Automation, fromIso: string) =>
    repository.updateAutomationScheduleState({
      automationId: automation.id,
      lastRunAt: fromIso,
      nextRunAt: automation.status === "enabled" ? computeNextRunAt(automation.schedule, fromIso) : null,
      updatedAt: fromIso,
    });

  const processDue = Effect.gen(function* () {
    const timestamp = yield* nowIso;
    const due = yield* repository.listDue(timestamp);
    for (const automation of due) {
      yield* reschedule(automation, timestamp);
      yield* runAutomation(automation, "scheduled").pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("自动化运行失败", {
            automationId: automation.id,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    }
    if (due.length > 0) {
      yield* publishChange;
    }
  });

  const runNow: AutomationServiceShape["runNow"] = (input) =>
    Effect.gen(function* () {
      const automation = yield* repository.get(input.id);
      if (!automation) {
        return yield* serviceError("自动化不存在");
      }
      yield* runAutomation(automation, "manual");
      return yield* listRaw();
    }).pipe(Effect.mapError((cause) => (Schema.is(AutomationServiceError)(cause) ? cause : serviceError("运行自动化失败", cause))));

  const archiveRun: AutomationServiceShape["archiveRun"] = (input) =>
    Effect.gen(function* () {
      yield* repository.archiveRun(input.runId, yield* nowIso);
      yield* publishChange;
      return yield* listRaw();
    }).pipe(Effect.mapError((cause) => serviceError("归档自动化运行失败", cause)));

  const markRunRead: AutomationServiceShape["markRunRead"] = (input) =>
    Effect.gen(function* () {
      yield* repository.markRunRead(input.runId, yield* nowIso);
      yield* publishChange;
      return yield* listRaw();
    }).pipe(Effect.mapError((cause) => serviceError("标记自动化运行失败", cause)));

  const completeRunForEvent = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      if (event.type !== "thread.turn-diff-completed") {
        return;
      }
      const run = yield* repository.getRunningRunByThreadId(event.payload.threadId);
      if (!run) {
        return;
      }
      yield* completeRun({
        runId: run.id,
        status: event.payload.status === "error" ? "failed" : "completed",
        completedAt: event.payload.completedAt,
        summary: event.payload.files.length > 0 ? `修改了 ${event.payload.files.length} 个文件。` : "运行完成。",
        error: event.payload.status === "error" ? "自动化运行完成，但 diff 捕获失败。" : null,
      });
      yield* publishChange;
    });

  const start: AutomationServiceShape["start"] = () =>
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        Effect.forever(processDue.pipe(Effect.ignoreCause({ log: true }), Effect.delay(Duration.seconds(30)))),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, completeRunForEvent).pipe(
          Effect.ignoreCause({ log: true }),
        ),
      );
      yield* processDue.pipe(Effect.ignoreCause({ log: true }));
    });

  const stream: AutomationServiceShape["stream"] = Stream.unwrap(
    Effect.gen(function* () {
      const snapshot = yield* list({}).pipe(Effect.mapError((cause) => cause));
      const live = Stream.fromPubSub(changes).pipe(
        Stream.mapEffect(() =>
          Effect.gen(function* () {
            return {
              kind: "changed" as const,
              revision: yield* Ref.get(revision),
              snapshot: yield* list({}),
            };
          }),
        ),
      );
      return Stream.concat(Stream.make({ kind: "snapshot" as const, snapshot }), live);
    }),
  );

  return {
    start,
    list,
    get,
    upsert,
    delete: deleteAutomation,
    runNow,
    archiveRun,
    markRunRead,
    stream,
  } satisfies AutomationServiceShape;
});

export const AutomationServiceLive = Layer.effect(AutomationService, make);
