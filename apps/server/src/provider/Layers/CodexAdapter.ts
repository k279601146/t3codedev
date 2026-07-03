// @effect-diagnostics nodeBuiltinImport:off
/**
 * CodexAdapterLive - Scoped live implementation for the Codex provider adapter.
 *
 * Wraps the typed Codex session runtime behind the `CodexAdapter` service
 * contract and maps runtime failures into the shared `ProviderAdapterError`
 * algebra.
 *
 * @module CodexAdapterLive
 */
import {
  type CanonicalItemType,
  type CanonicalRequestType,
  type CodexSettings,
  ProviderDriverKind,
  type ProviderEvent,
  ProviderInstanceId,
  type OrchestrationGoal,
  type ProviderRuntimeEvent,
  type ProviderRequestKind,
  type ProviderSession,
  type ThreadTokenUsageSnapshot,
  type ProviderThreadSettingsUpdateInput,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  ProviderApprovalDecision,
  ThreadId,
  ProviderSendTurnInput,
  ProviderSteerTurnInput,
  isToolLifecycleItemType,
  type ServerProviderWindowsSandbox,
  type WindowsSandboxMode,
} from "@t3tools/contracts";
import path from "node:path";
import fsPromises from "node:fs/promises";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Clock from "effect/Clock";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as EffectCodexSchema from "effect-codex-app-server/schema";
import * as CodexClient from "effect-codex-app-server/client";

import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import {
  deriveDynamicToolActivityPresentation,
  deriveToolActivityPresentation,
} from "@t3tools/shared/toolActivity";
import { WINDOWS_SANDBOX_SYSTEM_CACHE_RELATIVE_PATH } from "@t3tools/shared/windowsSandboxArtifacts";

import {
  ProviderAdapterRequestError,
  ProviderAdapterProcessError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { type CodexAdapterShape } from "../Services/CodexAdapter.ts";
import * as BrowserToolServiceLayer from "./BrowserToolService.ts";
import * as BrowserExternalToolServiceLayer from "./BrowserExternalToolService.ts";
import * as ComputerToolServiceLayer from "./ComputerToolService.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import {
  buildCodexProcessEnv,
  buildBundledSpawnArgs,
  buildSystemSpawnArgs,
  resolveBundledEngineConfig,
} from "../BundledEngineConfig.ts";
import { buildWindowsSandboxSnapshot } from "../windowsSandbox.ts";
import {
  buildCodexInitializeParams,
  enableCodexPluginExperimentalFeatures,
} from "./CodexProvider.ts";
import {
  CodexResumeCursorSchema,
  CodexSessionRuntimeThreadIdMissingError,
  makeCodexSessionRuntime,
  spawnCodexAppServerChild,
  type CodexSessionRuntimeError,
  type CodexSessionRuntimeOptions,
  type CodexSessionRuntimeShape,
  type CodexSessionRuntimeUpdateSettingsInput,
} from "./CodexSessionRuntime.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
const isCodexAppServerProcessExitedError = Schema.is(CodexErrors.CodexAppServerProcessExitedError);
const isCodexAppServerTransportError = Schema.is(CodexErrors.CodexAppServerTransportError);
const isCodexSessionRuntimeThreadIdMissingError = Schema.is(
  CodexSessionRuntimeThreadIdMissingError,
);
const isCodexResumeCursorSchema = Schema.is(CodexResumeCursorSchema);

const PROVIDER = ProviderDriverKind.make("codex");
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const COMMERCIAL_USAGE_LIMIT_MESSAGE = "账户余额不足，请充值或等待额度刷新后继续使用。";

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isCommercialUsageLimitSignal(
  message: string | null | undefined,
  detail?: unknown,
): boolean {
  const source = `${message ?? ""} ${detail === undefined ? "" : stringifyUnknown(detail)}`;
  const normalized = source.toLowerCase();
  return (
    /\binsufficient_balance\b/i.test(source) ||
    /insufficient (?:account )?balance/i.test(source) ||
    /余额不足/.test(source) ||
    /\busage_limit_exceeded\b/i.test(source) ||
    (/\bbilling_error\b/i.test(source) && /balance|余额/.test(normalized))
  );
}

function normalizeCommercialUsageLimitMessage(message: string, detail?: unknown): string {
  return isCommercialUsageLimitSignal(message, detail) ? COMMERCIAL_USAGE_LIMIT_MESSAGE : message;
}

export interface CodexAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly makeRuntime?: (
    options: CodexSessionRuntimeOptions,
  ) => Effect.Effect<
    CodexSessionRuntimeShape,
    CodexSessionRuntimeError,
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  >;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly jsonRpcLogPath?: string;
}

interface CodexAdapterSessionContext {
  readonly threadId: ThreadId;
  readonly scope: Scope.Closeable;
  readonly runtime: CodexSessionRuntimeShape;
  readonly eventFiber: Fiber.Fiber<void, never>;
  stopped: boolean;
}

interface CodexWarmProcess {
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  readonly cwd: string;
  readonly createdAtMs: number;
}

const CODEX_WARM_PROCESS_EXIT_POLL_MS = 1;
const CODEX_WARM_PROCESS_MAX_AGE_MS = 120_000;

function isRecoverableRuntimeSessionStatus(status: ProviderSession["status"]): boolean {
  return status === "closed" || status === "error";
}

function mapCodexRuntimeError(
  threadId: ThreadId,
  method: string,
  error: CodexSessionRuntimeError,
): ProviderAdapterError {
  if (isCodexAppServerProcessExitedError(error) || isCodexAppServerTransportError(error)) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause: error,
    });
  }

  if (isCodexSessionRuntimeThreadIdMissingError(error)) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause: error,
    });
  }

  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: normalizeCommercialUsageLimitMessage(error.message),
    cause: error,
  });
}

type CodexLifecycleItem =
  | EffectCodexSchema.V2ItemStartedNotification["item"]
  | EffectCodexSchema.V2ItemCompletedNotification["item"];

type CodexToolUserInputQuestion =
  | EffectCodexSchema.ServerRequest__ToolRequestUserInputQuestion
  | EffectCodexSchema.ToolRequestUserInputParams__ToolRequestUserInputQuestion;

class WindowsSandboxArtifactCleanupError extends Data.TaggedError(
  "WindowsSandboxArtifactCleanupError",
)<{
  readonly cwd: string;
  readonly cause: unknown;
}> {}

const ApprovalDecisionPayload = Schema.Struct({
  decision: ProviderApprovalDecision,
});

function toRuntimeThreadSettingsUpdateInput(
  input: ProviderThreadSettingsUpdateInput,
  boundInstanceId: ProviderInstanceId,
): Effect.Effect<CodexSessionRuntimeUpdateSettingsInput, ProviderAdapterValidationError> {
  return Effect.gen(function* () {
    if (input.modelSelection !== undefined && input.modelSelection.instanceId !== boundInstanceId) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "updateThreadSettings",
        issue: `Codex thread settings are bound to instance '${boundInstanceId}', received '${input.modelSelection.instanceId}'.`,
      });
    }

    const reasoningEffort =
      input.modelSelection !== undefined
        ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
        : undefined;
    const fastMode =
      input.modelSelection !== undefined
        ? getModelSelectionBooleanOptionValue(input.modelSelection, "fastMode")
        : undefined;

    return {
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
      ...(input.modelSelection !== undefined ? { model: input.modelSelection.model } : {}),
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      ...(input.serviceTier !== undefined
        ? { serviceTier: input.serviceTier }
        : fastMode === true
          ? { serviceTier: "fast" }
          : {}),
      ...(input.approvalPolicy !== undefined ? { approvalPolicy: input.approvalPolicy } : {}),
      ...(input.permissionProfileId !== undefined
        ? { permissions: input.permissionProfileId }
        : {}),
      ...(input.permissionProfileId === undefined && input.sandboxPolicy !== undefined
        ? { sandboxPolicy: input.sandboxPolicy }
        : {}),
      ...(input.personality !== undefined ? { personality: input.personality } : {}),
      ...(input.reasoningSummary !== undefined ? { summary: input.reasoningSummary } : {}),
    } satisfies CodexSessionRuntimeUpdateSettingsInput;
  });
}

function readPayload<A>(
  schema: Schema.Schema<A>,
  payload: ProviderEvent["payload"],
): A | undefined {
  const isPayload = Schema.is(schema);
  return isPayload(payload) ? payload : undefined;
}

function trimText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function shouldCleanupWindowsSandboxArtifacts(event: ProviderEvent): boolean {
  if (event.method !== "item/completed") {
    return false;
  }
  const payload = readPayload(EffectCodexSchema.V2ItemCompletedNotification, event.payload);
  return toCanonicalItemType(payload?.item.type) === "command_execution";
}

