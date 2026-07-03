import * as Option from "effect/Option";
import * as Arr from "effect/Array";
import {
  ApprovalRequestId,
  isToolLifecycleItemType,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  ProviderDriverKind,
  type ToolLifecycleItemType,
  type UserInputQuestion,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import {
  deriveDynamicToolActivityPresentation,
  deriveToolActivityPresentation,
  type DynamicToolFamily,
} from "@t3tools/shared/toolActivity";

import type {
  ChatMessage,
  ProposedPlan,
  SessionPhase,
  Thread,
  ThreadSession,
  TurnDiffSummary,
} from "./types";

export type ProviderPickerKind = ProviderDriverKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
  /** Shown on the model picker sidebar when relevant */
  pickerSidebarBadge?: "new" | "soon";
}> = [
  { value: ProviderDriverKind.make("codex"), label: "Codex", available: true },
  { value: ProviderDriverKind.make("claudeAgent"), label: "Claude", available: true },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    available: true,
    pickerSidebarBadge: "new",
  },
];

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  output?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  toolFamily?: DynamicToolFamily;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  status?: "running" | "completed" | "failed";
  generatedImage?: {
    id?: string;
    result?: string;
    savedPath?: string;
    status?: string;
    type?: string;
    revisedPrompt?: string;
  };
  userInputSummary?: {
    status: "requested" | "resolved";
    questions: ReadonlyArray<UserInputQuestion>;
    answers?: Record<string, string | string[]>;
  };
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  toolCallId?: string;
  sourceTurnId?: TurnId | null;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<ThreadSession, "orchestrationStatus" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  const runningTurnId =
    session?.orchestrationStatus === "running" ? (session.activeTurnId ?? null) : null;
  if (runningTurnId !== null) {
    if (latestTurn?.turnId === runningTurnId) {
      return latestTurn.startedAt ?? sendStartedAt;
    }
    return sendStartedAt;
  }
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change")
        ? payload.requestKind
        : payload
          ? requestKindFromRequestType(payload.requestType)
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        multiSelect: question.multiSelect === true,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const allPlanActivities = ordered.filter((activity) => activity.kind === "turn.plan.updated");
  // Prefer plan from the current turn; fall back to the most recent plan from any turn
  // so that TodoWrite tasks persist across follow-up messages.
  const latest = Option.firstSomeOf([
    ...(latestTurnId
      ? Arr.findLast(allPlanActivities, (activity) => activity.turnId === latestTurnId)
      : Option.none()),
    Arr.last(allPlanActivities),
  ]).pipe(Option.getOrNull);
  if (!latest) {
    return null;
  }
  const payload =
    latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps = rawPlan
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.step !== "string") {
        return null;
      }
      const status =
        record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
      return {
        step: record.step,
        status,
      };
    })
    .filter(
      (
        step,
      ): step is {
        step: string;
        status: "pending" | "inProgress" | "completed";
      } => step !== null,
    );
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan);
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return toLatestProposedPlanState(latestPlan);
}

