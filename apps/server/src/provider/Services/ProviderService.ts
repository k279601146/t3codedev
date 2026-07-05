/**
 * ProviderService - Service interface for provider sessions, turns, and checkpoints.
 *
 * Acts as the cross-provider facade used by transports (WebSocket/RPC). It
 * resolves provider adapters through `ProviderAdapterRegistry`, routes
 * session-scoped calls via `ProviderSessionDirectory`, and exposes one unified
 * provider event stream to callers.
 *
 * Uses Effect `Context.Service` for dependency injection and returns typed
 * domain errors for validation, session, codex, and checkpoint workflows.
 *
 * @module ProviderService
 */
import type {
  ProviderCompactThreadInput,
  ProviderInterruptTurnInput,
  ProviderGoalClearInput,
  ProviderGoalClearResult,
  ProviderGoalGetInput,
  ProviderGoalGetResult,
  ProviderGoalSetInput,
  ProviderGoalSetResult,
  ProviderGoalStatusSetInput,
  OrchestrationListThreadTurnItemsInput,
  OrchestrationListThreadTurnItemsResult,
  OrchestrationListThreadTurnsInput,
  OrchestrationListThreadTurnsResult,
  ProviderInstanceId,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSteerTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  ProviderThreadSettingsUpdateInput,
  ProviderThreadSettingsUpdateResult,
  ThreadId,
  ProviderTurnStartResult,
  ProviderTurnSteerResult,
  ProviderWindowsSandboxReadinessInput,
  ProviderWindowsSandboxReadinessResult,
  ProviderWindowsSandboxSetupStartInput,
  ProviderWindowsSandboxSetupStartResult,
  RemoteControlClientRevokeInput,
  RemoteControlClientsListInput,
  RemoteControlClientsListResult,
  RemoteControlDisableInput,
  RemoteControlEnableInput,
  RemoteControlPairingSession,
  RemoteControlPairingStartInput,
  RemoteControlPairingStatus,
  RemoteControlPairingStatusInput,
  RemoteControlStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { ProviderServiceError } from "../Errors.ts";
import type { ProviderAdapterCapabilities } from "./ProviderAdapter.ts";
import type { ProviderInstanceRoutingInfo } from "./ProviderAdapterRegistry.ts";

/**
 * ProviderServiceShape - Service API for provider session and turn orchestration.
 */
export interface ProviderServiceShape {
  /**
   * Start a provider session.
   */
  readonly startSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  /**
   * Send a provider turn.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  /**
   * Append user input to an active provider turn.
   */
  readonly steerTurn: (
    input: ProviderSteerTurnInput,
  ) => Effect.Effect<ProviderTurnSteerResult, ProviderServiceError>;

  /**
   * Interrupt a running provider turn.
   */
  readonly interruptTurn: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Trigger provider-native conversation context compaction.
   */
  readonly compactThread: (
    input: ProviderCompactThreadInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider approval request.
   */
  readonly respondToRequest: (
    input: ProviderRespondToRequestInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider structured user-input request.
   */
  readonly respondToUserInput: (
    input: ProviderRespondToUserInputInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly setGoal: (
    input: ProviderGoalSetInput,
  ) => Effect.Effect<ProviderGoalSetResult, ProviderServiceError>;

  readonly setGoalStatus: (
    input: ProviderGoalStatusSetInput,
  ) => Effect.Effect<ProviderGoalSetResult, ProviderServiceError>;

  readonly getGoal: (
    input: ProviderGoalGetInput,
  ) => Effect.Effect<ProviderGoalGetResult, ProviderServiceError>;

  readonly clearGoal: (
    input: ProviderGoalClearInput,
  ) => Effect.Effect<ProviderGoalClearResult, ProviderServiceError>;

  readonly updateThreadSettings?: (
    input: ProviderThreadSettingsUpdateInput,
  ) => Effect.Effect<ProviderThreadSettingsUpdateResult, ProviderServiceError>;

  /**
   * Stop a provider session.
   */
  readonly stopSession: (
    input: ProviderStopSessionInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * List active provider sessions.
   *
   * Aggregates runtime session lists from all registered adapters.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Read capabilities for the adapter bound to a configured provider instance.
   */
  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>;

  readonly getInstanceInfo: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstanceRoutingInfo, ProviderServiceError>;

  readonly listThreadTurns?: (
    input: OrchestrationListThreadTurnsInput,
  ) => Effect.Effect<OrchestrationListThreadTurnsResult, ProviderServiceError>;

  readonly listThreadTurnItems?: (
    input: OrchestrationListThreadTurnItemsInput,
  ) => Effect.Effect<OrchestrationListThreadTurnItemsResult, ProviderServiceError>;

  readonly windowsSandboxReadiness?: (
    input: ProviderWindowsSandboxReadinessInput,
  ) => Effect.Effect<ProviderWindowsSandboxReadinessResult, ProviderServiceError>;

  readonly windowsSandboxSetupStart?: (
    input: ProviderWindowsSandboxSetupStartInput,
  ) => Effect.Effect<ProviderWindowsSandboxSetupStartResult, ProviderServiceError>;

  readonly remoteControlEnable: (
    input: RemoteControlEnableInput,
  ) => Effect.Effect<RemoteControlStatus, ProviderServiceError>;

  readonly remoteControlDisable: (
    input: RemoteControlDisableInput,
  ) => Effect.Effect<RemoteControlStatus, ProviderServiceError>;

  readonly remoteControlStatusRead: () => Effect.Effect<RemoteControlStatus, ProviderServiceError>;

  readonly remoteControlPairingStart: (
    input: RemoteControlPairingStartInput,
  ) => Effect.Effect<RemoteControlPairingSession, ProviderServiceError>;

  readonly remoteControlPairingStatus: (
    input: RemoteControlPairingStatusInput,
  ) => Effect.Effect<RemoteControlPairingStatus, ProviderServiceError>;

  readonly remoteControlClientsList: (
    input: RemoteControlClientsListInput,
  ) => Effect.Effect<RemoteControlClientsListResult, ProviderServiceError>;

  readonly remoteControlClientRevoke: (
    input: RemoteControlClientRevokeInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Roll back provider conversation state by a number of turns.
   */
  readonly rollbackConversation: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Canonical provider runtime event stream.
   *
   * Fan-out is owned by ProviderService (not by a standalone event-bus service).
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

/**
 * ProviderService - Service tag for provider orchestration.
 */
export class ProviderService extends Context.Service<ProviderService, ProviderServiceShape>()(
  "t3/provider/Services/ProviderService",
) {}
