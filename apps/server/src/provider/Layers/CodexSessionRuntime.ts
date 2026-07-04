// @effect-diagnostics preferSchemaOverJson:off
import {
  ApprovalRequestId,
  DEFAULT_MODEL,
  EventId,
  OrchestrationListThreadTurnItemsInput,
  OrchestrationListThreadTurnItemsResult,
  OrchestrationListThreadTurnsInput,
  OrchestrationListThreadTurnsResult,
  ProviderDriverKind,
  ProviderItemId,
  type ProviderInstanceId,
  type OrchestrationGoal,
  type OrchestrationGoalStatus,
  type ProviderApprovalDecision,
  type ProviderEvent,
  type ProviderInteractionMode,
  type ProviderRequestKind,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderTurnSteerResult,
  type ProviderUserInputAnswers,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { RotatingFileSink } from "@t3tools/shared/logging";
import { normalizeModelSlug } from "@t3tools/shared/model";
import {
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME,
  COMMERCIAL_ENGINE_PROVIDER_ID,
  COMMERCIAL_ENGINE_WIRE_API,
  resolveCommercialEngineGatewayBaseUrl,
} from "@t3tools/shared/commercialEngine";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SchemaIssue from "effect/SchemaIssue";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  buildCodexInitializeParams,
  enableCodexPluginExperimentalFeatures,
} from "./CodexProvider.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import {
  resolveBundledEngineConfig,
  buildBundledSpawnArgs,
  buildSystemSpawnArgs,
  buildCodexProcessEnv,
  type BundledEngineResolvedConfig,
} from "../BundledEngineConfig.ts";
import {
  buildT3BrowserDynamicTools,
  buildT3BrowserExternalDynamicTools,
  T3_BROWSER_EXTERNAL_TOOL_NAMESPACE,
  T3_BROWSER_TOOL_NAMESPACE,
} from "../browserTools.ts";
import {
  buildT3ComputerDynamicTools,
  isT3ComputerInputToolName,
  T3_COMPUTER_CONFIRMATION_REQUIRED_PREFIX,
  T3_COMPUTER_TOOL_NAMESPACE,
} from "../computerTools.ts";
import * as BrowserToolService from "../Services/BrowserToolService.ts";
import * as BrowserExternalToolService from "../Services/BrowserExternalToolService.ts";
import * as ComputerToolService from "../Services/ComputerToolService.ts";
const decodeV2TurnStartResponse = Schema.decodeUnknownEffect(EffectCodexSchema.V2TurnStartResponse);
const decodeV2TurnSteerParams = Schema.decodeUnknownEffect(EffectCodexSchema.V2TurnSteerParams);
const decodeV2TurnSteerResponse = Schema.decodeUnknownEffect(EffectCodexSchema.V2TurnSteerResponse);
const decodeV2ThreadGoalSetResponse = Schema.decodeUnknownEffect(
  EffectCodexSchema.V2ThreadGoalSetResponse,
);
const decodeV2ThreadGoalGetResponse = Schema.decodeUnknownEffect(
  EffectCodexSchema.V2ThreadGoalGetResponse,
);
const decodeV2ThreadGoalClearResponse = Schema.decodeUnknownEffect(
  EffectCodexSchema.V2ThreadGoalClearResponse,
);

const PROVIDER = ProviderDriverKind.make("codex");

const ANSI_ESCAPE_CHAR = String.fromCharCode(27);
const ANSI_ESCAPE_REGEX = new RegExp(`${ANSI_ESCAPE_CHAR}\\[[0-9;]*m`, "g");
const CODEX_STDERR_LOG_REGEX =
  /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+\S+:\s+(.*)$/;
const BENIGN_ERROR_LOG_SNIPPETS = [
  "state db missing rollout path for thread",
  "state db record_discrepancy: find_thread_path_by_id_str_in_subdir, falling_back",
];
const CODEX_APP_SERVER_FORCE_KILL_AFTER = "2 seconds" as const;
const T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX = "T3_BROWSER_CONFIRMATION_REQUIRED:";
const RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS = [
  "not found",
  "missing thread",
  "no such thread",
  "unknown thread",
  "does not exist",
];
const CODEX_RUNTIME_EVENT_QUEUE_CAPACITY = 2048;
const CODEX_SERVER_NOTIFICATION_QUEUE_CAPACITY = 2048;

export const CodexResumeCursorSchema = Schema.Struct({
  threadId: Schema.String,
});
const CodexUserInputAnswerObject = Schema.Struct({
  answers: Schema.Array(Schema.String),
});
const isCodexResumeCursorSchema = Schema.is(CodexResumeCursorSchema);
const isCodexUserInputAnswerObject = Schema.is(CodexUserInputAnswerObject);

// TODO: Verify `packages/effect-codex-app-server/scripts/generate.ts` so the generated
// `V2TurnStartParams` schema includes `collaborationMode` directly.
const CodexTurnStartParamsWithCollaborationMode = EffectCodexSchema.V2TurnStartParams.pipe(
  Schema.fieldsAssign({
    collaborationMode: Schema.optionalKey(EffectCodexSchema.V2TurnStartParams__CollaborationMode),
  }),
);
const decodeCodexTurnStartParamsWithCollaborationMode = Schema.decodeUnknownEffect(
  CodexTurnStartParamsWithCollaborationMode,
);

export type CodexTurnStartParamsWithCollaborationMode =
  typeof CodexTurnStartParamsWithCollaborationMode.Type;
const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

export type CodexResumeCursor = typeof CodexResumeCursorSchema.Type;
type CodexServiceTier = NonNullable<EffectCodexSchema.V2ThreadStartParams["serviceTier"]>;
type T3DynamicTools = ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec>;
type ThreadStartParamsWithDynamicTools = EffectCodexSchema.V2ThreadStartParams & {
  readonly dynamicTools: T3DynamicTools;
};
type CodexThreadConfigOverrides = NonNullable<EffectCodexSchema.V2ThreadStartParams["config"]>;
type CodexThreadItem =
  | EffectCodexSchema.V2ThreadReadResponse["thread"]["turns"][number]["items"][number]
  | EffectCodexSchema.V2ThreadRollbackResponse["thread"]["turns"][number]["items"][number];

export interface CodexSessionRuntimeOptions {
  readonly threadId: ThreadId;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly model?: string;
  readonly serviceTier?: CodexServiceTier | undefined;
  readonly personality?: EffectCodexSchema.V2ThreadStartParams__Personality | null;
  readonly resumeCursor?: CodexResumeCursor;
  readonly prewarmedChild?: ChildProcessSpawner.ChildProcessHandle;
  readonly jsonRpcLogPath?: string;
}

export interface CodexSessionRuntimeSendTurnInput {
  readonly input?: string;
  readonly attachments?: ReadonlyArray<{
    readonly type: "image";
    readonly url: string;
  }>;
  readonly model?: string;
  readonly serviceTier?: CodexServiceTier | undefined;
  readonly effort?: EffectCodexSchema.V2TurnStartParams__ReasoningEffort | undefined;
  readonly interactionMode?: ProviderInteractionMode;
  readonly personality?: EffectCodexSchema.V2TurnStartParams__Personality | null;
}

export interface CodexSessionRuntimeSteerTurnInput {
  readonly expectedTurnId: TurnId;
  readonly input?: string;
  readonly attachments?: ReadonlyArray<{
    readonly type: "image";
    readonly url: string;
  }>;
}

export interface CodexSessionRuntimeUpdateSettingsInput {
  readonly cwd?: string | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly model?: string | null | undefined;
  readonly serviceTier?: CodexServiceTier | null | undefined;
  readonly effort?: EffectCodexSchema.V2ThreadSettingsUpdateParams__ReasoningEffort | null;
  readonly approvalPolicy?: EffectCodexSchema.V2ThreadSettingsUpdateParams__AskForApproval | null;
  readonly sandboxPolicy?: EffectCodexSchema.V2ThreadSettingsUpdateParams__SandboxPolicy | null;
  readonly permissions?: string | null;
  readonly personality?: EffectCodexSchema.V2ThreadSettingsUpdateParams__Personality | null;
  readonly summary?: EffectCodexSchema.V2ThreadSettingsUpdateParams__ReasoningSummary | null;
}

export interface CodexThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<CodexThreadItem>;
}

export interface CodexThreadSnapshot {
  readonly threadId: string;
  readonly turns: ReadonlyArray<CodexThreadTurnSnapshot>;
}

