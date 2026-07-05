import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const RemoteControlConnectionStatus = Schema.Literals([
  "disabled",
  "connecting",
  "connected",
  "errored",
]);
export type RemoteControlConnectionStatus = typeof RemoteControlConnectionStatus.Type;

export const RemoteControlStatus = Schema.Struct({
  status: RemoteControlConnectionStatus,
  serverName: TrimmedNonEmptyString,
  installationId: TrimmedNonEmptyString,
  environmentId: Schema.NullOr(TrimmedNonEmptyString),
});
export type RemoteControlStatus = typeof RemoteControlStatus.Type;

export const RemoteControlEnableInput = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  ephemeral: Schema.optional(Schema.Boolean),
});
export type RemoteControlEnableInput = typeof RemoteControlEnableInput.Type;

export const RemoteControlDisableInput = RemoteControlEnableInput;
export type RemoteControlDisableInput = typeof RemoteControlDisableInput.Type;

export const RemoteControlPairingStartInput = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  manualCode: Schema.optional(Schema.Boolean),
});
export type RemoteControlPairingStartInput = typeof RemoteControlPairingStartInput.Type;

export const RemoteControlPairingSession = Schema.Struct({
  pairingCode: TrimmedNonEmptyString,
  manualPairingCode: Schema.NullOr(TrimmedNonEmptyString),
  environmentId: TrimmedNonEmptyString,
  expiresAt: PositiveInt,
});
export type RemoteControlPairingSession = typeof RemoteControlPairingSession.Type;

export const RemoteControlPairingStatusInput = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  pairingCode: Schema.optional(TrimmedNonEmptyString),
  manualPairingCode: Schema.optional(TrimmedNonEmptyString),
});
export type RemoteControlPairingStatusInput = typeof RemoteControlPairingStatusInput.Type;

export const RemoteControlPairingStatus = Schema.Struct({
  claimed: Schema.Boolean,
});
export type RemoteControlPairingStatus = typeof RemoteControlPairingStatus.Type;

export const RemoteControlClient = Schema.Struct({
  clientId: TrimmedNonEmptyString,
  displayName: Schema.NullOr(TrimmedNonEmptyString),
  deviceType: Schema.NullOr(TrimmedNonEmptyString),
  platform: Schema.NullOr(TrimmedNonEmptyString),
  osVersion: Schema.NullOr(TrimmedNonEmptyString),
  deviceModel: Schema.NullOr(TrimmedNonEmptyString),
  appVersion: Schema.NullOr(TrimmedNonEmptyString),
  lastSeenAt: Schema.NullOr(PositiveInt),
});
export type RemoteControlClient = typeof RemoteControlClient.Type;

export const RemoteControlClientsListInput = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  environmentId: TrimmedNonEmptyString,
  cursor: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt),
  order: Schema.optional(Schema.Literals(["asc", "desc"])),
});
export type RemoteControlClientsListInput = typeof RemoteControlClientsListInput.Type;

export const RemoteControlClientsListResult = Schema.Struct({
  data: Schema.Array(RemoteControlClient),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type RemoteControlClientsListResult = typeof RemoteControlClientsListResult.Type;

export const RemoteControlClientRevokeInput = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  environmentId: TrimmedNonEmptyString,
  clientId: TrimmedNonEmptyString,
});
export type RemoteControlClientRevokeInput = typeof RemoteControlClientRevokeInput.Type;

export const QqBotConfig = Schema.Struct({
  enabled: Schema.Boolean,
  appId: Schema.NullOr(TrimmedNonEmptyString),
  secretConfigured: Schema.Boolean,
  tokenConfigured: Schema.Boolean,
  webhookPath: TrimmedNonEmptyString,
});
export type QqBotConfig = typeof QqBotConfig.Type;

export const QqBotConfigPatchInput = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  appId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  secret: Schema.optional(Schema.NullOr(Schema.String)),
  token: Schema.optional(Schema.NullOr(Schema.String)),
});
export type QqBotConfigPatchInput = typeof QqBotConfigPatchInput.Type;

export const QqRemoteBinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  qqUserId: TrimmedNonEmptyString,
  qqGroupId: Schema.NullOr(TrimmedNonEmptyString),
  environmentId: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  displayName: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  lastSeenAt: Schema.NullOr(IsoDateTime),
});
export type QqRemoteBinding = typeof QqRemoteBinding.Type;

export const QqRemoteBindingsListResult = Schema.Struct({
  bindings: Schema.Array(QqRemoteBinding),
});
export type QqRemoteBindingsListResult = typeof QqRemoteBindingsListResult.Type;

export const QqRemoteBindingRevokeInput = Schema.Struct({
  bindingId: TrimmedNonEmptyString,
});
export type QqRemoteBindingRevokeInput = typeof QqRemoteBindingRevokeInput.Type;

export const QqBotCommandKind = Schema.Literals([
  "bind",
  "new",
  "status",
  "threads",
  "ask",
  "steer",
  "interrupt",
  "approve",
  "deny",
  "diff",
  "unknown",
]);
export type QqBotCommandKind = typeof QqBotCommandKind.Type;

export const QqBotParsedCommand = Schema.Struct({
  kind: QqBotCommandKind,
  argument: Schema.String,
});
export type QqBotParsedCommand = typeof QqBotParsedCommand.Type;

export const QqBotHandleMessageInput = Schema.Struct({
  userId: TrimmedNonEmptyString,
  groupId: Schema.optional(TrimmedNonEmptyString),
  content: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
});
export type QqBotHandleMessageInput = typeof QqBotHandleMessageInput.Type;

export const QqBotHandleMessageResult = Schema.Struct({
  command: QqBotParsedCommand,
  reply: TrimmedNonEmptyString,
});
export type QqBotHandleMessageResult = typeof QqBotHandleMessageResult.Type;

export const RemoteControlSnapshot = Schema.Struct({
  status: RemoteControlStatus,
  qqBot: QqBotConfig,
  bindings: Schema.Array(QqRemoteBinding),
  clients: Schema.Array(RemoteControlClient),
});
export type RemoteControlSnapshot = typeof RemoteControlSnapshot.Type;

export class RemoteControlError extends Schema.TaggedErrorClass<RemoteControlError>()(
  "RemoteControlError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const RemoteControlCommandResult = Schema.Struct({
  accepted: Schema.Boolean,
  message: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
  turnId: Schema.optional(TrimmedNonEmptyString),
  pendingRequests: Schema.optional(NonNegativeInt),
});
export type RemoteControlCommandResult = typeof RemoteControlCommandResult.Type;