export function findSidebarProposedPlan(input: {
  threads: ReadonlyArray<Pick<Thread, "id" | "proposedPlans">>;
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "sourceProposedPlan"> | null;
  latestTurnSettled: boolean;
  threadId: ThreadId | string | null | undefined;
}): LatestProposedPlanState | null {
  const activeThreadPlans =
    input.threads.find((thread) => thread.id === input.threadId)?.proposedPlans ?? [];

  if (!input.latestTurnSettled) {
    const sourceProposedPlan = input.latestTurn?.sourceProposedPlan;
    if (sourceProposedPlan) {
      const sourcePlan = input.threads
        .find((thread) => thread.id === sourceProposedPlan.threadId)
        ?.proposedPlans.find((plan) => plan.id === sourceProposedPlan.planId);
      if (sourcePlan) {
        return toLatestProposedPlanState(sourcePlan);
      }
    }
  }

  return findLatestProposedPlan(activeThreadPlans, input.latestTurn?.turnId ?? null);
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const resolvedUserInputRequestIds = new Set<string>();
  for (const activity of ordered) {
    if (activity.kind !== "user-input.resolved") {
      continue;
    }
    const requestId = extractActivityRequestId(activity);
    if (requestId) {
      resolvedUserInputRequestIds.add(requestId);
    }
  }
  const requestedUserInputQuestionsByRequestId = new Map<
    string,
    ReadonlyArray<UserInputQuestion>
  >();
  const entries = ordered
    .filter((activity) => (latestTurnId ? activity.turnId !== null : true))
    .filter((activity) => activity.kind !== "runtime.warning")
    .filter(
      (activity) => activity.kind !== "tool.started" || isImageGenerationStartActivity(activity),
    )
    .filter((activity) => activity.kind !== "task.started")
    .filter((activity) => activity.kind !== "context-window.updated")
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .filter((activity) => !isPlanBoundaryToolActivity(activity))
    .filter((activity) => {
      if (activity.kind !== "user-input.requested") {
        return true;
      }
      const requestId = extractActivityRequestId(activity);
      return !requestId || !resolvedUserInputRequestIds.has(requestId);
    })
    .map((activity) => {
      const requestId = extractActivityRequestId(activity);
      if (activity.kind === "user-input.requested" && requestId) {
        const questions = parseUserInputQuestions(asRecord(activity.payload));
        if (questions) {
          requestedUserInputQuestionsByRequestId.set(requestId, questions);
        }
      }
      return toDerivedWorkLogEntry(
        activity,
        requestId ? requestedUserInputQuestionsByRequestId.get(requestId) : undefined,
      );
    });
  return collapseDerivedWorkLogEntries(entries).map(
    ({ activityKind: _activityKind, collapseKey: _collapseKey, ...entry }) => entry,
  );
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function isImageGenerationStartActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.started") {
    return false;
  }
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return extractWorkLogItemType(payload) === "image_view" || isRawImageGenerationPayload(payload);
}

function toDerivedWorkLogEntry(
  activity: OrchestrationThreadActivity,
  requestedUserInputQuestions?: ReadonlyArray<UserInputQuestion>,
): DerivedWorkLogEntry {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const commandPreview = extractToolCommand(payload);
  const commandFileChange = extractCommandFileChange(payload, commandPreview.command);
  const changedFiles = mergeChangedFiles(
    extractChangedFiles(payload),
    commandFileChange ? [commandFileChange.path] : undefined,
  );
  const toolPresentation = deriveWorkLogToolActivityPresentation(payload);
  const title = toolPresentation?.title ?? extractToolTitle(payload);
  const isTaskActivity = activity.kind === "task.progress" || activity.kind === "task.completed";
  const taskSummary =
    isTaskActivity && typeof payload?.summary === "string" && payload.summary.length > 0
      ? payload.summary
      : null;
  const taskDetailAsLabel =
    isTaskActivity &&
    !taskSummary &&
    typeof payload?.detail === "string" &&
    payload.detail.length > 0
      ? payload.detail
      : null;
  const taskLabel = taskSummary || taskDetailAsLabel;
  const detail =
    commandFileChange?.diff ??
    (isTaskActivity
      ? !taskDetailAsLabel &&
        payload &&
        typeof payload.detail === "string" &&
        payload.detail.length > 0
        ? stripTrailingExitCode(payload.detail).output
        : null
      : (extractRuntimeIssueDetail(activity.kind, payload) ??
        (toolPresentation?.family === "command" ? null : toolPresentation?.detail) ??
        extractToolDetail(payload, title ?? activity.summary)));
  const toolCallId = isTaskActivity ? null : extractToolCallId(payload);
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    label: taskLabel || activity.summary,
    tone:
      activity.kind === "task.progress"
        ? "thinking"
        : activity.tone === "approval"
          ? "info"
          : activity.tone,
    activityKind: activity.kind,
    sourceTurnId: activity.turnId,
    status:
      activity.kind === "task.progress" ||
      activity.kind === "tool.updated" ||
      activity.kind === "tool.started"
        ? "running"
        : activity.tone === "error"
          ? "failed"
          : "completed",
  };
  const itemType = extractWorkLogItemType(payload);
  const requestKind = commandFileChange?.requestKind ?? extractWorkLogRequestKind(payload);
  const generatedImage = extractGeneratedImageArtifact(payload);
  const output = extractToolOutput(payload, title ?? activity.summary);
  if (detail) {
    entry.detail = detail;
  }
  if (output) {
    entry.output = output;
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (title) {
    entry.toolTitle = title;
  }
  if (toolPresentation?.family) {
    entry.toolFamily = toolPresentation.family;
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  if (generatedImage) {
    entry.generatedImage = generatedImage;
  }
  if (toolCallId) {
    entry.toolCallId = toolCallId;
  }
  const userInputSummary = deriveUserInputWorkSummary(
    activity,
    payload,
    requestedUserInputQuestions,
  );
  if (userInputSummary) {
    entry.userInputSummary = userInputSummary;
    entry.label =
      userInputSummary.status === "resolved"
        ? `已询问 ${userInputSummary.questions.length} 个问题`
        : "正在询问问题";
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry.collapseKey = collapseKey;
  }
  return entry;
}

function extractActivityRequestId(activity: OrchestrationThreadActivity): string | null {
  const payload = asRecord(activity.payload);
  return asTrimmedString(payload?.requestId);
}

function parseUserInputAnswers(value: unknown): Record<string, string | string[]> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const answers: Record<string, string | string[]> = {};
  for (const [questionId, rawAnswer] of Object.entries(record)) {
    const id = questionId.trim();
    if (id.length === 0) {
      continue;
    }
    if (typeof rawAnswer === "string") {
      const answer = rawAnswer.trim();
      if (answer.length > 0) {
        answers[id] = answer;
      }
      continue;
    }
    if (Array.isArray(rawAnswer)) {
      const answer = rawAnswer
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (answer.length > 0) {
        answers[id] = answer;
      }
      continue;
    }
    const answerRecord = asRecord(rawAnswer);
    if (Array.isArray(answerRecord?.answers)) {
      const answer = answerRecord.answers
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (answer.length > 0) {
        answers[id] = answer;
      }
    }
  }
  return Object.keys(answers).length > 0 ? answers : null;
}