function cleanupWindowsSandboxWorkspaceArtifacts(cwd: string): Effect.Effect<void> {
  const workspaceRoot = path.resolve(cwd);
  const cachePath = path.resolve(
    workspaceRoot,
    ...WINDOWS_SANDBOX_SYSTEM_CACHE_RELATIVE_PATH.split("/"),
  );
  if (!isPathInsideRoot(workspaceRoot, cachePath)) {
    return Effect.void;
  }

  return Effect.tryPromise({
    try: async () => {
      await fsPromises.rm(cachePath, { force: true, recursive: true });
      let current = path.dirname(cachePath);
      while (current !== workspaceRoot && isPathInsideRoot(workspaceRoot, current)) {
        try {
          await fsPromises.rmdir(current);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            current = path.dirname(current);
            continue;
          }
          break;
        }
        current = path.dirname(current);
      }
    },
    catch: (cause) => new WindowsSandboxArtifactCleanupError({ cwd, cause }),
  }).pipe(
    Effect.catch((error: WindowsSandboxArtifactCleanupError) =>
      Effect.logDebug("failed to cleanup Windows sandbox workspace artifacts", {
        cwd,
        error,
      }),
    ),
  );
}

const FATAL_CODEX_STDERR_SNIPPETS = ["failed to connect to websocket"];
const SUPPRESSED_CODEX_STDERR_PATTERNS = [
  /^wall time:\s*/i,
  /^output:\s*$/i,
  /^stack trace:\s*$/i,
  /^at\s.+/i,
  /^at line:\d+\s+char:\d+/i,
  /^file:\s.+/i,
  /^\+\s.+/i,
  /^~+\s*$/i,
  /^cat\s*:/i,
  /^get-content\s*:/i,
  /^rg:\s.+/i,
  /^select-string\s*:\s.+/i,
  /^variable reference is not valid\./i,
  /^the name\.$/i,
  /^warning:\s.+/i,
  /^\d+:\d+\s+(?:warning|error)\s+/i,
  /^✖\s+\d+\s+problems?\s+\(\d+\s+errors?,\s+\d+\s+warnings?\)/i,
  /^(?:>\s*)?(?:[a-z]:\\|\.{1,2}[\\/]|[\w.-]+[\\/]).+:\d+(?::|$)/i,
  /^[a-z]:\\.+$/i,
  /(?:^|['"`\s])(?:[a-z]:)?\\?[\w .-]+(?:\\[\w .-]+)+['"`]?\s+is denied\.$/i,
  /^categoryinfo\s*:/i,
  /^fullyqualifiederrorid\s*:/i,
  /^total output lines:\s*\d+/i,
];
const SUPPRESSED_CODEX_STDERR_SUBSTRINGS = [
  "codex_core::tools::router: error=exit code:",
  "codex_core::tools::router: error=unsupported call:",
  "filtered by the -include or -exclude parameter.",
  "cannot be bound to any parameters for the command",
  "parameterbindingexception",
  "unrecognized file type:",
];
const VISIBLE_CODEX_STDERR_SUBSTRINGS = [
  "failed to load skill",
  "missing yaml frontmatter",
  "windows sandbox",
  "world-writable",
  "failed to connect to websocket",
];

function isFatalCodexProcessStderrMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return FATAL_CODEX_STDERR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

export function shouldSuppressCodexProcessStderrMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const normalized = trimmed.toLowerCase();
  if (VISIBLE_CODEX_STDERR_SUBSTRINGS.some((snippet) => normalized.includes(snippet))) {
    return false;
  }
  if (SUPPRESSED_CODEX_STDERR_SUBSTRINGS.some((snippet) => normalized.includes(snippet))) {
    return true;
  }
  return SUPPRESSED_CODEX_STDERR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function normalizeCodexTokenUsage(
  usage: EffectCodexSchema.V2ThreadTokenUsageUpdatedNotification["tokenUsage"],
): ThreadTokenUsageSnapshot | undefined {
  const totalProcessedTokens = usage.total.totalTokens;
  const totalInputTokens = usage.total.inputTokens;
  const totalCachedInputTokens = usage.total.cachedInputTokens;
  const totalOutputTokens = usage.total.outputTokens;
  const totalReasoningOutputTokens = usage.total.reasoningOutputTokens;
  const usedTokens = usage.last.totalTokens;
  if (usedTokens === undefined || usedTokens <= 0) {
    return undefined;
  }

  const maxTokens = usage.modelContextWindow ?? undefined;
  const inputTokens = usage.last.inputTokens;
  const cachedInputTokens = usage.last.cachedInputTokens;
  const outputTokens = usage.last.outputTokens;
  const reasoningOutputTokens = usage.last.reasoningOutputTokens;

  return {
    usedTokens,
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(totalInputTokens !== undefined ? { totalInputTokens } : {}),
    ...(totalCachedInputTokens !== undefined ? { totalCachedInputTokens } : {}),
    ...(totalOutputTokens !== undefined ? { totalOutputTokens } : {}),
    ...(totalReasoningOutputTokens !== undefined ? { totalReasoningOutputTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(usedTokens !== undefined ? { lastUsedTokens: usedTokens } : {}),
    ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { lastCachedInputTokens: cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined
      ? { lastReasoningOutputTokens: reasoningOutputTokens }
      : {}),
    compactsAutomatically: true,
  };
}

function toTurnStatus(
  value: EffectCodexSchema.V2TurnCompletedNotification["turn"]["status"] | "cancelled",
): "completed" | "failed" | "cancelled" | "interrupted" {
  switch (value) {
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return value;
    default:
      return "completed";
  }
}

function normalizeItemType(raw: string | undefined | null): string {
  const type = trimText(raw);
  if (!type) return "item";
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toCanonicalItemType(raw: string | undefined | null): CanonicalItemType {
  const type = normalizeItemType(raw);
  if (type.includes("user")) return "user_message";
  if (type.includes("agent message") || type.includes("assistant")) return "assistant_message";
  if (type.includes("reasoning") || type.includes("thought")) return "reasoning";
  if (type.includes("plan") || type.includes("todo")) return "plan";
  if (type.includes("command")) return "command_execution";
  if (type.includes("file change") || type.includes("patch") || type.includes("edit"))
    return "file_change";
  if (type.includes("mcp")) return "mcp_tool_call";
  if (type.includes("dynamic tool")) return "dynamic_tool_call";
  if (type.includes("collab")) return "collab_agent_tool_call";
  if (type.includes("web search")) return "web_search";
  if (type.includes("image")) return "image_view";
  if (type.includes("review entered")) return "review_entered";
  if (type.includes("review exited")) return "review_exited";
  if (type.includes("compact")) return "context_compaction";
  if (type.includes("error")) return "error";
  return "unknown";
}

function itemTitle(itemType: CanonicalItemType): string | undefined {
  switch (itemType) {
    case "assistant_message":
      return "Assistant message";
    case "user_message":
      return "User message";
    case "reasoning":
      return "Reasoning";
    case "plan":
      return "Plan";
    case "command_execution":
      return "Ran command";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "dynamic_tool_call":
      return "Tool call";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "error":
      return "Error";
    default:
      return undefined;
  }
}

function dynamicToolPresentation(item: CodexLifecycleItem) {
  if (!("type" in item) || item.type !== "dynamicToolCall") {
    return undefined;
  }
  return deriveDynamicToolActivityPresentation({
    tool: "tool" in item ? item.tool : undefined,
    namespace: "namespace" in item ? item.namespace : undefined,
    arguments: "arguments" in item ? item.arguments : undefined,
    contentItems: "contentItems" in item ? item.contentItems : undefined,
    success: "success" in item ? item.success : undefined,
    status: "status" in item ? item.status : undefined,
  });
}

function itemDetail(item: CodexLifecycleItem): string | undefined {
  const dynamicDetail = dynamicToolPresentation(item)?.detail;
  if (dynamicDetail) {
    return dynamicDetail;
  }

  const candidates = [
    "command" in item ? item.command : undefined,
    "title" in item ? item.title : undefined,
    "summary" in item ? item.summary : undefined,
    "text" in item ? item.text : undefined,
    "path" in item ? item.path : undefined,
    "prompt" in item ? item.prompt : undefined,
  ];
  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? trimText(candidate) : undefined;
    if (!trimmed) continue;
    return trimmed;
  }
  return undefined;
}

function toRequestTypeFromMethod(method: string): CanonicalRequestType {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "command_execution_approval";
    case "item/fileRead/requestApproval":
      return "file_read_approval";
    case "item/fileChange/requestApproval":
      return "file_change_approval";
    case "applyPatchApproval":
      return "apply_patch_approval";
    case "execCommandApproval":
      return "exec_command_approval";
    case "item/tool/requestUserInput":
      return "tool_user_input";
    case "item/tool/call":
      return "dynamic_tool_call";
    case "account/chatgptAuthTokens/refresh":
      return "auth_tokens_refresh";
    default:
      return "unknown";
  }
}

function toRequestTypeFromKind(kind: ProviderRequestKind | undefined): CanonicalRequestType {
  switch (kind) {
    case "command":
      return "command_execution_approval";
    case "file-read":
      return "file_read_approval";
    case "file-change":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

function toCanonicalUserInputAnswers(
  answers: EffectCodexSchema.ToolRequestUserInputResponse["answers"],
): ProviderUserInputAnswers {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, value]) => {
      const normalizedAnswers = value.answers.length === 1 ? value.answers[0]! : [...value.answers];
      return [questionId, normalizedAnswers] as const;
    }),
  );
}

function toUserInputQuestions(questions: ReadonlyArray<CodexToolUserInputQuestion>) {
  const parsedQuestions = questions
    .map((question) => {
      const options =
        question.options
          ?.map((option) => {
            const label = trimText(option.label);
            const description = trimText(option.description);
            if (!label || !description) {
              return undefined;
            }
            return { label, description };
          })
          .filter((option) => option !== undefined) ?? [];

      const id = trimText(question.id);
      const header = trimText(question.header);
      const prompt = trimText(question.question);
      if (!id || !header || !prompt || options.length === 0) {
        return undefined;
      }
      return {
        id,
        header,
        question: prompt,
        options,
        multiSelect: false,
      };
    })
    .filter((question) => question !== undefined);

  return parsedQuestions.length > 0 ? parsedQuestions : undefined;
}

function toThreadState(
  status: EffectCodexSchema.V2ThreadStatusChangedNotification["status"],
): "active" | "idle" | "archived" | "closed" | "compacted" | "error" {
  switch (status.type) {
    case "idle":
      return "idle";
    case "systemError":
      return "error";
    default:
      return "active";
  }
}

function contentStreamKindFromMethod(
  method: string,
):
  | "assistant_text"
  | "reasoning_text"
  | "reasoning_summary_text"
  | "plan_text"
  | "command_output"
  | "file_change_output" {
  switch (method) {
    case "item/agentMessage/delta":
      return "assistant_text";
    case "item/reasoning/textDelta":
      return "reasoning_text";
    case "item/reasoning/summaryTextDelta":
      return "reasoning_summary_text";
    case "item/commandExecution/outputDelta":
      return "command_output";
    case "item/fileChange/outputDelta":
      return "file_change_output";
    default:
      return "assistant_text";
  }
}

function patchChangeKindLabel(
  kind: { readonly type?: string; readonly move_path?: string | null } | undefined,
): string {
  switch (kind?.type) {
    case "add":
      return "added";
    case "delete":
      return "deleted";
    case "update":
      return kind.move_path ? "renamed" : "modified";
    default:
      return "modified";
  }
}

function mapFileChangePatchUpdated(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ProviderRuntimeEvent | undefined {
  const payload = readPayload(EffectCodexSchema.V2FileChangePatchUpdatedNotification, event.payload);
  if (!payload) {
    return undefined;
  }

  const changes = payload.changes
    .map((change) => ({
      path: trimText(change.path) ?? change.path,
      kind: patchChangeKindLabel(change.kind),
      diff: change.diff,
    }))
    .filter((change) => change.path.length > 0);
  if (changes.length === 0) {
    return undefined;
  }

  return {
    ...runtimeEventBase(event, canonicalThreadId),
    type: "item.updated",
    payload: {
      itemType: "file_change",
      status: "inProgress",
      title: "File change",
      data: {
        itemId: payload.itemId,
        changes,
      },
    },
  };
}

function asRuntimeItemId(itemId: ProviderEvent["itemId"] & string): RuntimeItemId {
  return RuntimeItemId.make(itemId);
}

function asRuntimeRequestId(requestId: string): RuntimeRequestId {
  return RuntimeRequestId.make(requestId);
}

function eventRawSource(event: ProviderEvent): NonNullable<ProviderRuntimeEvent["raw"]>["source"] {
  return event.kind === "request" ? "codex.app-server.request" : "codex.app-server.notification";
}

function providerRefsFromEvent(
  event: ProviderEvent,
): ProviderRuntimeEvent["providerRefs"] | undefined {
  const refs: Record<string, string> = {};
  if (event.turnId) refs.providerTurnId = event.turnId;
  if (event.itemId) refs.providerItemId = event.itemId;
  if (event.requestId) refs.providerRequestId = event.requestId;

  return Object.keys(refs).length > 0 ? (refs as ProviderRuntimeEvent["providerRefs"]) : undefined;
}

function runtimeEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  const refs = providerRefsFromEvent(event);
  return {
    eventId: event.id,
    provider: event.provider,
    threadId: canonicalThreadId,
    createdAt: event.createdAt,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.itemId ? { itemId: asRuntimeItemId(event.itemId) } : {}),
    ...(event.requestId ? { requestId: asRuntimeRequestId(event.requestId) } : {}),
    ...(refs ? { providerRefs: refs } : {}),
    raw: {
      source: eventRawSource(event),
      method: event.method,
      payload: event.payload ?? {},
    },
  };
}