export interface CodexSessionRuntimeShape {
  readonly start: () => Effect.Effect<ProviderSession, CodexSessionRuntimeError>;
  readonly getSession: Effect.Effect<ProviderSession>;
  readonly sendTurn: (
    input: CodexSessionRuntimeSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, CodexSessionRuntimeError>;
  readonly steerTurn: (
    input: CodexSessionRuntimeSteerTurnInput,
  ) => Effect.Effect<ProviderTurnSteerResult, CodexSessionRuntimeError>;
  readonly updateThreadSettings: (
    input: CodexSessionRuntimeUpdateSettingsInput,
  ) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly interruptTurn: (turnId?: TurnId) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly readThread: Effect.Effect<CodexThreadSnapshot, CodexSessionRuntimeError>;
  readonly listThreadTurns: (
    input: Omit<OrchestrationListThreadTurnsInput, "threadId">,
  ) => Effect.Effect<OrchestrationListThreadTurnsResult, CodexSessionRuntimeError>;
  readonly listThreadTurnItems: (
    input: Omit<OrchestrationListThreadTurnItemsInput, "threadId">,
  ) => Effect.Effect<OrchestrationListThreadTurnItemsResult, CodexSessionRuntimeError>;
  readonly rollbackThread: (
    numTurns: number,
  ) => Effect.Effect<CodexThreadSnapshot, CodexSessionRuntimeError>;
  readonly respondToRequest: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly respondToUserInput: (
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly setGoal: (input: {
    readonly objective: string;
    readonly status?: OrchestrationGoalStatus;
  }) => Effect.Effect<OrchestrationGoal, CodexSessionRuntimeError>;
  readonly setGoalStatus: (
    status: OrchestrationGoalStatus,
  ) => Effect.Effect<OrchestrationGoal, CodexSessionRuntimeError>;
  readonly getGoal: Effect.Effect<OrchestrationGoal | null, CodexSessionRuntimeError>;
  readonly clearGoal: Effect.Effect<boolean, CodexSessionRuntimeError>;
  readonly windowsSandboxReadiness?: Effect.Effect<
    EffectCodexSchema.V2WindowsSandboxReadinessResponse,
    CodexSessionRuntimeError
  >;
  readonly windowsSandboxSetupStart?: (input: {
    readonly mode: EffectCodexSchema.V2WindowsSandboxSetupStartParams__WindowsSandboxSetupMode;
  }) => Effect.Effect<
    EffectCodexSchema.V2WindowsSandboxSetupStartResponse,
    CodexSessionRuntimeError
  >;
  readonly events: Stream.Stream<ProviderEvent, never>;
  readonly close: Effect.Effect<void>;
}

export type CodexSessionRuntimeError =
  | CodexErrors.CodexAppServerError
  | CodexSessionRuntimePendingApprovalNotFoundError
  | CodexSessionRuntimePendingUserInputNotFoundError
  | CodexSessionRuntimeInvalidUserInputAnswersError
  | CodexSessionRuntimeThreadIdMissingError;

export class CodexSessionRuntimePendingApprovalNotFoundError extends Schema.TaggedErrorClass<CodexSessionRuntimePendingApprovalNotFoundError>()(
  "CodexSessionRuntimePendingApprovalNotFoundError",
  {
    requestId: Schema.String,
  },
) {
  override get message(): string {
    return `Unknown pending Codex approval request: ${this.requestId}`;
  }
}

export class CodexSessionRuntimePendingUserInputNotFoundError extends Schema.TaggedErrorClass<CodexSessionRuntimePendingUserInputNotFoundError>()(
  "CodexSessionRuntimePendingUserInputNotFoundError",
  {
    requestId: Schema.String,
  },
) {
  override get message(): string {
    return `Unknown pending Codex user input request: ${this.requestId}`;
  }
}

export class CodexSessionRuntimeInvalidUserInputAnswersError extends Schema.TaggedErrorClass<CodexSessionRuntimeInvalidUserInputAnswersError>()(
  "CodexSessionRuntimeInvalidUserInputAnswersError",
  {
    questionId: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid Codex user input answers for question '${this.questionId}'`;
  }
}

export class CodexSessionRuntimeThreadIdMissingError extends Schema.TaggedErrorClass<CodexSessionRuntimeThreadIdMissingError>()(
  "CodexSessionRuntimeThreadIdMissingError",
  {
    threadId: Schema.String,
  },
) {
  override get message(): string {
    return `Codex session is missing a provider thread id for ${this.threadId}`;
  }
}

interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly jsonRpcId: string;
  readonly requestKind: ProviderRequestKind;
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface ApprovalCorrelation {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: ProviderRequestKind;
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
}

interface PendingUserInput {
  readonly requestId: ApprovalRequestId;
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

type CodexServerNotification = {
  readonly [M in CodexRpc.ServerNotificationMethod]: {
    readonly method: M;
    readonly params: CodexRpc.ServerNotificationParamsByMethod[M];
  };
}[CodexRpc.ServerNotificationMethod];

function makeCodexServerNotification<M extends CodexRpc.ServerNotificationMethod>(
  method: M,
  params: CodexRpc.ServerNotificationParamsByMethod[M],
): CodexServerNotification {
  return { method, params } as CodexServerNotification;
}

function normalizeCodexModelSlug(
  model: string | undefined | null,
  preferredId?: string,
): string | undefined {
  const normalized = normalizeModelSlug(model);
  if (!normalized) {
    return undefined;
  }
  if (preferredId?.endsWith("-codex") && preferredId !== normalized) {
    return preferredId;
  }
  return normalized;
}

function readResumeCursorThreadId(
  resumeCursor: ProviderSession["resumeCursor"],
): string | undefined {
  return isCodexResumeCursorSchema(resumeCursor) ? resumeCursor.threadId : undefined;
}

function runtimeModeToThreadConfig(input: RuntimeMode): {
  readonly approvalPolicy: EffectCodexSchema.V2ThreadStartParams__AskForApproval;
  readonly approvalsReviewer: EffectCodexSchema.V2ThreadStartParams__ApprovalsReviewer;
  readonly sandbox: EffectCodexSchema.V2ThreadStartParams__SandboxMode;
} {
  switch (input) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandbox: "read-only",
      };
    case "auto-accept-edits":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
      };
    case "full-access":
    default:
      return {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: "danger-full-access",
      };
  }
}

function buildThreadStartParams(input: {
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly model: string | undefined;
  readonly modelProvider: string | undefined;
  readonly configOverrides: CodexThreadConfigOverrides | undefined;
  readonly serviceTier: CodexServiceTier | undefined;
  readonly personality: EffectCodexSchema.V2ThreadStartParams__Personality | null | undefined;
}): ThreadStartParamsWithDynamicTools {
  const config = runtimeModeToThreadConfig(input.runtimeMode);
  return {
    cwd: input.cwd,
    approvalPolicy: config.approvalPolicy,
    approvalsReviewer: config.approvalsReviewer,
    sandbox: config.sandbox,
    dynamicTools: [
      ...buildT3BrowserDynamicTools(),
      ...buildT3BrowserExternalDynamicTools(),
      ...buildT3ComputerDynamicTools(),
    ],
    ...(input.model ? { model: input.model } : {}),
    ...(input.modelProvider ? { modelProvider: input.modelProvider } : {}),
    ...(input.configOverrides ? { config: input.configOverrides } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    ...(input.personality !== undefined ? { personality: input.personality } : {}),
  };
}

function buildCommercialThreadConfigOverrides(
  environment: NodeJS.ProcessEnv,
): CodexThreadConfigOverrides {
  return {
    model_provider: COMMERCIAL_ENGINE_PROVIDER_ID,
    [`model_providers.${COMMERCIAL_ENGINE_PROVIDER_ID}`]: {
      name: COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME,
      base_url: resolveCommercialEngineGatewayBaseUrl(environment),
      env_key: COMMERCIAL_ENGINE_IDE_JWT_ENV,
      wire_api: COMMERCIAL_ENGINE_WIRE_API,
      requires_openai_auth: false,
      supports_websockets: false,
    },
  };
}

function runtimeModeToTurnSandboxPolicy(
  input: RuntimeMode,
): EffectCodexSchema.V2TurnStartParams__SandboxPolicy {
  switch (input) {
    case "approval-required":
      return {
        type: "readOnly",
      };
    case "auto-accept-edits":
      return {
        type: "workspaceWrite",
      };
    case "full-access":
    default:
      return {
        type: "dangerFullAccess",
      };
  }
}

function runtimeModeToThreadSettingsSandboxPolicy(
  input: RuntimeMode,
): EffectCodexSchema.V2ThreadSettingsUpdateParams__SandboxPolicy {
  return runtimeModeToTurnSandboxPolicy(
    input,
  ) as EffectCodexSchema.V2ThreadSettingsUpdateParams__SandboxPolicy;
}

export function buildThreadSettingsUpdateParams(input: {
  readonly threadId: string;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly cwd?: string | undefined;
  readonly model?: string | null | undefined;
  readonly serviceTier?: CodexServiceTier | null | undefined;
  readonly effort?: EffectCodexSchema.V2ThreadSettingsUpdateParams__ReasoningEffort | null;
  readonly approvalPolicy?: EffectCodexSchema.V2ThreadSettingsUpdateParams__AskForApproval | null;
  readonly sandboxPolicy?: EffectCodexSchema.V2ThreadSettingsUpdateParams__SandboxPolicy | null;
  readonly permissions?: string | null;
  readonly personality?: EffectCodexSchema.V2ThreadSettingsUpdateParams__Personality | null;
  readonly summary?: EffectCodexSchema.V2ThreadSettingsUpdateParams__ReasoningSummary | null;
}): EffectCodexSchema.V2ThreadSettingsUpdateParams {
  const config = input.runtimeMode ? runtimeModeToThreadConfig(input.runtimeMode) : undefined;
  const permissionsSpecified = input.permissions !== undefined;
  return {
    threadId: input.threadId,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.approvalPolicy !== undefined
      ? { approvalPolicy: input.approvalPolicy }
      : config
        ? { approvalPolicy: config.approvalPolicy }
        : {}),
    ...(config ? { approvalsReviewer: config.approvalsReviewer } : {}),
    ...(permissionsSpecified
      ? { permissions: input.permissions }
      : input.sandboxPolicy !== undefined
        ? { sandboxPolicy: input.sandboxPolicy }
        : config && input.runtimeMode
          ? { sandboxPolicy: runtimeModeToThreadSettingsSandboxPolicy(input.runtimeMode) }
          : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
    ...(input.effort !== undefined ? { effort: input.effort } : {}),
    ...(input.personality !== undefined ? { personality: input.personality } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
  };
}

function buildCodexCollaborationMode(input: {
  readonly interactionMode?: ProviderInteractionMode;
  readonly model?: string;
  readonly effort?: EffectCodexSchema.V2TurnStartParams__ReasoningEffort;
}): EffectCodexSchema.V2TurnStartParams__CollaborationMode | undefined {
  if (input.interactionMode === undefined) {
    return undefined;
  }
  const model = normalizeCodexModelSlug(input.model) ?? DEFAULT_MODEL;
  return {
    mode: input.interactionMode,
    settings: {
      model,
      reasoning_effort: input.effort ?? "medium",
      developer_instructions:
        input.interactionMode === "plan"
          ? CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS
          : CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
    },
  };
}

export function buildTurnStartParams(input: {
  readonly threadId: string;
  readonly runtimeMode: RuntimeMode;
  readonly prompt?: string;
  readonly attachments?: ReadonlyArray<{
    readonly type: "image";
    readonly url: string;
  }>;
  readonly model?: string;
  readonly serviceTier?: CodexServiceTier;
  readonly effort?: EffectCodexSchema.V2TurnStartParams__ReasoningEffort;
  readonly interactionMode?: ProviderInteractionMode;
  readonly personality?: EffectCodexSchema.V2TurnStartParams__Personality | null;
}): Effect.Effect<
  CodexTurnStartParamsWithCollaborationMode,
  CodexErrors.CodexAppServerProtocolParseError
> {
  const turnInput = buildCodexTurnInput(input);

  const config = runtimeModeToThreadConfig(input.runtimeMode);
  const collaborationMode = buildCodexCollaborationMode({
    ...(input.interactionMode ? { interactionMode: input.interactionMode } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  });

  return decodeCodexTurnStartParamsWithCollaborationMode({
    threadId: input.threadId,
    input: turnInput,
    approvalPolicy: config.approvalPolicy,
    approvalsReviewer: config.approvalsReviewer,
    sandboxPolicy: runtimeModeToTurnSandboxPolicy(input.runtimeMode),
    ...(input.model ? { model: input.model } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.personality !== undefined ? { personality: input.personality } : {}),
    ...(collaborationMode ? { collaborationMode } : {}),
  }).pipe(
    Effect.mapError((error) => toProtocolParseError("Invalid turn/start request payload", error)),
  );
}

function buildCodexTurnInput(input: {
  readonly prompt?: string;
  readonly attachments?: ReadonlyArray<{
    readonly type: "image";
    readonly url: string;
  }>;
}): Array<EffectCodexSchema.V2TurnStartParams__UserInput> {
  const turnInput: Array<EffectCodexSchema.V2TurnStartParams__UserInput> = [];
  if (input.prompt) {
    turnInput.push({
      type: "text",
      text: input.prompt,
    });
  }
  for (const attachment of input.attachments ?? []) {
    turnInput.push(attachment);
  }
  return turnInput;
}

function classifyCodexStderrLine(rawLine: string): { readonly message: string } | null {
  const line = rawLine.replaceAll(ANSI_ESCAPE_REGEX, "").trim();
  if (!line) {
    return null;
  }

  const match = line.match(CODEX_STDERR_LOG_REGEX);
  if (match) {
    const level = match[1];
    if (level && level !== "ERROR") {
      return null;
    }
    if (BENIGN_ERROR_LOG_SNIPPETS.some((snippet) => line.includes(snippet))) {
      return null;
    }
  }

  return { message: line };
}

export function isRecoverableThreadResumeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!message.includes("thread")) {
    return false;
  }
  return RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
}

type CodexThreadOpenResponse =
  | CodexRpc.ClientRequestResponsesByMethod["thread/start"]
  | CodexRpc.ClientRequestResponsesByMethod["thread/resume"];

type CodexThreadOpenMethod = "thread/start" | "thread/resume" | "thread/settings/update";

interface CodexThreadOpenClient {
  readonly request: <M extends CodexThreadOpenMethod>(
    method: M,
    payload: CodexRpc.ClientRequestParamsByMethod[M],
  ) => Effect.Effect<CodexRpc.ClientRequestResponsesByMethod[M], CodexErrors.CodexAppServerError>;
}

export const spawnCodexAppServerChild = (input: {
  readonly binaryPath: string;
  readonly homePath: string | undefined;
  readonly environment: NodeJS.ProcessEnv | undefined;
  readonly cwd: string;
}): Effect.Effect<
  ChildProcessSpawner.ChildProcessHandle,
  CodexErrors.CodexAppServerSpawnError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeScope = yield* Scope.Scope;
    const resolvedHomePath = input.homePath ? expandHomePath(input.homePath) : undefined;
    const baseEnv = input.environment ?? process.env;
    const bundledConfig = resolveBundledEngineConfig(baseEnv);
    const effectiveBinaryPath = bundledConfig?.binaryPath ?? input.binaryPath;
    const spawnArgs = bundledConfig ? buildBundledSpawnArgs(bundledConfig) : buildSystemSpawnArgs();
    const env = buildCodexProcessEnv({
      baseEnv,
      resolvedHomePath,
      bundledConfig,
    });

    return yield* spawner
      .spawn(
        ChildProcess.make(effectiveBinaryPath, [...spawnArgs], {
          cwd: input.cwd,
          env,
          shell: process.platform === "win32",
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError(
          (cause) =>
            new CodexErrors.CodexAppServerSpawnError({
              command: `${effectiveBinaryPath} ${spawnArgs.join(" ")}`,
              cause,
            }),
        ),
      );
  });

export const openCodexThread = (input: {
  readonly client: CodexThreadOpenClient;
  readonly threadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly cwd: string;
  readonly requestedModel: string | undefined;
  readonly requestedModelProvider?: string | undefined;
  readonly requestedConfigOverrides?: CodexThreadConfigOverrides | undefined;
  readonly serviceTier: CodexServiceTier | undefined;
  readonly personality: EffectCodexSchema.V2ThreadStartParams__Personality | null | undefined;
  readonly resumeThreadId: string | undefined;
}): Effect.Effect<CodexThreadOpenResponse, CodexErrors.CodexAppServerError> => {
  const resumeThreadId = input.resumeThreadId;
  const startParams = buildThreadStartParams({
    cwd: input.cwd,
    runtimeMode: input.runtimeMode,
    model: input.requestedModel,
    modelProvider: input.requestedModelProvider,
    configOverrides: input.requestedConfigOverrides,
    serviceTier: input.serviceTier,
    personality: input.personality,
  });
  const syncThreadSettings = (opened: CodexThreadOpenResponse) =>
    input.client
      .request(
        "thread/settings/update",
        buildThreadSettingsUpdateParams({
          threadId: opened.thread.id,
          cwd: input.cwd,
          runtimeMode: input.runtimeMode,
          model: input.requestedModel,
          serviceTier: input.serviceTier,
          ...(input.personality !== undefined ? { personality: input.personality } : {}),
        }),
      )
      .pipe(Effect.as(opened));

  if (resumeThreadId === undefined) {
    return input.client
      .request("thread/start", startParams)
      .pipe(Effect.flatMap(syncThreadSettings));
  }

  return input.client
    .request("thread/resume", {
      threadId: resumeThreadId,
      ...startParams,
    })
    .pipe(
      Effect.catchIf(isRecoverableThreadResumeError, (error) =>
        Effect.logWarning("codex app-server thread resume fell back to fresh start", {
          threadId: input.threadId,
          requestedRuntimeMode: input.runtimeMode,
          resumeThreadId,
          recoverable: true,
          cause: error.message,
        }).pipe(Effect.andThen(input.client.request("thread/start", startParams))),
      ),
      Effect.flatMap(syncThreadSettings),
    );
};

function readNotificationThreadId(notification: CodexServerNotification): string | undefined {
  switch (notification.method) {
    case "thread/started":
      return notification.params.thread.id;
    case "error":
    case "thread/status/changed":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/closed":
    case "thread/name/updated":
    case "thread/goal/updated":
    case "thread/goal/cleared":
    case "thread/settings/updated":
    case "thread/tokenUsage/updated":
    case "turn/started":
    case "hook/started":
    case "turn/completed":
    case "hook/completed":
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "item/started":
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
    case "item/completed":
    case "rawResponseItem/completed":
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "item/fileChange/patchUpdated":
    case "serverRequest/resolved":
    case "item/mcpToolCall/progress":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
    case "thread/compacted":
    case "thread/realtime/started":
    case "thread/realtime/itemAdded":
    case "thread/realtime/transcript/delta":
    case "thread/realtime/transcript/done":
    case "thread/realtime/outputAudio/delta":
    case "thread/realtime/sdp":
    case "thread/realtime/error":
    case "thread/realtime/closed":
      return notification.params.threadId;
    default:
      return undefined;
  }
}

function readRouteFields(notification: CodexServerNotification): {
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
} {
  switch (notification.method) {
    case "thread/started":
      return {
        turnId: undefined,
        itemId: undefined,
      };
    case "turn/started":
    case "turn/completed":
      return {
        turnId: TurnId.make(notification.params.turn.id),
        itemId: undefined,
      };
    case "error":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: undefined,
      };
    case "turn/diff/updated":
    case "turn/plan/updated":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: undefined,
      };
    case "serverRequest/resolved":
      return {
        turnId: undefined,
        itemId: undefined,
      };
    case "item/started":
    case "item/completed":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: ProviderItemId.make(notification.params.item.id),
      };
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "item/fileChange/patchUpdated":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: ProviderItemId.make(notification.params.itemId),
      };
    default:
      return {
        turnId: undefined,
        itemId: undefined,
      };
  }
}

function rememberCollabReceiverTurns(
  collabReceiverTurns: Map<string, TurnId>,
  notification: CodexServerNotification,
  parentTurnId: TurnId | undefined,
): void {
  if (!parentTurnId) {
    return;
  }

  if (notification.method !== "item/started" && notification.method !== "item/completed") {
    return;
  }

  if (notification.params.item.type !== "collabAgentToolCall") {
    return;
  }

  for (const receiverThreadId of notification.params.item.receiverThreadIds) {
    collabReceiverTurns.set(receiverThreadId, parentTurnId);
  }
}

function shouldSuppressChildConversationNotification(
  method: CodexRpc.ServerNotificationMethod,
): boolean {
  return (
    method === "thread/started" ||
    method === "thread/status/changed" ||
    method === "thread/archived" ||
    method === "thread/unarchived" ||
    method === "thread/closed" ||
    method === "thread/compacted" ||
    method === "thread/name/updated" ||
    method === "thread/goal/updated" ||
    method === "thread/goal/cleared" ||
    method === "thread/settings/updated" ||
    method === "thread/tokenUsage/updated" ||
    method === "turn/started" ||
    method === "turn/completed" ||
    method === "turn/plan/updated" ||
    method === "item/plan/delta"
  );
}

function toCodexUserInputAnswer(
  questionId: string,
  value: ProviderUserInputAnswers[string],
): Effect.Effect<
  EffectCodexSchema.ToolRequestUserInputResponse__ToolRequestUserInputAnswer,
  CodexSessionRuntimeInvalidUserInputAnswersError
> {
  if (typeof value === "string") {
    return Effect.succeed({ answers: [value] });
  }
  if (Array.isArray(value)) {
    const answers = value.filter((entry): entry is string => typeof entry === "string");
    return Effect.succeed({ answers });
  }
  if (isCodexUserInputAnswerObject(value)) {
    return Effect.succeed({ answers: value.answers });
  }
  return Effect.fail(new CodexSessionRuntimeInvalidUserInputAnswersError({ questionId }));
}

function toCodexUserInputAnswers(
  answers: ProviderUserInputAnswers,
): Effect.Effect<
  EffectCodexSchema.ToolRequestUserInputResponse["answers"],
  CodexSessionRuntimeInvalidUserInputAnswersError
> {
  return Effect.forEach(
    Object.entries(answers),
    ([questionId, value]) =>
      toCodexUserInputAnswer(questionId, value).pipe(
        Effect.map((answer) => [questionId, answer] as const),
      ),
    { concurrency: 1 },
  ).pipe(Effect.map((entries) => Object.fromEntries(entries)));
}

function toProtocolParseError(
  detail: string,
  cause: Schema.SchemaError,
): CodexErrors.CodexAppServerProtocolParseError {
  return new CodexErrors.CodexAppServerProtocolParseError({
    detail: `${detail}: ${formatSchemaIssue(cause.issue)}`,
    cause,
  });
}

function dynamicTextResponse(
  text: string,
  success: boolean,
): EffectCodexSchema.DynamicToolCallResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function readBrowserConfirmationMessage(
  response: EffectCodexSchema.DynamicToolCallResponse,
): string | undefined {
  if (response.success) {
    return undefined;
  }
  for (const item of response.contentItems) {
    if (item.type !== "inputText") {
      continue;
    }
    const index = item.text.indexOf(T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX);
    if (index >= 0) {
      return item.text.slice(index + T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX.length).trim();
    }
  }
  return undefined;
}

function readComputerConfirmationMessage(
  response: EffectCodexSchema.DynamicToolCallResponse,
): string | undefined {
  if (response.success) {
    return undefined;
  }
  for (const item of response.contentItems) {
    if (item.type !== "inputText") {
      continue;
    }
    const index = item.text.indexOf(T3_COMPUTER_CONFIRMATION_REQUIRED_PREFIX);
    if (index >= 0) {
      return item.text.slice(index + T3_COMPUTER_CONFIRMATION_REQUIRED_PREFIX.length).trim();
    }
  }
  return undefined;
}

function withBrowserUserConfirmation(
  payload: EffectCodexSchema.DynamicToolCallParams,
  options: { readonly alwaysAllowHost?: boolean } = {},
): EffectCodexSchema.DynamicToolCallParams {
  const args =
    payload.arguments && typeof payload.arguments === "object" && !Array.isArray(payload.arguments)
      ? payload.arguments
      : {};
  return {
    ...payload,
    arguments: {
      ...args,
      userConfirmed: true,
      t3UserConfirmed: true,
      ...(options.alwaysAllowHost ? { userAlwaysAllowHost: true } : {}),
    },
  };
}

function withComputerRuntimeContext(
  payload: EffectCodexSchema.DynamicToolCallParams,
  runtimeMode: RuntimeMode,
): EffectCodexSchema.DynamicToolCallParams {
  const args =
    payload.arguments && typeof payload.arguments === "object" && !Array.isArray(payload.arguments)
      ? payload.arguments
      : {};
  return {
    ...payload,
    arguments: {
      ...args,
      runtimeMode,
    },
  };
}

function withComputerUserConfirmation(
  payload: EffectCodexSchema.DynamicToolCallParams,
  runtimeMode: RuntimeMode,
  options: { readonly alwaysAllowApp?: boolean } = {},
): EffectCodexSchema.DynamicToolCallParams {
  const args =
    payload.arguments && typeof payload.arguments === "object" && !Array.isArray(payload.arguments)
      ? payload.arguments
      : {};
  return {
    ...payload,
    arguments: {
      ...args,
      runtimeMode,
      userConfirmed: true,
      ...(options.alwaysAllowApp ? { userAlwaysAllowApp: true } : {}),
    },
  };
}

function userInputAnswerIncludes(value: ProviderUserInputAnswers[string], label: string): boolean {
  return (
    value === label ||
    (Array.isArray(value) && value.includes(label)) ||
    (isCodexUserInputAnswerObject(value) && value.answers.includes(label))
  );
}

function isAcceptedUserInputAnswer(value: ProviderUserInputAnswers[string]): boolean {
  return userInputAnswerIncludes(value, "Accept") || userInputAnswerIncludes(value, "Always allow");
}

function currentProviderThreadId(session: ProviderSession): string | undefined {
  return readResumeCursorThreadId(session.resumeCursor);
}

function updateSession(
  sessionRef: Ref.Ref<ProviderSession>,
  updates: Partial<ProviderSession>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* Ref.update(sessionRef, (session) => ({
      ...session,
      ...updates,
      updatedAt,
    }));
  });
}

function parseThreadSnapshot(
  response: EffectCodexSchema.V2ThreadReadResponse | EffectCodexSchema.V2ThreadRollbackResponse,
): CodexThreadSnapshot {
  return {
    threadId: response.thread.id,
    turns: response.thread.turns.map((turn) => ({
      id: TurnId.make(turn.id),
      items: turn.items,
    })),
  };
}

function parseThreadTurnsPage(
  response: EffectCodexSchema.V2ThreadTurnsListResponse,
): OrchestrationListThreadTurnsResult {
  return {
    data: response.data.map((turn) => ({
      id: TurnId.make(turn.id),
      status: turn.status,
      itemsView: turn.itemsView ?? "full",
      items: turn.items,
      ...(turn.startedAt !== undefined ? { startedAt: turn.startedAt } : {}),
      ...(turn.completedAt !== undefined ? { completedAt: turn.completedAt } : {}),
      ...(turn.durationMs !== undefined ? { durationMs: turn.durationMs } : {}),
      ...(turn.error !== undefined ? { error: turn.error } : {}),
    })),
    ...(response.nextCursor !== undefined ? { nextCursor: response.nextCursor } : {}),
    ...(response.backwardsCursor !== undefined
      ? { backwardsCursor: response.backwardsCursor }
      : {}),
  };
}

function parseThreadTurnItemsPage(
  response: EffectCodexSchema.V2ThreadTurnsItemsListResponse,
): OrchestrationListThreadTurnItemsResult {
  return {
    data: response.data,
    ...(response.nextCursor !== undefined ? { nextCursor: response.nextCursor } : {}),
    ...(response.backwardsCursor !== undefined
      ? { backwardsCursor: response.backwardsCursor }
      : {}),
  };
}

function toOrchestrationGoalStatus(
  status:
    | EffectCodexSchema.V2ThreadGoalGetResponse__ThreadGoalStatus
    | EffectCodexSchema.V2ThreadGoalSetResponse__ThreadGoalStatus
    | EffectCodexSchema.V2ThreadGoalUpdatedNotification__ThreadGoalStatus,
): OrchestrationGoalStatus {
  return status;
}

function toOrchestrationGoal(
  goal:
    | EffectCodexSchema.V2ThreadGoalGetResponse__ThreadGoal
    | EffectCodexSchema.V2ThreadGoalSetResponse__ThreadGoal
    | EffectCodexSchema.V2ThreadGoalUpdatedNotification__ThreadGoal,
  updatedAt: string,
): OrchestrationGoal {
  return {
    objective: goal.objective,
    status: toOrchestrationGoalStatus(goal.status),
    updatedAt,
    startedAt: updatedAt,
    activeSince: goal.status === "active" ? updatedAt : null,
    elapsedMs: 0,
    completedAt: goal.status === "complete" ? updatedAt : null,
  };
}

export const makeCodexSessionRuntime = (
  options: CodexSessionRuntimeOptions,
): Effect.Effect<
  CodexSessionRuntimeShape,
  CodexErrors.CodexAppServerError,
  | BrowserToolService.BrowserToolService
  | BrowserExternalToolService.BrowserExternalToolService
  | ComputerToolService.ComputerToolService
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const runtimeScope = yield* Scope.Scope;
    const events = yield* Queue.bounded<ProviderEvent>(CODEX_RUNTIME_EVENT_QUEUE_CAPACITY);
    const pendingApprovalsRef = yield* Ref.make(new Map<ApprovalRequestId, PendingApproval>());
    const approvalCorrelationsRef = yield* Ref.make(new Map<string, ApprovalCorrelation>());
    const pendingUserInputsRef = yield* Ref.make(new Map<ApprovalRequestId, PendingUserInput>());
    const collabReceiverTurnsRef = yield* Ref.make(new Map<string, TurnId>());
    const closedRef = yield* Ref.make(false);

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // `~` is not shell-expanded when env vars are set via
    // `child_process.spawn`; `expandHomePath` lets a configured
    // `CODEX_HOME=~/.codex_work` reach codex as an absolute path.
    const resolvedHomePath = options.homePath ? expandHomePath(options.homePath) : undefined;
    const baseEnv = options.environment ?? process.env;
    const bundledConfig = resolveBundledEngineConfig(baseEnv);
    const bundledModelProvider = bundledConfig ? COMMERCIAL_ENGINE_PROVIDER_ID : undefined;
    const bundledConfigOverrides = bundledConfig
      ? buildCommercialThreadConfigOverrides(baseEnv)
      : undefined;
    const effectiveBinaryPath = bundledConfig?.binaryPath ?? options.binaryPath;
    const spawnArgs = bundledConfig ? buildBundledSpawnArgs(bundledConfig) : buildSystemSpawnArgs();
    const env = buildCodexProcessEnv({
      baseEnv,
      resolvedHomePath,
      bundledConfig,
    });
    const browserTools = yield* BrowserToolService.BrowserToolService;
    const browserExternalTools = yield* BrowserExternalToolService.BrowserExternalToolService;
    const computerTools = yield* ComputerToolService.ComputerToolService;

    const child =
      options.prewarmedChild ??
      (yield* spawner
        .spawn(
          ChildProcess.make(effectiveBinaryPath, [...spawnArgs], {
            cwd: options.cwd,
            env,
            forceKillAfter: CODEX_APP_SERVER_FORCE_KILL_AFTER,
            shell: process.platform === "win32",
          }),
        )
        .pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
          Effect.mapError(
            (cause) =>
              new CodexErrors.CodexAppServerSpawnError({
                command: `${effectiveBinaryPath} ${spawnArgs.join(" ")}`,
                cause,
              }),
          ),
        ));
    if (options.prewarmedChild !== undefined) {
      yield* Scope.addFinalizer(
        runtimeScope,
        child.kill({ killSignal: "SIGTERM" }).pipe(Effect.ignore),
      );
    }

    const rpcLogSink = options.jsonRpcLogPath
      ? new RotatingFileSink({
          filePath: options.jsonRpcLogPath,
          maxBytes: 10 * 1024 * 1024,
          maxFiles: 10,
          throwOnError: false,
        })
      : undefined;

    const clientContext = yield* CodexClient.layerChildProcess(child, {
      ...(rpcLogSink
        ? {
            logIncoming: true,
            logOutgoing: true,
            logger: (event) =>
              Effect.gen(function* () {
                const ts = DateTime.formatIso(yield* DateTime.now);
                const logLine = JSON.stringify({
                  ts,
                  dir: event.direction,
                  stage: event.stage,
                  data: event.payload,
                });
                rpcLogSink.write(`${logLine}\n`);
              }),
          }
        : {}),
    }).pipe(Layer.build, Effect.provideService(Scope.Scope, runtimeScope));
    const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
      Effect.provide(clientContext),
    );
    const serverNotifications = yield* Queue.bounded<CodexServerNotification>(
      CODEX_SERVER_NOTIFICATION_QUEUE_CAPACITY,
    );
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

    const sessionCreatedAt = yield* nowIso;
    const initialSession = {
      provider: PROVIDER,
      ...(options.providerInstanceId ? { providerInstanceId: options.providerInstanceId } : {}),
      status: "connecting",
      runtimeMode: options.runtimeMode,
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      threadId: options.threadId,
      ...(options.resumeCursor !== undefined ? { resumeCursor: options.resumeCursor } : {}),
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt,
    } satisfies ProviderSession;
    const sessionRef = yield* Ref.make<ProviderSession>(initialSession);
    const offerEvent = (event: ProviderEvent) => Queue.offer(events, event).pipe(Effect.asVoid);

    const emitEvent = (event: Omit<ProviderEvent, "id" | "provider" | "createdAt">) =>
      Effect.gen(function* () {
        const id = yield* Random.nextUUIDv4;
        return yield* offerEvent({
          id: EventId.make(id),
          provider: PROVIDER,
          ...(options.providerInstanceId ? { providerInstanceId: options.providerInstanceId } : {}),
          createdAt: yield* nowIso,
          ...event,
        });
      });
    const emitSessionEvent = (method: string, message: string) =>
      emitEvent({
        kind: "session",
        threadId: options.threadId,
        method,
        message,
      });

    const settlePendingApprovals = (decision: ProviderApprovalDecision) =>
      Ref.get(pendingApprovalsRef).pipe(
        Effect.flatMap((pendingApprovals) =>
          Effect.forEach(
            Array.from(pendingApprovals.values()),
            (pendingApproval) =>
              Deferred.succeed(pendingApproval.decision, decision).pipe(Effect.ignore),
            { discard: true },
          ),
        ),
      );

    const settlePendingUserInputs = (answers: ProviderUserInputAnswers) =>
      Ref.get(pendingUserInputsRef).pipe(
        Effect.flatMap((pendingUserInputs) =>
          Effect.forEach(
            Array.from(pendingUserInputs.values()),
            (pendingUserInput) =>
              Deferred.succeed(pendingUserInput.answers, answers).pipe(Effect.ignore),
            { discard: true },
          ),
        ),
      );

    const handleRawNotification = (notification: CodexServerNotification) =>
      Effect.gen(function* () {
        const payload = notification.params;
        const route = readRouteFields(notification);
        const collabReceiverTurns = yield* Ref.get(collabReceiverTurnsRef);
        const childParentTurnId = (() => {
          const providerConversationId = readNotificationThreadId(notification);
          return providerConversationId
            ? collabReceiverTurns.get(providerConversationId)
            : undefined;
        })();

        rememberCollabReceiverTurns(collabReceiverTurns, notification, route.turnId);
        if (childParentTurnId && shouldSuppressChildConversationNotification(notification.method)) {
          yield* Ref.set(collabReceiverTurnsRef, collabReceiverTurns);
          return;
        }

        let requestId: ApprovalRequestId | undefined;
        let requestKind: ProviderRequestKind | undefined;
        let turnId = childParentTurnId ?? route.turnId;
        let itemId = route.itemId;

        if (notification.method === "serverRequest/resolved") {
          const rawRequestId =
            typeof notification.params.requestId === "string"
              ? notification.params.requestId
              : String(notification.params.requestId);
          const correlation = rawRequestId
            ? (yield* Ref.get(approvalCorrelationsRef)).get(rawRequestId)
            : undefined;
          if (correlation) {
            requestId = correlation.requestId;
            requestKind = correlation.requestKind;
            turnId = correlation.turnId ?? turnId;
            itemId = correlation.itemId ?? itemId;
            yield* Ref.update(approvalCorrelationsRef, (current) => {
              const next = new Map(current);
              next.delete(rawRequestId);
              return next;
            });
          }
        }

        yield* Ref.set(collabReceiverTurnsRef, collabReceiverTurns);
        yield* emitEvent({
          kind: "notification",
          threadId: options.threadId,
          method: notification.method,
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          ...(requestId ? { requestId } : {}),
          ...(requestKind ? { requestKind } : {}),
          ...(notification.method === "item/agentMessage/delta"
            ? { textDelta: notification.params.delta }
            : {}),
          ...(payload !== undefined ? { payload } : {}),
        });
      });

    const currentSessionProviderThreadId = Effect.map(Ref.get(sessionRef), currentProviderThreadId);

    yield* client.handleServerNotification("thread/started", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          if (providerThreadId && payload.thread.id !== providerThreadId) {
            return Effect.void;
          }
          return updateSession(sessionRef, {
            resumeCursor: { threadId: payload.thread.id },
          });
        }),
      ),
    );

    yield* client.handleServerNotification("turn/started", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          if (providerThreadId && payload.threadId !== providerThreadId) {
            return Effect.void;
          }
          return updateSession(sessionRef, {
            status: "running",
            activeTurnId: TurnId.make(payload.turn.id),
          });
        }),
      ),
    );

    yield* client.handleServerNotification("turn/completed", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          if (providerThreadId && payload.threadId !== providerThreadId) {
            return Effect.void;
          }
          const lastError =
            payload.turn.status === "failed" && "error" in payload.turn && payload.turn.error
              ? payload.turn.error.message
              : undefined;
          return updateSession(sessionRef, {
            status: payload.turn.status === "failed" ? "error" : "ready",
            activeTurnId: undefined,
            ...(lastError ? { lastError } : {}),
          });
        }),
      ),
    );

    yield* client.handleServerNotification("error", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          const payloadThreadId = payload.threadId;
          if (providerThreadId && payloadThreadId && payloadThreadId !== providerThreadId) {
            return Effect.void;
          }
          const errorMessage = payload.error.message;
          const willRetry = payload.willRetry;
          return updateSession(sessionRef, {
            status: willRetry ? "running" : "error",
            ...(errorMessage ? { lastError: errorMessage } : {}),
          });
        }),
      ),
    );

    yield* client.handleServerRequest("item/commandExecution/requestApproval", (payload) =>
      Effect.gen(function* () {
        const requestId = ApprovalRequestId.make(yield* Random.nextUUIDv4);
        const turnId = TurnId.make(payload.turnId);
        const itemId = ProviderItemId.make(payload.itemId);
        const decision = yield* Deferred.make<ProviderApprovalDecision>();

        yield* Ref.update(pendingApprovalsRef, (current) => {
          const next = new Map(current);
          next.set(requestId, {
            requestId,
            jsonRpcId: payload.approvalId ?? payload.itemId,
            requestKind: "command",
            turnId,
            itemId,
            decision,
          });
          return next;
        });
        yield* Ref.update(approvalCorrelationsRef, (current) => {
          const next = new Map(current);
          next.set(payload.approvalId ?? payload.itemId, {
            requestId,
            requestKind: "command",
            turnId,
            itemId,
          });
          return next;
        });

        yield* emitEvent({
          kind: "request",
          threadId: options.threadId,
          method: "item/commandExecution/requestApproval",
          requestId,
          requestKind: "command",
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          payload,
        });

        const resolved = yield* Deferred.await(decision).pipe(
          Effect.ensuring(
            Ref.update(pendingApprovalsRef, (current) => {
              const next = new Map(current);
              next.delete(requestId);
              return next;
            }),
          ),
        );
        return {
          decision: resolved,
        } satisfies EffectCodexSchema.CommandExecutionRequestApprovalResponse;
      }),
    );

    yield* client.handleServerRequest("item/fileChange/requestApproval", (payload) =>
      Effect.gen(function* () {
        const requestId = ApprovalRequestId.make(yield* Random.nextUUIDv4);
        const turnId = TurnId.make(payload.turnId);
        const itemId = ProviderItemId.make(payload.itemId);
        const decision = yield* Deferred.make<ProviderApprovalDecision>();

        yield* Ref.update(pendingApprovalsRef, (current) => {
          const next = new Map(current);
          next.set(requestId, {
            requestId,
            jsonRpcId: payload.itemId,
            requestKind: "file-change",
            turnId,
            itemId,
            decision,
          });
          return next;
        });
        yield* Ref.update(approvalCorrelationsRef, (current) => {
          const next = new Map(current);
          next.set(payload.itemId, {
            requestId,
            requestKind: "file-change",
            turnId,
            itemId,
          });
          return next;
        });

        yield* emitEvent({
          kind: "request",
          threadId: options.threadId,
          method: "item/fileChange/requestApproval",
          requestId,
          requestKind: "file-change",
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          payload,
        });

        const resolved = yield* Deferred.await(decision).pipe(
          Effect.ensuring(
            Ref.update(pendingApprovalsRef, (current) => {
              const next = new Map(current);
              next.delete(requestId);
              return next;
            }),
          ),
        );
        return {
          decision: resolved,
        } satisfies EffectCodexSchema.FileChangeRequestApprovalResponse;
      }),
    );

    yield* client.handleServerRequest("item/tool/requestUserInput", (payload) =>
      Effect.gen(function* () {
        const requestId = ApprovalRequestId.make(yield* Random.nextUUIDv4);
        const turnId = TurnId.make(payload.turnId);
        const itemId = ProviderItemId.make(payload.itemId);
        const answers = yield* Deferred.make<ProviderUserInputAnswers>();

        yield* Ref.update(pendingUserInputsRef, (current) => {
          const next = new Map(current);
          next.set(requestId, {
            requestId,
            turnId,
            itemId,
            answers,
          });
          return next;
        });

        yield* emitEvent({
          kind: "request",
          threadId: options.threadId,
          method: "item/tool/requestUserInput",
          requestId,
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          payload,
        });

        const resolvedAnswers = yield* Deferred.await(answers).pipe(
          Effect.ensuring(
            Ref.update(pendingUserInputsRef, (current) => {
              const next = new Map(current);
              next.delete(requestId);
              return next;
            }),
          ),
        );

        return {
          answers: yield* toCodexUserInputAnswers(resolvedAnswers).pipe(
            Effect.mapError((error) =>
              CodexErrors.CodexAppServerRequestError.invalidParams(error.message, {
                questionId: error.questionId,
              }),
            ),
          ),
        } satisfies EffectCodexSchema.ToolRequestUserInputResponse;
      }),
    );

    yield* client.handleServerRequest("item/tool/call", (payload) =>
      Effect.gen(function* () {
        let confirmationQuestionId = "tool_confirmation";
        let confirmationHeader = "工具确认";
        let confirmationMessage: string | undefined;
        let retryAfterConfirmation: () => Promise<EffectCodexSchema.DynamicToolCallResponse>;
        let supportsAlwaysAllowBrowserHost = false;
        let supportsAlwaysAllowApp = false;
        let browserToolRunner:
          | ((
              nextPayload: EffectCodexSchema.DynamicToolCallParams,
            ) => Promise<EffectCodexSchema.DynamicToolCallResponse>)
          | undefined;

        if (
          payload.namespace === T3_BROWSER_TOOL_NAMESPACE ||
          payload.namespace === T3_BROWSER_EXTERNAL_TOOL_NAMESPACE
        ) {
          const targetBrowserTools =
            payload.namespace === T3_BROWSER_EXTERNAL_TOOL_NAMESPACE
              ? browserExternalTools
              : browserTools;
          browserToolRunner = (nextPayload) => targetBrowserTools.call(nextPayload);
          const initialResponse = yield* Effect.promise(() => targetBrowserTools.call(payload));
          confirmationMessage = readBrowserConfirmationMessage(initialResponse);
          if (!confirmationMessage) {
            return initialResponse;
          }
          confirmationQuestionId = "browser_confirmation";
          confirmationHeader = "浏览器确认";
          supportsAlwaysAllowBrowserHost = true;
          retryAfterConfirmation = () =>
            targetBrowserTools.call(withBrowserUserConfirmation(payload));
        } else if (payload.namespace === T3_COMPUTER_TOOL_NAMESPACE) {
          const currentRuntimeMode = (yield* Ref.get(sessionRef)).runtimeMode;
          const payloadWithRuntimeMode = withComputerRuntimeContext(payload, currentRuntimeMode);
          if (
            currentRuntimeMode === "approval-required" &&
            isT3ComputerInputToolName(payload.tool)
          ) {
            confirmationMessage = `computer_use wants to run ${payload.tool}.`;
          }

          if (!confirmationMessage) {
            const initialResponse = yield* Effect.promise(() =>
              computerTools.call(payloadWithRuntimeMode),
            );
            confirmationMessage = readComputerConfirmationMessage(initialResponse);
            if (!confirmationMessage) {
              return initialResponse;
            }
          }

          confirmationQuestionId = "computer_confirmation";
          confirmationHeader = "桌面确认";
          supportsAlwaysAllowApp = true;
          retryAfterConfirmation = () =>
            computerTools.call(withComputerUserConfirmation(payload, currentRuntimeMode));
        } else {
          return dynamicTextResponse(
            `Unsupported dynamic tool namespace: ${payload.namespace ?? ""}`,
            false,
          );
        }

        const requestId = ApprovalRequestId.make(yield* Random.nextUUIDv4);
        const turnId = TurnId.make(payload.turnId);
        const itemId = ProviderItemId.make(payload.callId);
        const answers = yield* Deferred.make<ProviderUserInputAnswers>();

        yield* Ref.update(pendingUserInputsRef, (current) => {
          const next = new Map(current);
          next.set(requestId, {
            requestId,
            turnId,
            itemId,
            answers,
          });
          return next;
        });

        yield* emitEvent({
          kind: "request",
          threadId: options.threadId,
          method: "item/tool/requestUserInput",
          requestId,
          turnId,
          itemId,
          payload: {
            threadId: payload.threadId,
            turnId: payload.turnId,
            itemId: payload.callId,
            questions: [
              {
                id: confirmationQuestionId,
                header: confirmationHeader,
                question: confirmationMessage,
                options: [
                  {
                    label: "Accept",
                    description: "允许这一次操作继续执行。",
                  },
                  ...(supportsAlwaysAllowApp
                    ? [
                        {
                          label: "Always allow",
                          description: "始终允许 computer_use 使用当前前台应用。",
                        },
                      ]
                    : []),
                  ...(supportsAlwaysAllowBrowserHost
                    ? [
                        {
                          label: "Always allow",
                          description: "始终允许 browser_use 使用当前网站。",
                        },
                      ]
                    : []),
                  {
                    label: "Decline",
                    description: "拒绝这一次操作。",
                  },
                ],
              },
            ],
          },
        });

        const resolvedAnswers = yield* Deferred.await(answers).pipe(
          Effect.ensuring(
            Ref.update(pendingUserInputsRef, (current) => {
              const next = new Map(current);
              next.delete(requestId);
              return next;
            }),
          ),
        );
        const answer = resolvedAnswers[confirmationQuestionId];
        const accepted = isAcceptedUserInputAnswer(answer);
        if (!accepted) {
          return dynamicTextResponse("Dynamic tool action declined by the user.", false);
        }

        const alwaysAllow = userInputAnswerIncludes(answer, "Always allow");
        if (supportsAlwaysAllowBrowserHost) {
          if (!browserToolRunner) {
            return dynamicTextResponse("Browser tool service is unavailable.", false);
          }
          return yield* Effect.promise(() =>
            browserToolRunner(
              withBrowserUserConfirmation(payload, { alwaysAllowHost: alwaysAllow }),
            ),
          );
        }

        if (supportsAlwaysAllowApp) {
          const currentRuntimeMode = (yield* Ref.get(sessionRef)).runtimeMode;
          return yield* Effect.promise(() =>
            computerTools.call(
              withComputerUserConfirmation(payload, currentRuntimeMode, {
                alwaysAllowApp: alwaysAllow,
              }),
            ),
          );
        }

        return yield* Effect.promise(retryAfterConfirmation);
      }),
    );

    yield* client.handleUnknownServerRequest((method) =>
      Effect.fail(CodexErrors.CodexAppServerRequestError.methodNotFound(method)),
    );

    const registerServerNotification = <M extends CodexRpc.ServerNotificationMethod>(method: M) =>
      client.handleServerNotification(method, (params) =>
        Queue.offer(serverNotifications, makeCodexServerNotification(method, params)).pipe(
          Effect.asVoid,
        ),
      );

    yield* Effect.forEach(
      Object.values(
        CodexRpc.SERVER_NOTIFICATION_METHODS,
      ) as ReadonlyArray<CodexRpc.ServerNotificationMethod>,
      registerServerNotification,
      { concurrency: 1, discard: true },
    );

    yield* Stream.fromQueue(serverNotifications).pipe(
      Stream.runForEach(handleRawNotification),
      Effect.forkIn(runtimeScope),
    );

    const stderrRemainderRef = yield* Ref.make("");
    yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Ref.modify(stderrRemainderRef, (current) => {
          const combined = current + chunk;
          const lines = combined.split("\n");
          const remainder = lines.pop() ?? "";
          return [lines.map((line) => line.replace(/\r$/, "")), remainder] as const;
        }).pipe(
          Effect.flatMap((lines) =>
            Effect.forEach(
              lines,
              (line) => {
                const classified = classifyCodexStderrLine(line);
                if (!classified) {
                  return Effect.void;
                }
                return emitEvent({
                  kind: "notification",
                  threadId: options.threadId,
                  method: "process/stderr",
                  message: classified.message,
                });
              },
              { discard: true },
            ),
          ),
        ),
      ),
      Effect.forkIn(runtimeScope),
    );

    yield* child.exitCode.pipe(
      Effect.flatMap((exitCode) =>
        Ref.get(closedRef).pipe(
          Effect.flatMap((closed) => {
            if (closed) {
              return Effect.void;
            }
            const nextStatus = exitCode === 0 ? "closed" : "error";
            return updateSession(sessionRef, {
              status: nextStatus,
              activeTurnId: undefined,
            }).pipe(
              Effect.andThen(
                emitSessionEvent(
                  "session/exited",
                  exitCode === 0
                    ? "Codex App Server exited."
                    : `Codex App Server exited with code ${exitCode}.`,
                ),
              ),
            );
          }),
        ),
      ),
      Effect.forkIn(runtimeScope),
    );

    const start = Effect.fn("CodexSessionRuntime.start")(function* () {
      yield* emitSessionEvent("session/connecting", "Starting Codex App Server session.");
      yield* client.request("initialize", buildCodexInitializeParams());
      yield* client.notify("initialized", undefined);
      yield* enableCodexPluginExperimentalFeatures(client, { operation: "session.start" });
      const readiness = yield* client.request("windowsSandbox/readiness", undefined).pipe(
        Effect.tap((payload) =>
          emitEvent({
            kind: "notification",
            threadId: options.threadId,
            method: "windowsSandbox/readiness",
            payload,
          }),
        ),
        Effect.catch((cause) =>
          emitEvent({
            kind: "notification",
            threadId: options.threadId,
            method: "windowsSandbox/readiness",
            message: cause.message,
            payload: { status: "error", message: cause.message },
          }).pipe(Effect.as(undefined)),
        ),
      );
      void readiness;

      const requestedModel = normalizeCodexModelSlug(options.model);

      const opened = yield* openCodexThread({
        client,
        threadId: options.threadId,
        runtimeMode: options.runtimeMode,
        cwd: options.cwd,
        requestedModel,
        requestedModelProvider: bundledModelProvider,
        requestedConfigOverrides: bundledConfigOverrides,
        serviceTier: options.serviceTier,
        personality: options.personality,
        resumeThreadId: readResumeCursorThreadId(options.resumeCursor),
      });

      const providerThreadId = opened.thread.id;
      const session = {
        ...(yield* Ref.get(sessionRef)),
        status: "ready",
        cwd: opened.cwd,
        model: opened.model,
        resumeCursor: { threadId: providerThreadId },
        updatedAt: yield* nowIso,
      } satisfies ProviderSession;
      yield* Ref.set(sessionRef, session);
      yield* emitSessionEvent("session/ready", "Codex App Server session ready.");
      return session;
    });

    const readProviderThreadId = Effect.gen(function* () {
      const providerThreadId = currentProviderThreadId(yield* Ref.get(sessionRef));
      if (!providerThreadId) {
        return yield* new CodexSessionRuntimeThreadIdMissingError({
          threadId: options.threadId,
        });
      }
      return providerThreadId;
    });

    const close = Effect.gen(function* () {
      const alreadyClosed = yield* Ref.getAndSet(closedRef, true);
      if (alreadyClosed) {
        return;
      }
      yield* settlePendingApprovals("cancel");
      yield* settlePendingUserInputs({});
      yield* updateSession(sessionRef, {
        status: "closed",
        activeTurnId: undefined,
      });
      yield* emitSessionEvent("session/closed", "Session stopped");
      yield* Scope.close(runtimeScope, Exit.void);
      yield* Queue.shutdown(serverNotifications);
      yield* Queue.shutdown(events);
    });

    return {
      start,
      getSession: Ref.get(sessionRef),
      sendTurn: (input) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const currentSession = yield* Ref.get(sessionRef);
          const normalizedModel = normalizeCodexModelSlug(input.model ?? currentSession.model);
          const params = yield* buildTurnStartParams({
            threadId: providerThreadId,
            runtimeMode: currentSession.runtimeMode,
            ...(input.input ? { prompt: input.input } : {}),
            ...(input.attachments ? { attachments: input.attachments } : {}),
            ...(normalizedModel ? { model: normalizedModel } : {}),
            ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
            ...(input.effort ? { effort: input.effort } : {}),
            ...(input.interactionMode ? { interactionMode: input.interactionMode } : {}),
            ...(input.personality !== undefined ? { personality: input.personality } : {}),
          });
          const rawResponse = yield* client.raw.request("turn/start", params);
          const response = yield* decodeV2TurnStartResponse(rawResponse).pipe(
            Effect.mapError((error) =>
              toProtocolParseError("Invalid turn/start response payload", error),
            ),
          );
          const turnId = TurnId.make(response.turn.id);
          yield* updateSession(sessionRef, {
            status: "running",
            activeTurnId: turnId,
            ...(normalizedModel ? { model: normalizedModel } : {}),
          });
          const resumedProviderThreadId = currentProviderThreadId(yield* Ref.get(sessionRef));
          return {
            threadId: options.threadId,
            turnId,
            ...(resumedProviderThreadId
              ? { resumeCursor: { threadId: resumedProviderThreadId } }
              : {}),
          } satisfies ProviderTurnStartResult;
        }),
      updateThreadSettings: (input) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const normalizedModel =
            input.model === undefined || input.model === null
              ? input.model
              : normalizeCodexModelSlug(input.model);
          const params = buildThreadSettingsUpdateParams({
            threadId: providerThreadId,
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
            ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
            ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
            ...(input.effort !== undefined ? { effort: input.effort } : {}),
            ...(input.approvalPolicy !== undefined ? { approvalPolicy: input.approvalPolicy } : {}),
            ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
            ...(input.permissions === undefined && input.sandboxPolicy !== undefined
              ? { sandboxPolicy: input.sandboxPolicy }
              : {}),
            ...(input.personality !== undefined ? { personality: input.personality } : {}),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
          });
          yield* client.request("thread/settings/update", params);
          yield* updateSession(sessionRef, {
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
            ...(normalizedModel !== undefined && normalizedModel !== null
              ? { model: normalizedModel }
              : {}),
            updatedAt: yield* nowIso,
          });
        }),
      steerTurn: (input) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const params = yield* decodeV2TurnSteerParams({
            threadId: providerThreadId,
            expectedTurnId: input.expectedTurnId,
            input: buildCodexTurnInput({
              ...(input.input ? { prompt: input.input } : {}),
              ...(input.attachments ? { attachments: input.attachments } : {}),
            }),
          }).pipe(
            Effect.mapError((error) =>
              toProtocolParseError("Invalid turn/steer request payload", error),
            ),
          );
          const rawResponse = yield* client.raw.request("turn/steer", params);
          const response = yield* decodeV2TurnSteerResponse(rawResponse).pipe(
            Effect.mapError((error) =>
              toProtocolParseError("Invalid turn/steer response payload", error),
            ),
          );
          const turnId = TurnId.make(response.turnId);
          yield* updateSession(sessionRef, {
            status: "running",
            activeTurnId: turnId,
          });
          return {
            threadId: options.threadId,
            turnId,
          } satisfies ProviderTurnSteerResult;
        }),
      interruptTurn: (turnId) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const session = yield* Ref.get(sessionRef);
          const effectiveTurnId = turnId ?? session.activeTurnId;
          if (!effectiveTurnId) {
            return;
          }
          yield* client.request("turn/interrupt", {
            threadId: providerThreadId,
            turnId: effectiveTurnId,
          });
        }),
      readThread: Effect.gen(function* () {
        const providerThreadId = yield* readProviderThreadId;
        const response = yield* client.request("thread/read", {
          threadId: providerThreadId,
          includeTurns: true,
        });
        return parseThreadSnapshot(response);
      }),
      listThreadTurns: (input) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const response = yield* client.request("thread/turns/list", {
            threadId: providerThreadId,
            ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
            ...(input.itemsView !== undefined ? { itemsView: input.itemsView } : {}),
            ...(input.sortDirection !== undefined ? { sortDirection: input.sortDirection } : {}),
          });
          return parseThreadTurnsPage(response);
        }),
      listThreadTurnItems: (input) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const response = yield* client.request("thread/turns/items/list", {
            threadId: providerThreadId,
            turnId: input.turnId,
            ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
            ...(input.sortDirection !== undefined ? { sortDirection: input.sortDirection } : {}),
          });
          return parseThreadTurnItemsPage(response);
        }),
      rollbackThread: (numTurns) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const response = yield* client.request("thread/rollback", {
            threadId: providerThreadId,
            numTurns,
          });
          yield* updateSession(sessionRef, {
            status: "ready",
            activeTurnId: undefined,
          });
          return parseThreadSnapshot(response);
        }),
      setGoal: (input) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const rawResponse = yield* client.raw.request("thread/goal/set", {
            threadId: providerThreadId,
            objective: input.objective,
            ...(input.status ? { status: input.status } : {}),
          });
          const response = yield* decodeV2ThreadGoalSetResponse(rawResponse).pipe(
            Effect.mapError((error) =>
              toProtocolParseError("Invalid thread/goal/set response payload", error),
            ),
          );
          return toOrchestrationGoal(response.goal, yield* nowIso);
        }),
      setGoalStatus: (status) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const current = yield* client.request("thread/goal/get", {
            threadId: providerThreadId,
          });
          if (!current.goal) {
            return yield* CodexErrors.CodexAppServerRequestError.invalidParams(
              "Cannot update goal status because no goal is set.",
            );
          }
          const rawResponse = yield* client.raw.request("thread/goal/set", {
            threadId: providerThreadId,
            objective: current.goal.objective,
            status,
          });
          const response = yield* decodeV2ThreadGoalSetResponse(rawResponse).pipe(
            Effect.mapError((error) =>
              toProtocolParseError("Invalid thread/goal/set response payload", error),
            ),
          );
          return toOrchestrationGoal(response.goal, yield* nowIso);
        }),
      getGoal: Effect.gen(function* () {
        const providerThreadId = yield* readProviderThreadId;
        const rawResponse = yield* client.raw.request("thread/goal/get", {
          threadId: providerThreadId,
        });
        const response = yield* decodeV2ThreadGoalGetResponse(rawResponse).pipe(
          Effect.mapError((error) =>
            toProtocolParseError("Invalid thread/goal/get response payload", error),
          ),
        );
        return response.goal ? toOrchestrationGoal(response.goal, yield* nowIso) : null;
      }),
      clearGoal: Effect.gen(function* () {
        const providerThreadId = yield* readProviderThreadId;
        const rawResponse = yield* client.raw.request("thread/goal/clear", {
          threadId: providerThreadId,
        });
        const response = yield* decodeV2ThreadGoalClearResponse(rawResponse).pipe(
          Effect.mapError((error) =>
            toProtocolParseError("Invalid thread/goal/clear response payload", error),
          ),
        );
        return response.cleared;
      }),
      windowsSandboxReadiness: client.request("windowsSandbox/readiness", undefined),
      windowsSandboxSetupStart: (input) =>
        client.request("windowsSandbox/setupStart", {
          mode: input.mode,
          cwd: options.cwd,
        }),
      respondToRequest: (requestId, decision) =>
        Effect.gen(function* () {
          const pending = (yield* Ref.get(pendingApprovalsRef)).get(requestId);
          if (!pending) {
            return yield* new CodexSessionRuntimePendingApprovalNotFoundError({
              requestId,
            });
          }
          yield* Ref.update(pendingApprovalsRef, (current) => {
            const next = new Map(current);
            next.delete(requestId);
            return next;
          });
          yield* Deferred.succeed(pending.decision, decision);
          yield* emitEvent({
            kind: "notification",
            threadId: options.threadId,
            method: "item/requestApproval/decision",
            requestId: pending.requestId,
            requestKind: pending.requestKind,
            ...(pending.turnId ? { turnId: pending.turnId } : {}),
            ...(pending.itemId ? { itemId: pending.itemId } : {}),
            payload: {
              requestId: pending.requestId,
              requestKind: pending.requestKind,
              decision,
            },
          });
        }),
      respondToUserInput: (requestId, answers) =>
        Effect.gen(function* () {
          const pending = (yield* Ref.get(pendingUserInputsRef)).get(requestId);
          if (!pending) {
            return yield* new CodexSessionRuntimePendingUserInputNotFoundError({
              requestId,
            });
          }
          const codexAnswers = yield* toCodexUserInputAnswers(answers);
          yield* Ref.update(pendingUserInputsRef, (current) => {
            const next = new Map(current);
            next.delete(requestId);
            return next;
          });
          yield* Deferred.succeed(pending.answers, answers);
          yield* emitEvent({
            kind: "notification",
            threadId: options.threadId,
            method: "item/tool/requestUserInput/answered",
            requestId: pending.requestId,
            ...(pending.turnId ? { turnId: pending.turnId } : {}),
            ...(pending.itemId ? { itemId: pending.itemId } : {}),
            payload: {
              answers: codexAnswers,
            },
          });
        }),
      events: Stream.fromQueue(events),
      close,
    } satisfies CodexSessionRuntimeShape;
  });