function deriveUserInputWorkSummary(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown> | null,
  requestedUserInputQuestions: ReadonlyArray<UserInputQuestion> | undefined,
): WorkLogEntry["userInputSummary"] | null {
  if (activity.kind === "user-input.requested") {
    const questions = parseUserInputQuestions(payload);
    return questions ? { status: "requested", questions } : null;
  }
  if (activity.kind !== "user-input.resolved") {
    return null;
  }
  const answers = parseUserInputAnswers(payload?.answers);
  const questions =
    requestedUserInputQuestions ??
    (answers
      ? Object.keys(answers).map((questionId) => ({
          id: questionId,
          header: "",
          question: questionId,
          options: [],
          multiSelect: Array.isArray(answers[questionId]),
        }))
      : []);
  if (questions.length === 0 && !answers) {
    return null;
  }
  return {
    status: "resolved",
    questions,
    ...(answers ? { answers } : {}),
  };
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  for (const entry of entries) {
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (!isToolLifecycleWorkActivityKind(previous.activityKind)) {
    return false;
  }
  if (!isToolLifecycleWorkActivityKind(next.activityKind)) {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  if (previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey) {
    return true;
  }
  return (
    previous.toolCallId !== undefined &&
    next.toolCallId === undefined &&
    previous.itemType === next.itemType &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label)
  );
}

function isToolLifecycleWorkActivityKind(
  kind: DerivedWorkLogEntry["activityKind"],
): kind is "tool.started" | "tool.updated" | "tool.completed" {
  return kind === "tool.started" || kind === "tool.updated" || kind === "tool.completed";
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const output = next.output ?? previous.output;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const status = next.status ?? previous.status;
  const generatedImage = mergeGeneratedImageArtifact(previous.generatedImage, next.generatedImage);
  const imageToolCallId = next.toolCallId ?? previous.toolCallId;
  return {
    ...previous,
    ...next,
    ...(detail ? { detail } : {}),
    ...(output ? { output } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(imageToolCallId ? { toolCallId: imageToolCallId } : toolCallId ? { toolCallId } : {}),
    ...(status ? { status } : {}),
    ...(generatedImage ? { generatedImage } : {}),
  };
}

function mergeGeneratedImageArtifact(
  previous: WorkLogEntry["generatedImage"],
  next: WorkLogEntry["generatedImage"],
): WorkLogEntry["generatedImage"] {
  if (!previous) return next;
  if (!next) return previous;
  return {
    ...previous,
    ...next,
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (!isToolLifecycleWorkActivityKind(entry.activityKind)) {
    return undefined;
  }
  if (entry.toolCallId) {
    return `tool:${entry.toolCallId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function extractCommandActionCommand(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const commandActions = [item?.commandActions, data?.commandActions, payload?.commandActions].find(
    Array.isArray,
  );
  if (!commandActions) {
    return null;
  }
  for (const action of commandActions) {
    const command = normalizeCommandValue(asRecord(action)?.command);
    if (command) {
      return command;
    }
  }
  return null;
}

function escapeDiffPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function buildSyntheticCommandFileDiff(input: {
  path: string;
  content: string;
  isNewFile: boolean;
}): string {
  const path = escapeDiffPath(input.path);
  const lines = input.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const hunkHeader = input.isNewFile
    ? `@@ -0,0 +1,${lines.length} @@`
    : `@@ -1,0 +1,${lines.length} @@`;
  return [
    `diff --git a/${path} b/${path}`,
    ...(input.isNewFile ? ["new file mode 100644", "--- /dev/null"] : [`--- a/${path}`]),
    `+++ b/${path}`,
    hunkHeader,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

function unquoteCommandToken(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('\\"') && trimmed.endsWith('\\"')) ||
    (trimmed.startsWith("\\'") && trimmed.endsWith("\\'"))
  ) {
    return trimmed.slice(2, -2);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isNullRedirectionTarget(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "$null" || normalized === "null:";
}

function isValidCommandFileChangeTarget(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0")) {
    return false;
  }
  if (/^[A-Za-z]:$/.test(normalized) || /^[A-Za-z]:['"`]/u.test(normalized)) {
    return false;
  }
  if (/^(?:https?:|data:|about:|blob:)/iu.test(normalized)) {
    return false;
  }
  return true;
}

function extractShellRedirectionTarget(command: string): string | null {
  const match =
    /(?:^|\s)>>\s*(".*?"|'.*?'|[^\s|]+)/u.exec(command) ??
    /(?:^|\s)>\s*(".*?"|'.*?'|[^\s|]+)/u.exec(command);
  if (!match?.[1]) {
    return null;
  }
  const target = unquoteCommandToken(match[1]);
  if (!target || /^&\d+$/u.test(target) || isNullRedirectionTarget(target)) {
    return null;
  }
  return target;
}

function extractPowerShellWriteTarget(command: string): string | null {
  const explicitPathMatch = /-(?:Path|FilePath)\s+(".*?"|'.*?'|[^\s|]+)/iu.exec(command);
  if (explicitPathMatch?.[1]) {
    const target = unquoteCommandToken(explicitPathMatch[1]);
    return /^-/.test(target) ? null : target;
  }
  const writeSegmentMatch = /\|\s*(?:Set-Content|Out-File|Add-Content)\b(?<args>[\s\S]*)$/iu.exec(
    command,
  );
  const args = writeSegmentMatch?.groups?.args;
  if (!args) {
    return null;
  }
  const tokens = Array.from(args.matchAll(/"[^"]*"|'[^']*'|[^\s|]+/gu)).map((match) =>
    unquoteCommandToken(match[0]),
  );
  const valueTokens = tokens.filter((token, index) => {
    if (token.startsWith("-")) {
      return false;
    }
    const previous = tokens[index - 1]?.toLowerCase();
    return previous !== "-encoding";
  });
  return valueTokens.at(-1) ?? null;
}

function extractPowerShellWriteContent(command: string): string | null {
  const hereStringMatch = /@\\?"\r?\n([\s\S]*?)\r?\n\\?"@\s*\|/u.exec(command);
  if (hereStringMatch?.[1] !== undefined) {
    return hereStringMatch[1];
  }
  const singleQuotedHereStringMatch = /@\\?'\r?\n([\s\S]*?)\r?\n\\?'@\s*\|/u.exec(command);
  if (singleQuotedHereStringMatch?.[1] !== undefined) {
    return singleQuotedHereStringMatch[1];
  }
  const writeOutputMatch =
    /(?:Write-Output|echo)\s+("(?:(?:\\"|[^"])*)"|'(?:(?:\\'|[^'])*)'|[^\r\n|]+)\s*\|/iu.exec(
      command,
    );
  if (!writeOutputMatch?.[1]) {
    return null;
  }
  return unquoteCommandToken(writeOutputMatch[1]).replace(/\\"/g, '"').replace(/\\'/g, "'");
}

function extractCommandFileChange(
  payload: Record<string, unknown> | null,
  command: string | null,
): { path: string; diff: string; requestKind: "file-change" } | null {
  if (!command) {
    return null;
  }
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (itemType !== "command_execution" && requestKind !== "command") {
    return null;
  }
  const shellRedirectionTarget = extractShellRedirectionTarget(command);
  if (!/\|\s*(?:Set-Content|Out-File|Add-Content)\b/iu.test(command) && !shellRedirectionTarget) {
    return null;
  }
  const path =
    extractPowerShellWriteTarget(command) ??
    shellRedirectionTarget;
  if (!path) {
    return null;
  }
  if (isNullRedirectionTarget(path) || !isValidCommandFileChangeTarget(path)) {
    return null;
  }
  const content = extractPowerShellWriteContent(command);
  if (content === null) {
    return null;
  }
  const isNewFile = /\|\s*Out-File\b/iu.test(command) || shellRedirectionTarget !== null;
  return {
    path,
    diff: buildSyntheticCommandFileDiff({ path, content, isNewFile }),
    requestKind: "file-change",
  };
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function extractToolCommand(payload: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const args = asRecord(payload?.args);
  const itemType = asTrimmedString(payload?.itemType);
  const requestType = asTrimmedString(payload?.requestType);
  const detail = asTrimmedString(payload?.detail);
  const commandActionCommand = extractCommandActionCommand(payload);
  const candidates: unknown[] = [
    commandActionCommand,
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    args?.command,
    (itemType === "command_execution" || requestType === "command_execution_approval") && detail
      ? stripTrailingExitCode(detail).output
      : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function isGenericToolPresentationTitle(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "tool" ||
    normalized === "tool call" ||
    normalized === "mcp tool call" ||
    normalized === "dynamic tool call"
  );
}

function deriveWorkLogToolActivityPresentation(payload: Record<string, unknown> | null) {
  const itemType = extractWorkLogItemType(payload);
  if (!itemType) {
    return null;
  }
  const data = asRecord(payload?.data);
  const explicitPresentation = asRecord(data?.presentation);
  if (explicitPresentation) {
    const title = asTrimmedString(explicitPresentation.title);
    const family = asTrimmedString(explicitPresentation.family) as DynamicToolFamily | null;
    if (title) {
      return {
        title,
        ...(family ? { family } : {}),
        detail: asTrimmedString(explicitPresentation.detail) ?? undefined,
      };
    }
  }

  if (itemType === "dynamic_tool_call") {
    const item = asRecord(data?.item) ?? asRecord(payload?.item);
    const presentation = deriveDynamicToolActivityPresentation({
      tool: item?.tool ?? data?.tool ?? payload?.tool,
      namespace: item?.namespace ?? data?.namespace ?? payload?.namespace,
      arguments: item?.arguments ?? data?.arguments ?? payload?.arguments,
      contentItems: item?.contentItems ?? data?.contentItems ?? payload?.contentItems,
      success: item?.success ?? data?.success ?? payload?.success,
      status: item?.status ?? data?.status ?? payload?.status,
    });
    if (presentation) {
      return {
        title: presentation.title,
        family: presentation.family,
        detail: presentation.detail,
      };
    }
  }

  const presentation = deriveToolActivityPresentation({
    itemType,
    title: extractToolTitle(payload),
    detail: asTrimmedString(payload?.detail),
    data,
    fallbackSummary: asTrimmedString(payload?.title) ?? asTrimmedString(payload?.summary) ?? "Tool",
  });
  const existingTitle = extractToolTitle(payload);
  const shouldKeepExistingGenericTitle =
    presentation.summary === "工具调用" && !presentation.detail && existingTitle !== null;
  return {
    title: shouldKeepExistingGenericTitle
      ? existingTitle
      : isGenericToolPresentationTitle(existingTitle)
        ? presentation.summary
        : (existingTitle ?? presentation.summary),
    family: presentation.family,
    detail: presentation.detail,
  };
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item) ?? asRecord(payload?.item);
  return (
    asTrimmedString(data?.toolCallId) ??
    asTrimmedString(payload?.toolCallId) ??
    asTrimmedString(payload?.itemId) ??
    asTrimmedString(data?.itemId) ??
    asTrimmedString(item?.id)
  );
}

function extractGeneratedImageArtifact(
  payload: Record<string, unknown> | null,
): WorkLogEntry["generatedImage"] | undefined {
  if (extractWorkLogItemType(payload) !== "image_view") {
    return undefined;
  }

  const data = asRecord(payload?.data);
  const item = asRecord(data?.item) ?? asRecord(payload?.item);
  if (!item) {
    return undefined;
  }

  const result = asTrimmedString(item.result);
  const savedPath = asTrimmedString(item.savedPath);
  const status = asTrimmedString(item.status);
  const id = asTrimmedString(item.id);
  const type = asTrimmedString(item.type);
  const revisedPrompt = asTrimmedString(item.revisedPrompt);

  if (!id && !result && !savedPath && !status && !type && !revisedPrompt) {
    return undefined;
  }

  return {
    ...(id ? { id } : {}),
    ...(result ? { result } : {}),
    ...(savedPath ? { savedPath } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(revisedPrompt ? { revisedPrompt } : {}),
  };
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateInlinePreview(value: string, maxLength = 84): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizePreviewForComparison(value: string | null | undefined): string | null {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  return normalizeCompactToolLabel(normalizeInlinePreview(normalized)).toLowerCase();
}

function summarizeToolTextOutput(value: string): string | null {
  const cleaned = stripTrailingExitCode(value).output ?? value;
  const lines = cleaned
    .split(/\r?\n/u)
    .map((line) => normalizeInlinePreview(line))
    .filter((line) => line.length > 0);
  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) {
    return truncateInlinePreview(firstLine);
  }
  if (lines.length > 1) {
    return `${lines.length.toLocaleString()} lines`;
  }
  return null;
}

function summarizeToolRawOutput(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemType = extractWorkLogItemType(payload);
  const rawOutput =
    asRecord(data?.rawOutput) ??
    asRecord(item?.result) ??
    (itemType === "command_execution" ? item : null);
  if (!rawOutput) {
    return null;
  }

  const totalFiles = asNumber(rawOutput.totalFiles);
  if (totalFiles !== null) {
    const suffix = rawOutput.truncated === true ? "+" : "";
    return `${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) {
    return summarizeToolTextOutput(content);
  }

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) {
    return summarizeToolTextOutput(stdout);
  }

  const aggregatedOutput = asTrimmedString(rawOutput.aggregatedOutput);
  if (aggregatedOutput) {
    return summarizeToolTextOutput(aggregatedOutput);
  }

  return null;
}

function isCommandToolDetail(payload: Record<string, unknown> | null, heading: string): boolean {
  const data = asRecord(payload?.data);
  const kind = asTrimmedString(data?.kind)?.toLowerCase();
  const title = asTrimmedString(payload?.title ?? heading)?.toLowerCase();
  return (
    extractWorkLogItemType(payload) === "command_execution" ||
    kind === "execute" ||
    title === "terminal" ||
    title === "ran command"
  );
}

function extractToolDetail(
  payload: Record<string, unknown> | null,
  heading: string,
): string | null {
  const rawDetail = asTrimmedString(payload?.detail);
  const detail = rawDetail ? stripTrailingExitCode(rawDetail).output : null;
  const normalizedHeading = normalizePreviewForComparison(heading);
  const normalizedDetail = normalizePreviewForComparison(detail);
  const rawOutputSummary = summarizeToolRawOutput(payload);

  if (isCommandToolDetail(payload, heading)) {
    const command = extractToolCommand(payload).command;
    const rawCommand = extractToolCommand(payload).rawCommand;
    const normalizedCommand = normalizePreviewForComparison(command);
    const normalizedRawCommand = normalizePreviewForComparison(rawCommand);
    const normalizedRawOutputSummary = normalizePreviewForComparison(rawOutputSummary);
    if (
      command &&
      rawOutputSummary &&
      normalizedRawOutputSummary !== normalizedHeading &&
      normalizedRawOutputSummary !== normalizedCommand
    ) {
      return rawOutputSummary;
    }
    return detail &&
      normalizedHeading !== normalizedDetail &&
      normalizedCommand !== normalizedDetail &&
      normalizedRawCommand !== normalizedDetail
      ? detail
      : null;
  }

  if (detail && normalizedHeading !== normalizedDetail) {
    return detail;
  }

  if (rawOutputSummary) {
    const normalizedRawOutputSummary = normalizePreviewForComparison(rawOutputSummary);
    if (normalizedRawOutputSummary !== normalizedHeading) {
      return rawOutputSummary;
    }
  }

  return null;
}

function extractToolOutput(
  payload: Record<string, unknown> | null,
  heading: string,
): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const rawOutput = asRecord(data?.rawOutput) ?? itemResult ?? asRecord(payload?.rawOutput);
  const command = extractToolCommand(payload);
  const normalizedCommand = normalizePreviewForComparison(command.command);
  const normalizedRawCommand = normalizePreviewForComparison(command.rawCommand);
  const normalizedHeading = normalizePreviewForComparison(heading);
  const combineStreams = (record: Record<string, unknown> | null | undefined): string | null => {
    const stdout = asTrimmedString(record?.stdout);
    const stderr = asTrimmedString(record?.stderr);
    return [stdout, stderr].filter((value): value is string => Boolean(value)).join("\n");
  };

  const candidates: Array<unknown> = [
    combineStreams(rawOutput),
    rawOutput?.content,
    rawOutput?.output,
    rawOutput?.text,
    rawOutput?.aggregatedOutput,
    combineStreams(data),
    data?.content,
    data?.output,
    data?.text,
    data?.aggregatedOutput,
    combineStreams(item),
    item?.content,
    item?.output,
    item?.text,
    item?.aggregatedOutput,
    combineStreams(itemResult),
    itemResult?.content,
    itemResult?.output,
    itemResult?.text,
    itemResult?.aggregatedOutput,
    asTrimmedString(payload?.output),
    asTrimmedString(payload?.stdout),
    asTrimmedString(payload?.stderr),
    asTrimmedString(payload?.content),
    asTrimmedString(payload?.text),
    asTrimmedString(payload?.aggregatedOutput),
  ];

  if (isCommandToolDetail(payload, heading)) {
    const detail = asTrimmedString(payload?.detail);
    if (detail) {
      candidates.push(stripTrailingExitCode(detail).output);
    }
  }

  for (const candidate of candidates) {
    const output = asTrimmedString(candidate);
    if (!output) {
      continue;
    }
    const normalizedOutput = normalizePreviewForComparison(output);
    if (
      normalizedOutput !== normalizedHeading &&
      normalizedOutput !== normalizedCommand &&
      normalizedOutput !== normalizedRawCommand
    ) {
      return stripTrailingExitCode(output).output ?? output;
    }
  }

  return null;
}

function extractRuntimeIssueDetail(
  kind: OrchestrationThreadActivity["kind"],
  payload: Record<string, unknown> | null,
): string | null {
  if (kind !== "runtime.warning" && kind !== "runtime.error") {
    return null;
  }

  const message = asTrimmedString(payload?.message);
  const detail = asRecord(payload?.detail);
  const error = asRecord(detail?.error) ?? asRecord(payload?.error);
  const additionalDetails = asTrimmedString(error?.additionalDetails);
  if (message && additionalDetails && message !== additionalDetails) {
    return `${message}: ${additionalDetails}`;
  }
  return message ?? additionalDetails ?? null;
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  if (isRawImageGenerationPayload(payload)) {
    return "image_view";
  }
  return undefined;
}

function isRawImageGenerationPayload(payload: Record<string, unknown> | null): boolean {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item) ?? asRecord(payload?.item);
  const itemId =
    asTrimmedString(payload?.itemId) ?? asTrimmedString(data?.itemId) ?? asTrimmedString(item?.id);
  if (itemId?.startsWith("ig_")) {
    return true;
  }
  if (!item) {
    return false;
  }
  return (
    asTrimmedString(item.type) === "imageGeneration" &&
    asTrimmedString(item.status) === "in_progress"
  );
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (
    !normalized ||
    seen.has(normalized) ||
    /^&\d+$/u.test(normalized) ||
    isNullRedirectionTarget(normalized)
  ) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (
    itemType !== "file_change" &&
    itemType !== "image_view" &&
    requestKind !== "file-change" &&
    !isRawImageGenerationPayload(payload)
  ) {
    return [];
  }
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

export function hasToolActivityForTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
): boolean {
  if (!turnId) return false;
  return activities.some((activity) => activity.turnId === turnId && activity.tone === "tool");
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  if (!timelineRowsAreSorted(messageRows) || !timelineRowsAreSorted(proposedPlanRows)) {
    return sortTimelineRows(messageRows, proposedPlanRows, workRows);
  }
  if (!timelineRowsAreSorted(workRows)) {
    return sortTimelineRows(messageRows, proposedPlanRows, workRows);
  }
  return mergeSortedTimelineRows(messageRows, proposedPlanRows, workRows);
}

function sortTimelineRows(
  messageRows: TimelineEntry[],
  proposedPlanRows: TimelineEntry[],
  workRows: TimelineEntry[],
): TimelineEntry[] {
  return [...messageRows, ...proposedPlanRows, ...workRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

function timelineRowsAreSorted(rows: ReadonlyArray<TimelineEntry>): boolean {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous && current && previous.createdAt > current.createdAt) {
      return false;
    }
  }
  return true;
}

function mergeSortedTimelineRows(
  messageRows: TimelineEntry[],
  proposedPlanRows: TimelineEntry[],
  workRows: TimelineEntry[],
): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  let messageIndex = 0;
  let proposedPlanIndex = 0;
  let workIndex = 0;

  while (
    messageIndex < messageRows.length ||
    proposedPlanIndex < proposedPlanRows.length ||
    workIndex < workRows.length
  ) {
    const messageRow = messageRows[messageIndex];
    const proposedPlanRow = proposedPlanRows[proposedPlanIndex];
    const workRow = workRows[workIndex];
    const next = earliestTimelineRow(messageRow, proposedPlanRow, workRow);
    result.push(next.row);
    if (next.kind === "message") {
      messageIndex += 1;
    } else if (next.kind === "proposed-plan") {
      proposedPlanIndex += 1;
    } else {
      workIndex += 1;
    }
  }

  return result;
}

function earliestTimelineRow(
  messageRow: TimelineEntry | undefined,
  proposedPlanRow: TimelineEntry | undefined,
  workRow: TimelineEntry | undefined,
): { kind: TimelineEntry["kind"]; row: TimelineEntry } {
  if (
    messageRow &&
    (!proposedPlanRow || messageRow.createdAt <= proposedPlanRow.createdAt) &&
    (!workRow || messageRow.createdAt <= workRow.createdAt)
  ) {
    return { kind: "message", row: messageRow };
  }
  if (proposedPlanRow && (!workRow || proposedPlanRow.createdAt <= workRow.createdAt)) {
    return { kind: "proposed-plan", row: proposedPlanRow };
  }
  if (workRow) {
    return { kind: "work", row: workRow };
  }
  throw new Error("Expected at least one timeline row.");
}

export function deriveCompletionDividerBeforeEntryId(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  latestTurn: Pick<
    OrchestrationLatestTurn,
    "assistantMessageId" | "startedAt" | "completedAt" | "state"
  > | null,
): string | null {
  if (!latestTurn?.startedAt || !latestTurn.completedAt) {
    return null;
  }

  if (latestTurn.assistantMessageId) {
    const exactMatch = timelineEntries.find(
      (timelineEntry) =>
        timelineEntry.kind === "message" &&
        timelineEntry.message.role === "assistant" &&
        timelineEntry.message.id === latestTurn.assistantMessageId,
    );
    if (exactMatch) {
      return exactMatch.id;
    }
  }

  const turnStartedAt = Date.parse(latestTurn.startedAt);
  const turnCompletedAt = Date.parse(latestTurn.completedAt);
  if (Number.isNaN(turnStartedAt) || Number.isNaN(turnCompletedAt)) {
    return null;
  }

  let inRangeMatch: string | null = null;
  let fallbackMatch: string | null = null;
  let interruptedUserFallbackMatch: string | null = null;
  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const messageAt = Date.parse(timelineEntry.message.createdAt);
    if (Number.isNaN(messageAt) || messageAt < turnStartedAt) {
      continue;
    }
    if (latestTurn.state === "interrupted" && timelineEntry.message.role === "user") {
      interruptedUserFallbackMatch = timelineEntry.id;
      continue;
    }
    if (timelineEntry.message.role !== "assistant") {
      continue;
    }
    fallbackMatch = timelineEntry.id;
    if (messageAt <= turnCompletedAt) {
      inRangeMatch = timelineEntry.id;
    }
  }
  return inRangeMatch ?? fallbackMatch ?? interruptedUserFallbackMatch;
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
