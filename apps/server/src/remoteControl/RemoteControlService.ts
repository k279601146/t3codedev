import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  QqBotConfig,
  QqBotConfigPatchInput,
  QqBotHandleMessageInput,
  QqBotHandleMessageResult,
  QqRemoteBindingRevokeInput,
  QqRemoteBindingsListResult,
  RemoteControlClientRevokeInput,
  RemoteControlClientsListInput,
  RemoteControlClientsListResult,
  RemoteControlDisableInput,
  RemoteControlEnableInput,
  RemoteControlError,
  RemoteControlPairingSession,
  RemoteControlPairingStartInput,
  RemoteControlPairingStatus,
  RemoteControlPairingStatusInput,
  RemoteControlSnapshot,
  RemoteControlStatus,
} from "@t3tools/contracts";

export interface RemoteControlServiceShape {
  readonly getSnapshot: () => Effect.Effect<RemoteControlSnapshot, RemoteControlError>;
  readonly getStatus: () => Effect.Effect<RemoteControlStatus, RemoteControlError>;
  readonly enable: (
    input: RemoteControlEnableInput,
  ) => Effect.Effect<RemoteControlStatus, RemoteControlError>;
  readonly disable: (
    input: RemoteControlDisableInput,
  ) => Effect.Effect<RemoteControlStatus, RemoteControlError>;
  readonly startPairing: (
    input: RemoteControlPairingStartInput,
  ) => Effect.Effect<RemoteControlPairingSession, RemoteControlError>;
  readonly getPairingStatus: (
    input: RemoteControlPairingStatusInput,
  ) => Effect.Effect<RemoteControlPairingStatus, RemoteControlError>;
  readonly listClients: (
    input: RemoteControlClientsListInput,
  ) => Effect.Effect<RemoteControlClientsListResult, RemoteControlError>;
  readonly revokeClient: (
    input: RemoteControlClientRevokeInput,
  ) => Effect.Effect<void, RemoteControlError>;
  readonly updateQqBotConfig: (
    input: QqBotConfigPatchInput,
  ) => Effect.Effect<QqBotConfig, RemoteControlError>;
  readonly listQqBindings: () => Effect.Effect<QqRemoteBindingsListResult, RemoteControlError>;
  readonly revokeQqBinding: (
    input: QqRemoteBindingRevokeInput,
  ) => Effect.Effect<QqRemoteBindingsListResult, RemoteControlError>;
  readonly handleQqMessage: (
    input: QqBotHandleMessageInput,
  ) => Effect.Effect<QqBotHandleMessageResult, RemoteControlError>;
}

export class RemoteControlService extends Context.Service<
  RemoteControlService,
  RemoteControlServiceShape
>()("t3/remoteControl/RemoteControlService") {}