function mapItemLifecycle(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  lifecycle: "item.started" | "item.updated" | "item.completed",
): ProviderRuntimeEvent | undefined {
  const payload =
    readPayload(EffectCodexSchema.V2ItemStartedNotification, event.payload) ??
    readPayload(EffectCodexSchema.V2ItemCompletedNotification, event.payload);
  const item = payload?.item;
  if (!item) {
    return undefined;
  }
  const itemType = toCanonicalItemType(item.type);
  if (itemType === "unknown" && lifecycle !== "item.updated") {
    return undefined;
  }

  const dynamicPresentation = dynamicToolPresentation(item);
  const rawData =
    event.payload !== undefined
      ? typeof event.payload === "object" && event.payload !== null
        ? (event.payload as Record<string, unknown>)
        : { value: event.payload }
      : undefined;
  const fallbackTitle = itemTitle(itemType);
  const toolPresentation =
    isToolLifecycleItemType(itemType) && !dynamicPresentation
      ? deriveToolActivityPresentation({
          itemType,
          title: fallbackTitle,
          detail: itemDetail(item),
          data: rawData,
          fallbackSummary: fallbackTitle,
        })
      : undefined;
  const presentationTitle =
    dynamicPresentation?.title ?? toolPresentation?.summary ?? fallbackTitle;
  const presentationDetail = dynamicPresentation?.detail ?? toolPresentation?.detail;
  const presentation =
    dynamicPresentation ??
    (toolPresentation
      ? {
          title: toolPresentation.summary,
          ...(toolPresentation.detail ? { detail: toolPresentation.detail } : {}),
          ...(toolPresentation.family ? { family: toolPresentation.family } : {}),
          ...(toolPresentation.toolName ? { toolName: toolPresentation.toolName } : {}),
          ...(toolPresentation.argumentsPreview
            ? { argumentsPreview: toolPresentation.argumentsPreview }
            : {}),
          ...(toolPresentation.outputPreview
            ? { outputPreview: toolPresentation.outputPreview }
            : {}),
        }
      : undefined);
  const detail = presentationDetail ?? itemDetail(item);
  const status =
    lifecycle === "item.started"
      ? "inProgress"
      : lifecycle === "item.completed"
        ? "completed"
        : undefined;

  return {
    ...runtimeEventBase(event, canonicalThreadId),
    type: lifecycle,
    payload: {
      itemType,
      ...(status ? { status } : {}),
      ...(presentationTitle ? { title: presentationTitle } : {}),
      ...(detail ? { detail } : {}),
      ...(rawData
        ? {
            data: {
              ...rawData,
              ...(presentation
                ? {
                    presentation,
                  }
                : {}),
            },
          }
        : {}),
    },
  };
}

function mapToRuntimeEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  if (event.kind === "error") {
    if (!event.message) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "runtime.error",
        payload: {
          message: normalizeCommercialUsageLimitMessage(event.message, event.payload),
          class: "provider_error",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.kind === "request") {
    if (event.method === "item/tool/requestUserInput") {
      const payload =
        readPayload(EffectCodexSchema.ServerRequest__ToolRequestUserInputParams, event.payload) ??
        readPayload(EffectCodexSchema.ToolRequestUserInputParams, event.payload);
      const questions = payload ? toUserInputQuestions(payload.questions) : undefined;
      if (!questions) {
        return [];
      }
      return [
        {
          ...runtimeEventBase(event, canonicalThreadId),
          type: "user-input.requested",
          payload: {
            questions,
          },
        },
      ];
    }

    const detail = (() => {
      switch (event.method) {
        case "item/commandExecution/requestApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__CommandExecutionRequestApprovalParams,
            event.payload,
          );
          return payload?.command ?? payload?.reason ?? undefined;
        }
        case "item/fileChange/requestApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__FileChangeRequestApprovalParams,
            event.payload,
          );
          return payload?.reason ?? undefined;
        }
        case "applyPatchApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__ApplyPatchApprovalParams,
            event.payload,
          );
          return payload?.reason ?? undefined;
        }
        case "execCommandApproval": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__ExecCommandApprovalParams,
            event.payload,
          );
          return payload?.reason ?? payload?.command.join(" ");
        }
        case "item/tool/call": {
          const payload = readPayload(
            EffectCodexSchema.ServerRequest__DynamicToolCallParams,
            event.payload,
          );
          return payload?.tool ?? undefined;
        }
        default:
          return undefined;
      }
    })();

    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.opened",
        payload: {
          requestType: toRequestTypeFromMethod(event.method),
          ...(detail ? { detail } : {}),
          ...(event.payload !== undefined ? { args: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/requestApproval/decision" && event.requestId) {
    const payload = readPayload(ApprovalDecisionPayload, event.payload);
    const requestType =
      event.requestKind !== undefined
        ? toRequestTypeFromKind(event.requestKind)
        : toRequestTypeFromMethod(event.method);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.resolved",
        payload: {
          requestType,
          ...(payload ? { decision: payload.decision } : {}),
          ...(event.payload !== undefined ? { resolution: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "session/connecting") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.state.changed",
        payload: {
          state: "starting",
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ];
  }

  if (event.method === "session/ready") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.state.changed",
        payload: {
          state: "ready",
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ];
  }

  if (event.method === "session/started") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.started",
        payload: {
          ...(event.message ? { message: event.message } : {}),
          ...(event.payload !== undefined ? { resume: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "session/exited" || event.method === "session/closed") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.exited",
        payload: {
          ...(event.message ? { reason: event.message } : {}),
          ...(event.method === "session/closed" ? { exitKind: "graceful" } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/started") {
    const payload = readPayload(EffectCodexSchema.V2ThreadStartedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "thread.started",
        payload: {
          providerThreadId: payload.thread.id,
        },
      },
    ];
  }

  if (
    event.method === "thread/status/changed" ||
    event.method === "thread/archived" ||
    event.method === "thread/unarchived" ||
    event.method === "thread/closed" ||
    event.method === "thread/compacted"
  ) {
    const payload =
      event.method === "thread/status/changed"
        ? readPayload(EffectCodexSchema.V2ThreadStatusChangedNotification, event.payload)
        : undefined;
    return [
      {
        type: "thread.state.changed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          state:
            event.method === "thread/archived"
              ? "archived"
              : event.method === "thread/closed"
                ? "closed"
                : event.method === "thread/compacted"
                  ? "compacted"
                  : payload
                    ? toThreadState(payload.status)
                    : "active",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/name/updated") {
    const payload = readPayload(EffectCodexSchema.V2ThreadNameUpdatedNotification, event.payload);
    return [
      {
        type: "thread.metadata.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          ...(trimText(payload?.threadName) ? { name: trimText(payload?.threadName) } : {}),
          ...(payload
            ? {
                metadata: {
                  threadId: payload.threadId,
                  ...(payload.threadName !== undefined && payload.threadName !== null
                    ? { threadName: payload.threadName }
                    : {}),
                },
              }
            : {}),
        },
      },
    ];
  }

  if (event.method === "thread/settings/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadSettingsUpdatedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "session.configured",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          config: {
            threadId: payload.threadId,
            ...payload.threadSettings,
          },
        },
      },
    ];
  }

  if (event.method === "thread/tokenUsage/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadTokenUsageUpdatedNotification,
      event.payload,
    );
    const normalizedUsage = payload ? normalizeCodexTokenUsage(payload.tokenUsage) : undefined;
    if (!normalizedUsage) {
      return [];
    }
    return [
      {
        type: "thread.token-usage.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          usage: normalizedUsage,
        },
      },
    ];
  }

  if (event.method === "turn/started") {
    const turnId = event.turnId;
    if (!turnId) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        turnId,
        type: "turn.started",
        payload: {},
      },
    ];
  }

  if (event.method === "turn/completed") {
    const payload = readPayload(EffectCodexSchema.V2TurnCompletedNotification, event.payload);
    if (!payload) {
      return [];
    }
    const errorMessage = trimText(
      payload.turn.error?.message
        ? normalizeCommercialUsageLimitMessage(payload.turn.error.message, event.payload)
        : undefined,
    );
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.completed",
        payload: {
          state: toTurnStatus(payload.turn.status),
          ...(errorMessage ? { errorMessage } : {}),
        },
      },
    ];
  }

  if (event.method === "turn/aborted") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.aborted",
        payload: {
          reason: event.message ?? "Turn aborted",
        },
      },
    ];
  }

  if (event.method === "turn/plan/updated") {
    const payload = readPayload(EffectCodexSchema.V2TurnPlanUpdatedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.plan.updated",
        payload: {
          ...(trimText(payload.explanation) ? { explanation: trimText(payload.explanation) } : {}),
          plan: payload.plan.map((step) => ({
            step: trimText(step.step) ?? "step",
            status:
              step.status === "completed" || step.status === "inProgress" ? step.status : "pending",
          })),
        },
      },
    ];
  }

  if (event.method === "turn/diff/updated") {
    const payload = readPayload(EffectCodexSchema.V2TurnDiffUpdatedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.diff.updated",
        payload: {
          unifiedDiff: payload.diff,
        },
      },
    ];
  }

  if (event.method === "item/started") {
    const started = mapItemLifecycle(event, canonicalThreadId, "item.started");
    return started ? [started] : [];
  }

  if (event.method === "item/completed") {
    const payload = readPayload(EffectCodexSchema.V2ItemCompletedNotification, event.payload);
    const item = payload?.item;
    if (!item) {
      return [];
    }
    const itemType = toCanonicalItemType(item.type);
    if (itemType === "plan") {
      const detail = itemDetail(item);
      if (!detail) {
        return [];
      }
      return [
        {
          ...runtimeEventBase(event, canonicalThreadId),
          type: "turn.proposed.completed",
          payload: {
            planMarkdown: detail,
          },
        },
      ];
    }
    const completed = mapItemLifecycle(event, canonicalThreadId, "item.completed");
    return completed ? [completed] : [];
  }

  if (
    event.method === "item/reasoning/summaryPartAdded" ||
    event.method === "item/commandExecution/terminalInteraction"
  ) {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "item.updated",
        payload: {
          itemType:
            event.method === "item/reasoning/summaryPartAdded" ? "reasoning" : "command_execution",
          ...(event.payload !== undefined ? { data: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/plan/delta") {
    const payload = readPayload(EffectCodexSchema.V2PlanDeltaNotification, event.payload);
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.proposed.delta",
        payload: {
          delta,
        },
      },
    ];
  }

  if (event.method === "item/agentMessage/delta") {
    const payload = readPayload(EffectCodexSchema.V2AgentMessageDeltaNotification, event.payload);
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: contentStreamKindFromMethod(event.method),
          delta,
        },
      },
    ];
  }

  if (event.method === "item/commandExecution/outputDelta") {
    const payload = readPayload(
      EffectCodexSchema.V2CommandExecutionOutputDeltaNotification,
      event.payload,
    );
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "command_output",
          delta,
        },
      },
    ];
  }

  if (event.method === "item/fileChange/outputDelta") {
    const payload = readPayload(
      EffectCodexSchema.V2FileChangeOutputDeltaNotification,
      event.payload,
    );
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "file_change_output",
          delta,
        },
      },
    ];
  }

  if (event.method === "item/fileChange/patchUpdated") {
    const updated = mapFileChangePatchUpdated(event, canonicalThreadId);
    return updated ? [updated] : [];
  }

  if (event.method === "item/reasoning/summaryTextDelta") {
    const payload = readPayload(
      EffectCodexSchema.V2ReasoningSummaryTextDeltaNotification,
      event.payload,
    );
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "reasoning_summary_text",
          delta,
          ...(payload ? { summaryIndex: payload.summaryIndex } : {}),
        },
      },
    ];
  }

  if (event.method === "item/reasoning/textDelta") {
    const payload = readPayload(EffectCodexSchema.V2ReasoningTextDeltaNotification, event.payload);
    const delta = event.textDelta ?? payload?.delta;
    if (!delta || delta.length === 0) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "reasoning_text",
          delta,
          ...(payload ? { contentIndex: payload.contentIndex } : {}),
        },
      },
    ];
  }

  if (event.method === "item/mcpToolCall/progress") {
    const payload = readPayload(EffectCodexSchema.V2McpToolCallProgressNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "tool.progress",
        payload: {
          summary: payload.message,
        },
      },
    ];
  }

  if (event.method === "serverRequest/resolved") {
    const payload = readPayload(
      EffectCodexSchema.V2ServerRequestResolvedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    const requestType = toRequestTypeFromKind(event.requestKind);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.resolved",
        payload: {
          requestType,
          ...(event.payload !== undefined ? { resolution: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/tool/requestUserInput/answered") {
    const payload = readPayload(EffectCodexSchema.ToolRequestUserInputResponse, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "user-input.resolved",
        payload: {
          answers: toCanonicalUserInputAnswers(payload.answers),
        },
      },
    ];
  }

  if (event.method === "model/rerouted") {
    const payload = readPayload(EffectCodexSchema.V2ModelReroutedNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        type: "model.rerouted",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          fromModel: payload.fromModel,
          toModel: payload.toModel,
          reason: payload.reason,
        },
      },
    ];
  }

  if (event.method === "thread/goal/updated") {
    const payload = readPayload(EffectCodexSchema.V2ThreadGoalUpdatedNotification, event.payload);
    if (!payload) {
      return [];
    }
    const goal: OrchestrationGoal = {
      objective: payload.goal.objective,
      status: payload.goal.status,
      updatedAt: event.createdAt,
      startedAt: event.createdAt,
      activeSince: payload.goal.status === "active" ? event.createdAt : null,
      elapsedMs: 0,
      completedAt: payload.goal.status === "complete" ? event.createdAt : null,
    };
    return [
      {
        type: "thread.goal.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: { goal },
      },
    ];
  }

  if (event.method === "thread/goal/cleared") {
    if (!readPayload(EffectCodexSchema.V2ThreadGoalClearedNotification, event.payload)) {
      return [];
    }
    return [
      {
        type: "thread.goal.cleared",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {},
      },
    ];
  }

  if (event.method === "deprecationNotice") {
    const payload = readPayload(EffectCodexSchema.V2DeprecationNoticeNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        type: "deprecation.notice",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          summary: payload.summary,
          ...(trimText(payload.details) ? { details: trimText(payload.details) } : {}),
        },
      },
    ];
  }

  if (event.method === "configWarning") {
    const payload = readPayload(EffectCodexSchema.V2ConfigWarningNotification, event.payload);
    if (!payload) {
      return [];
    }
    return [
      {
        type: "config.warning",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          summary: payload.summary,
          ...(trimText(payload.details) ? { details: trimText(payload.details) } : {}),
          ...(trimText(payload.path) ? { path: trimText(payload.path) } : {}),
          ...(payload.range !== undefined && payload.range !== null
            ? { range: payload.range }
            : {}),
        },
      },
    ];
  }

  if (event.method === "account/updated") {
    if (!readPayload(EffectCodexSchema.V2AccountUpdatedNotification, event.payload)) {
      return [];
    }
    return [
      {
        type: "account.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          account: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "account/rateLimits/updated") {
    if (!readPayload(EffectCodexSchema.V2AccountRateLimitsUpdatedNotification, event.payload)) {
      return [];
    }
    return [
      {
        type: "account.rate-limits.updated",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          rateLimits: event.payload ?? {},
        },
      },
    ];
  }

  if (event.method === "mcpServer/oauthLogin/completed") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerOauthLoginCompletedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "mcp.oauth.completed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          success: payload.success,
          name: payload.name,
          ...(trimText(payload.error) ? { error: trimText(payload.error) } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/realtime/started") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeStartedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "thread.realtime.started",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          realtimeSessionId: payload.realtimeSessionId ?? undefined,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/itemAdded") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeItemAddedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "thread.realtime.item-added",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          item: payload.item,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/outputAudio/delta") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeOutputAudioDeltaNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    return [
      {
        type: "thread.realtime.audio.delta",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          audio: payload.audio,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/error") {
    const payload = readPayload(EffectCodexSchema.V2ThreadRealtimeErrorNotification, event.payload);
    const message = payload?.message ?? event.message ?? "Realtime error";
    return [
      {
        type: "thread.realtime.error",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message,
        },
      },
    ];
  }

  if (event.method === "thread/realtime/closed") {
    const payload = readPayload(
      EffectCodexSchema.V2ThreadRealtimeClosedNotification,
      event.payload,
    );
    return [
      {
        type: "thread.realtime.closed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          reason: payload?.reason ?? event.message,
        },
      },
    ];
  }

  if (event.method === "error") {
    const payload = readPayload(EffectCodexSchema.V2ErrorNotification, event.payload);
    const message = normalizeCommercialUsageLimitMessage(
      payload?.error.message ?? event.message ?? "Provider runtime error",
      event.payload,
    );
    const willRetry = payload?.willRetry === true;
    return [
      {
        type: willRetry ? "runtime.warning" : "runtime.error",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message,
          ...(!willRetry ? { class: "provider_error" as const } : {}),
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "process/stderr") {
    const isUsageLimit = isCommercialUsageLimitSignal(event.message, event.payload);
    const message = normalizeCommercialUsageLimitMessage(
      event.message ?? "Codex process stderr",
      event.payload,
    );
    const isFatal = isUsageLimit || isFatalCodexProcessStderrMessage(message);
    if (!isFatal && shouldSuppressCodexProcessStderrMessage(message)) {
      return [];
    }
    return [
      isFatal
        ? {
            type: "runtime.error",
            ...runtimeEventBase(event, canonicalThreadId),
            payload: {
              message,
              class: "provider_error" as const,
              ...(event.payload !== undefined ? { detail: event.payload } : {}),
            },
          }
        : {
            type: "runtime.warning",
            ...runtimeEventBase(event, canonicalThreadId),
            payload: {
              message,
              ...(event.payload !== undefined ? { detail: event.payload } : {}),
            },
          },
    ];
  }

  if (event.method === "windows/worldWritableWarning") {
    if (!readPayload(EffectCodexSchema.V2WindowsWorldWritableWarningNotification, event.payload)) {
      return [];
    }
    return [
      {
        type: "runtime.warning",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message: event.message ?? "Windows world-writable warning",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "windowsSandbox/readiness") {
    return [];
  }

  if (event.method === "windowsSandbox/setupCompleted") {
    const payload = readPayload(
      EffectCodexSchema.V2WindowsSandboxSetupCompletedNotification,
      event.payload,
    );
    if (!payload) {
      return [];
    }
    const successMessage = event.message ?? "Windows sandbox setup completed";
    const failureMessage = event.message ?? "Windows sandbox setup failed";

    return [
      {
        type: "session.state.changed",
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          state: payload.success === false ? "error" : "ready",
          reason: payload.success === false ? failureMessage : successMessage,
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
      ...(payload.success === false
        ? [
            {
              type: "runtime.warning" as const,
              ...runtimeEventBase(event, canonicalThreadId),
              payload: {
                message: failureMessage,
                ...(event.payload !== undefined ? { detail: event.payload } : {}),
              },
            },
          ]
        : []),
    ];
  }

  return [];
}

/**
 * Build a Codex provider adapter bound to a specific `CodexSettings` payload.
 *
 * The adapter is a captured closure over `codexConfig` — the `binaryPath` and
 * `homePath` are read from that payload, not from `ServerSettingsService`.
 * This is what makes multi-instance routing possible: each `ProviderInstance`
 * in the registry owns its own closure with its own config, so two Codex
 * instances with different `homePath`s cannot step on each other.
 */
export const makeCodexAdapter = Effect.fn("makeCodexAdapter")(function* (
  codexConfig: CodexSettings,
  options?: CodexAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("codex");
  const fileSystem = yield* FileSystem.FileSystem;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const adapterScope = yield* Scope.Scope;
  const serverConfig = yield* Effect.service(ServerConfig);
  const defaultCwd = serverConfig.conversationWorkspaceDir;
  yield* fileSystem.makeDirectory(defaultCwd, { recursive: true }).pipe(Effect.ignore);
  const defaultCwdForThread = (threadId: ThreadId): string => path.join(defaultCwd, threadId);
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: "native",
        })
      : undefined);
  const managedNativeEventLogger =
    options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
  const jsonRpcLogPath =
    options?.jsonRpcLogPath ?? path.join(serverConfig.providerLogsDir, "jsonrpc.log");
  const runtimeEventQueue = yield* Queue.bounded<ProviderRuntimeEvent>(2048);
  const warmProcessRef = yield* Ref.make<Option.Option<CodexWarmProcess>>(Option.none());
  const windowsSandboxSetupErrorRef = yield* Ref.make<string | null>(null);
  const sessions = new Map<ThreadId, CodexAdapterSessionContext>();
  const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());

  const closeWarmProcess = (warmProcess: CodexWarmProcess): Effect.Effect<void> =>
    warmProcess.child
      .kill({ killSignal: "SIGTERM" })
      .pipe(
        Effect.catchCause((cause) => Effect.logDebug("codex warm process close failed", { cause })),
      );

  const effectiveEnvironment = Effect.succeed(options?.environment);

  const resetWarmProcessAfterWindowsSandboxConfigChange = (reason: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const warmProcess = yield* Ref.getAndSet(warmProcessRef, Option.none());
      if (Option.isSome(warmProcess)) {
        yield* closeWarmProcess(warmProcess.value).pipe(Effect.ignore);
      }
      yield* Effect.logDebug("codex warm process reset after Windows sandbox config change", {
        reason,
      });
    });

  const isWarmProcessReusable = Effect.fn("codexAdapter.isWarmProcessReusable")(function* (
    warmProcess: CodexWarmProcess,
    cwd: string,
  ) {
    if (warmProcess.cwd !== cwd) {
      yield* Effect.logDebug("codex warm process cwd mismatch before reuse", {
        warmCwd: warmProcess.cwd,
        requestedCwd: cwd,
      });
      yield* closeWarmProcess(warmProcess);
      return false;
    }

    const ageMs = (yield* Clock.currentTimeMillis) - warmProcess.createdAtMs;
    if (ageMs > CODEX_WARM_PROCESS_MAX_AGE_MS) {
      yield* Effect.logDebug("codex warm process expired before reuse", {
        cwd: warmProcess.cwd,
        ageMs,
      });
      yield* closeWarmProcess(warmProcess);
      return false;
    }

    const exitStatus = yield* warmProcess.child.exitCode.pipe(
      Effect.timeoutOption(Duration.millis(CODEX_WARM_PROCESS_EXIT_POLL_MS)),
      Effect.catchCause((cause) =>
        Effect.logDebug("codex warm process liveness check failed", { cause }).pipe(
          Effect.as(Option.some(undefined)),
        ),
      ),
    );
    if (Option.isSome(exitStatus)) {
      yield* Effect.logDebug("codex warm process exited before reuse", {
        cwd: warmProcess.cwd,
        exitCode: exitStatus.value,
      });
      yield* closeWarmProcess(warmProcess);
      return false;
    }

    return true;
  });

  const warmStandby = Effect.fn("codexAdapter.warmStandby")(function* (cwd: string) {
    if (options?.makeRuntime !== undefined) {
      return;
    }
    const existing = yield* Ref.get(warmProcessRef);
    if (Option.isSome(existing)) {
      return;
    }
    const childOption = yield* spawnCodexAppServerChild({
      binaryPath: codexConfig.binaryPath,
      ...(codexConfig.homePath ? { homePath: codexConfig.homePath } : { homePath: undefined }),
      ...(options?.environment
        ? { environment: yield* effectiveEnvironment }
        : { environment: undefined }),
      cwd,
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      Effect.map((child) => Option.some(child)),
      Effect.catch((error) =>
        Effect.logDebug("codex warm process spawn failed", { detail: error.message }).pipe(
          Effect.as(Option.none<ChildProcessSpawner.ChildProcessHandle>()),
        ),
      ),
    );
    if (Option.isNone(childOption)) {
      return;
    }
    const child = childOption.value;
    const createdAtMs = yield* Clock.currentTimeMillis;
    const installed = yield* Ref.modify(warmProcessRef, (current) => {
      if (Option.isSome(current)) {
        return [false, current] as const;
      }
      return [true, Option.some({ child, cwd, createdAtMs })] as const;
    });
    if (!installed) {
      yield* child.kill({ killSignal: "SIGTERM" }).pipe(Effect.ignore);
    }
  });

  const acquireWarmProcess = Effect.fn("codexAdapter.acquireWarmProcess")(function* (cwd: string) {
    if (options?.makeRuntime !== undefined) {
      return undefined;
    }
    const warmProcess = yield* Ref.getAndSet(warmProcessRef, Option.none());
    yield* warmStandby(cwd).pipe(Effect.forkIn(adapterScope), Effect.asVoid);
    if (Option.isNone(warmProcess)) {
      return undefined;
    }
    const reusable = yield* isWarmProcessReusable(warmProcess.value, cwd);
    return reusable ? warmProcess.value.child : undefined;
  });

  const buildWindowsSandboxState = (input: {
    readonly mode: WindowsSandboxMode;
    readonly readiness?: EffectCodexSchema.V2WindowsSandboxReadinessResponse["status"];
    readonly lastError?: string | null;
  }): Effect.Effect<ServerProviderWindowsSandbox> =>
    Effect.gen(function* () {
      const updatedAt = yield* nowIso;
      const environment = yield* effectiveEnvironment;
      return buildWindowsSandboxSnapshot({
        binaryPath: codexConfig.binaryPath,
        ...(environment !== undefined ? { environment } : {}),
        mode: input.mode,
        ...(input.readiness !== undefined ? { readiness: input.readiness } : {}),
        lastError: input.lastError ?? null,
        updatedAt,
      });
    });

  const firstActiveRuntime = Effect.sync(() => {
    for (const session of sessions.values()) {
      if (!session.stopped) {
        return session.runtime;
      }
    }
    return undefined;
  });

  const withTemporaryClient = <A>(
    operation: (
      client: CodexClient.CodexAppServerClientShape,
    ) => Effect.Effect<A, CodexErrors.CodexAppServerError>,
  ): Effect.Effect<A, CodexErrors.CodexAppServerError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseEnv = (yield* effectiveEnvironment) ?? process.env;
        const bundledConfig = resolveBundledEngineConfig(baseEnv);
        const effectiveBinaryPath = bundledConfig?.binaryPath ?? codexConfig.binaryPath;
        const spawnArgs = bundledConfig
          ? buildBundledSpawnArgs(bundledConfig)
          : buildSystemSpawnArgs();
        const resolvedHomePath = codexConfig.homePath
          ? expandHomePath(codexConfig.homePath)
          : undefined;
        const clientContext = yield* Layer.build(
          CodexClient.layerCommand({
            command: effectiveBinaryPath,
            args: [...spawnArgs],
            cwd: defaultCwd,
            env: buildCodexProcessEnv({
              baseEnv,
              resolvedHomePath,
              bundledConfig,
            }),
          }),
        );
        const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
          Effect.provide(clientContext),
        );
        yield* client.request("initialize", buildCodexInitializeParams());
        yield* client.notify("initialized", undefined);
        yield* enableCodexPluginExperimentalFeatures(client, {
          operation: "windowsSandbox.request",
        });
        return yield* operation(client);
      }),
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner));

  const requestWindowsSandboxReadiness = (input: {
    readonly mode: WindowsSandboxMode;
  }): Effect.Effect<ServerProviderWindowsSandbox, ProviderAdapterError> =>
    Effect.gen(function* () {
      const lastSetupError = yield* Ref.get(windowsSandboxSetupErrorRef);
      if (lastSetupError) {
        return yield* buildWindowsSandboxState({
          mode: input.mode,
          lastError: lastSetupError,
        });
      }
      const runtime = yield* firstActiveRuntime;
      const readiness = runtime?.windowsSandboxReadiness
        ? yield* runtime.windowsSandboxReadiness
        : yield* withTemporaryClient((client) =>
            client.request("windowsSandbox/readiness", undefined),
          );
      if (readiness.status === "ready") {
        yield* Ref.set(windowsSandboxSetupErrorRef, null);
      }
      return yield* buildWindowsSandboxState({
        mode: input.mode,
        readiness: readiness.status,
      });
    }).pipe(
      Effect.catch((cause) =>
        buildWindowsSandboxState({
          mode: input.mode,
          lastError: cause instanceof Error ? cause.message : String(cause),
        }),
      ),
    );

  const requestWindowsSandboxSetupStart = (input: {
    readonly mode: WindowsSandboxMode;
  }): Effect.Effect<
    { readonly started: boolean; readonly windowsSandbox: ServerProviderWindowsSandbox },
    ProviderAdapterError
  > =>
    Effect.gen(function* () {
      yield* Ref.set(windowsSandboxSetupErrorRef, null);
      const runtime = yield* firstActiveRuntime;
      if (runtime?.windowsSandboxSetupStart) {
        const response = yield* runtime.windowsSandboxSetupStart({ mode: input.mode });
        const windowsSandbox = yield* requestWindowsSandboxReadiness(input);
        return {
          started: response.started,
          windowsSandbox,
        };
      }

      const result = yield* withTemporaryClient((client) =>
        Effect.gen(function* () {
          const setupCompleted =
            yield* Deferred.make<EffectCodexSchema.V2WindowsSandboxSetupCompletedNotification>();
          yield* client.handleServerNotification("windowsSandbox/setupCompleted", (payload) =>
            Deferred.succeed(setupCompleted, payload).pipe(Effect.asVoid),
          );
          const response = yield* client.request("windowsSandbox/setupStart", {
            mode: input.mode,
            cwd: defaultCwd,
          });
          const readiness = yield* client.request("windowsSandbox/readiness", undefined);
          let windowsSandbox = yield* buildWindowsSandboxState({
            mode: input.mode,
            readiness: readiness.status,
          });
          if (response.started) {
            const completed = yield* Deferred.await(setupCompleted).pipe(
              Effect.timeoutOption(Duration.seconds(10)),
            );
            if (Option.isSome(completed)) {
              if (completed.value.success === false) {
                const detail = completed.value.error ?? "Windows sandbox setup failed.";
                yield* Ref.set(windowsSandboxSetupErrorRef, detail);
                windowsSandbox = yield* buildWindowsSandboxState({
                  mode: input.mode,
                  lastError: detail,
                });
              } else {
                yield* Ref.set(windowsSandboxSetupErrorRef, null);
                windowsSandbox = yield* buildWindowsSandboxState({
                  mode: input.mode,
                  readiness: "ready",
                });
                yield* resetWarmProcessAfterWindowsSandboxConfigChange(
                  `windows sandbox setup completed for ${completed.value.mode}`,
                );
              }
            }
          }
          return { response, windowsSandbox };
        }),
      );
      return {
        started: result.response.started,
        windowsSandbox: result.windowsSandbox,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          const detail = cause instanceof Error ? cause.message : String(cause);
          const windowsSandbox = yield* buildWindowsSandboxState({
            mode: input.mode,
            lastError: detail,
          });
          return { started: false, windowsSandbox };
        }),
      ),
    );

  yield* warmStandby(defaultCwd).pipe(Effect.forkScoped, Effect.asVoid);

  const getThreadSemaphore = (threadId: string) =>
    SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
      const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(
        current.get(threadId),
      );
      return Option.match(existing, {
        onNone: () =>
          Semaphore.make(1).pipe(
            Effect.map((semaphore) => {
              const next = new Map(current);
              next.set(threadId, semaphore);
              return [semaphore, next] as const;
            }),
          ),
        onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
      });
    });

  const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

  const startSession: CodexAdapterShape["startSession"] = (input) =>
    withThreadLock(
      input.threadId,
      Effect.scoped(
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }

          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* Effect.suspend(() => stopSessionInternal(existing));
          }

          const runtimeEnvironment = yield* effectiveEnvironment;
          const runtimeCwd = input.cwd ?? defaultCwdForThread(input.threadId);
          yield* fileSystem.makeDirectory(runtimeCwd, { recursive: true }).pipe(Effect.ignore);
          const runtimeInput: CodexSessionRuntimeOptions = {
            threadId: input.threadId,
            providerInstanceId: boundInstanceId,
            cwd: runtimeCwd,
            binaryPath: codexConfig.binaryPath,
            ...(runtimeEnvironment !== undefined ? { environment: runtimeEnvironment } : {}),
            ...(codexConfig.homePath ? { homePath: codexConfig.homePath } : {}),
            ...(isCodexResumeCursorSchema(input.resumeCursor)
              ? { resumeCursor: input.resumeCursor }
              : {}),
            runtimeMode: input.runtimeMode,
            ...(input.modelSelection?.instanceId === boundInstanceId
              ? { model: input.modelSelection.model }
              : {}),
            ...(input.modelSelection?.instanceId === boundInstanceId &&
            getModelSelectionBooleanOptionValue(input.modelSelection, "fastMode") === true
              ? { serviceTier: "fast" }
              : {}),
            ...(input.personality !== undefined ? { personality: input.personality } : {}),
            jsonRpcLogPath,
          };
          const sessionScope = yield* Scope.make("sequential");
          let sessionScopeTransferred = false;
          yield* Effect.addFinalizer(() =>
            sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );
          const createRuntime =
            options?.makeRuntime ??
            ((runtimeOptions: CodexSessionRuntimeOptions) =>
              makeCodexSessionRuntime(runtimeOptions).pipe(
                Effect.provide(
                  Layer.mergeAll(
                    BrowserToolServiceLayer.layer,
                    BrowserExternalToolServiceLayer.layer,
                    ComputerToolServiceLayer.layer,
                  ),
                ),
              ));
          const prewarmedChild = yield* acquireWarmProcess(runtimeInput.cwd);
          const runtime = yield* createRuntime({
            ...runtimeInput,
            ...(prewarmedChild ? { prewarmedChild } : {}),
          }).pipe(
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
          );

          const eventFiber = yield* Stream.runForEach(runtime.events, (event) =>
            Effect.gen(function* () {
              yield* writeNativeEvent(event);
              if (event.method === "windowsSandbox/setupCompleted") {
                const payload = readPayload(
                  EffectCodexSchema.V2WindowsSandboxSetupCompletedNotification,
                  event.payload,
                );
                if (payload?.success === false) {
                  yield* Ref.set(
                    windowsSandboxSetupErrorRef,
                    payload.error ?? "Windows sandbox setup failed.",
                  );
                } else if (payload?.success === true) {
                  yield* Ref.set(windowsSandboxSetupErrorRef, null);
                  yield* resetWarmProcessAfterWindowsSandboxConfigChange(
                    `windows sandbox setup completed for ${payload.mode}`,
                  );
                }
              }
              if (shouldCleanupWindowsSandboxArtifacts(event)) {
                yield* cleanupWindowsSandboxWorkspaceArtifacts(runtimeInput.cwd);
              }
              const runtimeEvents = mapToRuntimeEvents(event, event.threadId);
              if (runtimeEvents.length === 0) {
                yield* Effect.logDebug("ignoring unhandled Codex provider event", {
                  method: event.method,
                  threadId: event.threadId,
                  turnId: event.turnId,
                  itemId: event.itemId,
                });
                return;
              }
              yield* Queue.offerAll(runtimeEventQueue, runtimeEvents);
            }),
          ).pipe(Effect.forkChild);

          const started = yield* runtime.start().pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
            Effect.onError(() =>
              runtime.close.pipe(
                Effect.andThen(Effect.ignore(Scope.close(sessionScope, Exit.void))),
                Effect.andThen(Fiber.interrupt(eventFiber)),
                Effect.ignore,
              ),
            ),
          );

          sessions.set(input.threadId, {
            threadId: input.threadId,
            scope: sessionScope,
            runtime,
            eventFiber,
            stopped: false,
          });
          sessionScopeTransferred = true;

          return started;
        }),
      ),
    );

  const isImageMimeType = (mimeType: string): boolean => {
    const lower = mimeType.toLowerCase();
    return (
      lower.startsWith("image/") &&
      (lower.includes("png") ||
        lower.includes("jpeg") ||
        lower.includes("jpg") ||
        lower.includes("gif") ||
        lower.includes("webp") ||
        lower.includes("heic") ||
        lower.includes("heif"))
    );
  };

  const resolveAttachment = Effect.fn("resolveAttachment")(function* (
    input: Pick<ProviderSendTurnInput | ProviderSteerTurnInput, "threadId">,
    attachment: NonNullable<ProviderSendTurnInput["attachments"]>[number],
  ) {
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: `Invalid attachment id '${attachment.id}'.`,
      });
    }
    const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: `Failed to read attachment file: ${cause.message}.`,
            cause,
          }),
      ),
    );

    if (isImageMimeType(attachment.mimeType)) {
      return {
        type: "image" as const,
        url: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
      };
    } else {
      return {
        type: "text" as const,
        name: attachment.name ?? "attachment",
        content: Buffer.from(bytes).toString("utf-8"),
      };
    }
  });

  const prepareRuntimeInput = Effect.fn("prepareRuntimeInput")(function* (
    input: Pick<
      ProviderSendTurnInput | ProviderSteerTurnInput,
      "threadId" | "input" | "attachments"
    >,
  ) {
    const codexAttachments = yield* Effect.forEach(
      input.attachments ?? [],
      (attachment) => resolveAttachment(input, attachment),
      { concurrency: 1 },
    );

    const imageAttachments: Array<{ readonly type: "image"; readonly url: string }> = [];
    let extraTextInput = "";

    for (const attachment of codexAttachments) {
      if (attachment.type === "image") {
        imageAttachments.push(attachment);
      } else if (attachment.type === "text") {
        const ext = attachment.name.split(".").pop() ?? "";
        extraTextInput += `\n\n[Attachment: ${attachment.name}]\n\`\`\`${ext}\n${attachment.content}\n\`\`\`\n`;
      }
    }

    let finalPrompt = input.input ?? "";
    if (extraTextInput.length > 0) {
      finalPrompt = finalPrompt ? `${finalPrompt}${extraTextInput}` : extraTextInput.trim();
    }

    return {
      ...(finalPrompt ? { input: finalPrompt } : {}),
      ...(imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
    };
  });

  const sendTurn: CodexAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
    const runtimeInput = yield* prepareRuntimeInput(input);
    const session = yield* requireSession(input.threadId);
    const reasoningEffort =
      input.modelSelection?.instanceId === boundInstanceId
        ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
        : undefined;
    const fastMode =
      input.modelSelection?.instanceId === boundInstanceId
        ? getModelSelectionBooleanOptionValue(input.modelSelection, "fastMode")
        : undefined;
    return yield* session.runtime
      .sendTurn({
        ...runtimeInput,
        ...(input.modelSelection?.instanceId === boundInstanceId
          ? { model: input.modelSelection.model }
          : {}),
        ...(reasoningEffort
          ? {
              effort: reasoningEffort as EffectCodexSchema.V2TurnStartParams__ReasoningEffort,
            }
          : {}),
        ...(fastMode === true ? { serviceTier: "fast" } : {}),
        ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
        ...(input.personality !== undefined ? { personality: input.personality } : {}),
      })
      .pipe(Effect.mapError((cause) => mapCodexRuntimeError(input.threadId, "turn/start", cause)));
  });

  const requireSession = Effect.fn("requireSession")(function* (threadId: ThreadId) {
    const session = sessions.get(threadId);
    if (!session || session.stopped) {
      return yield* new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      });
    }
    return session;
  });

  const steerTurn: CodexAdapterShape["steerTurn"] = Effect.fn("steerTurn")(function* (input) {
    const runtimeInput = yield* prepareRuntimeInput(input);
    const session = yield* requireSession(input.threadId);
    return yield* session.runtime
      .steerTurn({
        expectedTurnId: input.expectedTurnId,
        ...runtimeInput,
      })
      .pipe(Effect.mapError((cause) => mapCodexRuntimeError(input.threadId, "turn/steer", cause)));
  });

  const interruptTurn: CodexAdapterShape["interruptTurn"] = (threadId, turnId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.interruptTurn(turnId)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "turn/interrupt", cause),
      ),
    );

  const readThread: CodexAdapterShape["readThread"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.readThread),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/read", cause),
      ),
      Effect.map((snapshot) => ({
        threadId,
        turns: snapshot.turns,
      })),
    );

  const listThreadTurns: NonNullable<CodexAdapterShape["listThreadTurns"]> = (input) =>
    requireSession(input.threadId).pipe(
      Effect.flatMap((session) =>
        session.runtime.listThreadTurns({
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.itemsView !== undefined ? { itemsView: input.itemsView } : {}),
          ...(input.sortDirection !== undefined ? { sortDirection: input.sortDirection } : {}),
        }),
      ),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(input.threadId, "thread/turns/list", cause),
      ),
    );

  const listThreadTurnItems: NonNullable<CodexAdapterShape["listThreadTurnItems"]> = (input) =>
    requireSession(input.threadId).pipe(
      Effect.flatMap((session) =>
        session.runtime.listThreadTurnItems({
          turnId: input.turnId,
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.sortDirection !== undefined ? { sortDirection: input.sortDirection } : {}),
        }),
      ),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(input.threadId, "thread/turns/items/list", cause),
      ),
    );

  const rollbackThread: CodexAdapterShape["rollbackThread"] = (threadId, numTurns) => {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        }),
      );
    }

    return requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.rollbackThread(numTurns)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/rollback", cause),
      ),
      Effect.map((snapshot) => ({
        threadId,
        turns: snapshot.turns,
      })),
    );
  };

  const setGoal: NonNullable<CodexAdapterShape["setGoal"]> = Effect.fn("setGoal")(
    function* (input) {
      const session = yield* requireSession(input.threadId);
      const goal = yield* session.runtime
        .setGoal({
          objective: input.objective,
          ...(input.status ? { status: input.status } : {}),
        })
        .pipe(
          Effect.mapError((cause) =>
            mapCodexRuntimeError(input.threadId, "thread/goal/set", cause),
          ),
        );
      return {
        threadId: input.threadId,
        goal,
      };
    },
  );

  const setGoalStatus: NonNullable<CodexAdapterShape["setGoalStatus"]> = Effect.fn("setGoalStatus")(
    function* (input) {
      const session = yield* requireSession(input.threadId);
      const goal = yield* session.runtime
        .setGoalStatus(input.status)
        .pipe(
          Effect.mapError((cause) =>
            mapCodexRuntimeError(input.threadId, "thread/goal/set", cause),
          ),
        );
      return {
        threadId: input.threadId,
        goal,
      };
    },
  );

  const getGoal: NonNullable<CodexAdapterShape["getGoal"]> = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.getGoal),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/goal/get", cause),
      ),
      Effect.map((goal) => ({
        threadId,
        goal,
      })),
    );

  const clearGoal: NonNullable<CodexAdapterShape["clearGoal"]> = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.clearGoal),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/goal/clear", cause),
      ),
      Effect.map((cleared) => ({
        threadId,
        cleared,
      })),
    );

  const updateThreadSettings: NonNullable<CodexAdapterShape["updateThreadSettings"]> = Effect.fn(
    "updateThreadSettings",
  )(function* (input) {
    const runtimeInput = yield* toRuntimeThreadSettingsUpdateInput(input, boundInstanceId);
    const session = yield* requireSession(input.threadId);
    yield* session.runtime
      .updateThreadSettings(runtimeInput)
      .pipe(
        Effect.mapError((cause) =>
          mapCodexRuntimeError(input.threadId, "thread/settings/update", cause),
        ),
      );
    return {
      threadId: input.threadId,
      updated: true,
    };
  });

  const respondToRequest: CodexAdapterShape["respondToRequest"] = (threadId, requestId, decision) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.respondToRequest(requestId, decision)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "item/requestApproval/decision", cause),
      ),
    );

  const respondToUserInput: CodexAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.respondToUserInput(requestId, answers)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "item/tool/requestUserInput", cause),
      ),
    );

  const writeNativeEvent = Effect.fn("writeNativeEvent")(function* (event: ProviderEvent) {
    if (!nativeEventLogger) {
      return;
    }
    yield* nativeEventLogger.write(event, event.threadId);
  });

  const stopSessionInternal = Effect.fn("stopSessionInternal")(function* (
    session: CodexAdapterSessionContext,
  ) {
    if (session.stopped) {
      return;
    }
    session.stopped = true;
    sessions.delete(session.threadId);
    yield* session.runtime.close.pipe(Effect.ignore);
    yield* Effect.ignore(Scope.close(session.scope, Exit.void));
    yield* Fiber.interrupt(session.eventFiber).pipe(Effect.ignore);
  });

  const stopSession: CodexAdapterShape["stopSession"] = (threadId) =>
    withThreadLock(
      threadId,
      Effect.gen(function* () {
        const session = sessions.get(threadId);
        if (!session) {
          return;
        }
        yield* stopSessionInternal(session);
      }),
    );

  const listSessions: CodexAdapterShape["listSessions"] = () =>
    Effect.forEach(
      Array.from(sessions.values()).filter((session) => !session.stopped),
      (session) => session.runtime.getSession,
      { concurrency: 1 },
    ).pipe(
      Effect.map((activeSessions) =>
        activeSessions.filter((session) => !isRecoverableRuntimeSessionStatus(session.status)),
      ),
    );

  const hasSession: CodexAdapterShape["hasSession"] = (threadId) =>
    Effect.gen(function* () {
      const session = sessions.get(threadId);
      if (!session || session.stopped) {
        return false;
      }
      const snapshot = yield* session.runtime.getSession;
      if (!isRecoverableRuntimeSessionStatus(snapshot.status)) {
        return true;
      }
      yield* stopSessionInternal(session).pipe(Effect.ignore);
      return false;
    });

  const stopAll: CodexAdapterShape["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.values()), stopSessionInternal, {
      concurrency: 1,
      discard: true,
    }).pipe(Effect.asVoid);

  yield* Effect.acquireRelease(Effect.void, () =>
    Effect.gen(function* () {
      const warmProcess = yield* Ref.getAndSet(warmProcessRef, Option.none());
      if (Option.isSome(warmProcess)) {
        yield* closeWarmProcess(warmProcess.value);
      }
      yield* stopAll();
      yield* Queue.shutdown(runtimeEventQueue);
      yield* managedNativeEventLogger?.close() ?? Effect.void;
    }).pipe(Effect.ignore),
  );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    steerTurn,
    interruptTurn,
    readThread,
    listThreadTurns,
    listThreadTurnItems,
    rollbackThread,
    windowsSandboxReadiness: requestWindowsSandboxReadiness,
    windowsSandboxSetupStart: requestWindowsSandboxSetupStart,
    setGoal,
    setGoalStatus,
    getGoal,
    clearGoal,
    updateThreadSettings,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies CodexAdapterShape;
});

// NOTE: the old `CodexAdapterLive` / `makeCodexAdapterLive` singleton Layer
// exports have been removed as part of the per-instance-driver refactor.
// `makeCodexAdapter(codexConfig, options?)` is now invoked directly by
// `CodexDriver.create()` for each configured instance; downstream consumers
// (server bootstrap, integration harness, this module's tests) will be
// migrated to the registry in a follow-up pass.
