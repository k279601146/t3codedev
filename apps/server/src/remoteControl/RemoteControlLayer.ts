import * as Crypto from "node:crypto";

import {
  ApprovalRequestId,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  QqBotConfig,
  QqBotConfigPatchInput,
  QqBotHandleMessageInput,
  QqRemoteBinding,
  QqRemoteBindingRevokeInput,
  QqRemoteBindingsListResult,
  RemoteControlClientRevokeInput,
  RemoteControlClientsListInput,
  RemoteControlDisableInput,
  RemoteControlEnableInput,
  RemoteControlError,
  RemoteControlPairingStartInput,
  RemoteControlPairingStatusInput,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { CheckpointDiffQuery } from "../checkpointing/Services/CheckpointDiffQuery.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { RemoteControlService, type RemoteControlServiceShape } from "./RemoteControlService.ts";

export const QQ_APP_ID_SECRET = "remote-control-qq-app-id";
export const QQ_APP_SECRET_SECRET = "remote-control-qq-app-secret";
export const QQ_TOKEN_SECRET = "remote-control-qq-token";
export const QQ_ENABLED_SECRET = "remote-control-qq-enabled";
export const QQ_BINDINGS_SECRET = "remote-control-qq-bindings";
export const DEFAULT_QQ_WEBHOOK_PATH = "/api/remote-control/qq/webhook";
const DEFAULT_CODEX_PROVIDER_INSTANCE_ID = defaultInstanceIdForDriver(
  ProviderDriverKind.make("codex"),
);
const MAX_QQ_DIFF_CHARS = 3500;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const decodeQqBotConfigPatch = Schema.decodeUnknownEffect(QqBotConfigPatchInput);
const decodeQqMessage = Schema.decodeUnknownEffect(QqBotHandleMessageInput);
const decodeQqBindingRevoke = Schema.decodeUnknownEffect(QqRemoteBindingRevokeInput);
const decodeQqBindingsListResult = Schema.decodeUnknownEffect(QqRemoteBindingsListResult);
const decodeEnable = Schema.decodeUnknownEffect(RemoteControlEnableInput);
const decodeDisable = Schema.decodeUnknownEffect(RemoteControlDisableInput);
const decodePairingStart = Schema.decodeUnknownEffect(RemoteControlPairingStartInput);
const decodePairingStatus = Schema.decodeUnknownEffect(RemoteControlPairingStatusInput);
const decodeClientsList = Schema.decodeUnknownEffect(RemoteControlClientsListInput);
const decodeClientRevoke = Schema.decodeUnknownEffect(RemoteControlClientRevokeInput);

type ActivePairing = {
  readonly session: import("@t3tools/contracts").RemoteControlPairingSession;
  readonly providerInstanceId: ProviderInstanceId;
  readonly createdAt: string;
};

function toRemoteControlError(message: string, cause?: unknown): RemoteControlError {
  return new RemoteControlError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function mapRemoteError(message: string) {
  return (cause: unknown) => toRemoteControlError(message, cause);
}

export function parseQqCommand(content: string): import("@t3tools/contracts").QqBotParsedCommand {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "ask", argument: trimmed };
  }
  const [rawCommand = "", ...rest] = trimmed.slice(1).split(/\s+/);
  const argument = rest.join(" ").trim();
  switch (rawCommand.toLowerCase()) {
    case "bind":
      return { kind: "bind", argument };
    case "new":
      return { kind: "new", argument };
    case "status":
      return { kind: "status", argument };
    case "threads":
      return { kind: "threads", argument };
    case "ask":
      return { kind: "ask", argument };
    case "steer":
      return { kind: "steer", argument };
    case "interrupt":
      return { kind: "interrupt", argument };
    case "approve":
      return { kind: "approve", argument };
    case "deny":
      return { kind: "deny", argument };
    case "diff":
      return { kind: "diff", argument };
    case "summary":
      return { kind: "summary", argument };
    default:
      return { kind: "unknown", argument: trimmed };
  }
}

function splitFirst(input: string): readonly [string, string] {
  const trimmed = input.trim();
  const index = trimmed.search(/\s/);
  if (index < 0) {
    return [trimmed, ""];
  }
  return [trimmed.slice(0, index), trimmed.slice(index).trim()];
}

function truncateForQq(text: string): string {
  if (text.length <= MAX_QQ_DIFF_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_QQ_DIFF_CHARS)}\n...已截断，完整 diff 请在 T3 Code 客户端查看。`;
}

function makeRemoteQqThreadId(): ThreadId {
  return ThreadId.make(`remote-qq-${Crypto.randomUUID()}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readSummaryText(item: unknown): string | null {
  if (typeof item === "string") {
    return item.trim() || null;
  }
  const record = asRecord(item);
  if (!record) {
    return null;
  }
  for (const key of ["summary", "text", "message", "title", "content"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export const RemoteControlLayerLive = Layer.effect(
  RemoteControlService,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const secretStore = yield* ServerSecretStore;

    const readSecretString = (name: string) =>
      secretStore.get(name).pipe(Effect.map((bytes) => (bytes ? textDecoder.decode(bytes) : null)));

    const writeOptionalSecret = (name: string, value: string | null | undefined) => {
      if (value === undefined) {
        return Effect.void;
      }
      const trimmed = value?.trim() ?? "";
      return trimmed
        ? secretStore.set(name, textEncoder.encode(trimmed))
        : secretStore.remove(name);
    };

    const nowIso = () => Effect.map(DateTime.now, DateTime.formatIso);
    const initialEnabled = (yield* readSecretString(QQ_ENABLED_SECRET)) === "true";
    const initialBindingsText = yield* readSecretString(QQ_BINDINGS_SECRET);
    const initialBindings = yield* initialBindingsText
      ? Effect.try({
          try: () => JSON.parse(initialBindingsText) as unknown,
          catch: (cause) => cause,
        }).pipe(
          Effect.flatMap((value) => decodeQqBindingsListResult(value)),
          Effect.map((result) => result.bindings),
          Effect.catch(() => Effect.succeed([])),
        )
      : Effect.succeed([]);

    const enabledRef = yield* Ref.make(initialEnabled);
    const activePairingsRef = yield* Ref.make<ReadonlyArray<ActivePairing>>([]);
    const bindingsRef = yield* Ref.make<ReadonlyArray<QqRemoteBinding>>(initialBindings);

    const persistBindings = (bindings: ReadonlyArray<QqRemoteBinding>) =>
      secretStore.set(QQ_BINDINGS_SECRET, textEncoder.encode(JSON.stringify({ bindings })));

    const updateBindings = (
      f: (bindings: ReadonlyArray<QqRemoteBinding>) => ReadonlyArray<QqRemoteBinding>,
    ) => Ref.updateAndGet(bindingsRef, f).pipe(Effect.tap((bindings) => persistBindings(bindings)));

    const readQqBotConfig = Effect.gen(function* () {
      const [enabled, appId, secret, token] = yield* Effect.all([
        Ref.get(enabledRef),
        readSecretString(QQ_APP_ID_SECRET),
        readSecretString(QQ_APP_SECRET_SECRET),
        readSecretString(QQ_TOKEN_SECRET),
      ]);
      return {
        enabled,
        appId,
        secretConfigured: Boolean(secret),
        tokenConfigured: Boolean(token),
        webhookPath: DEFAULT_QQ_WEBHOOK_PATH,
      } satisfies QqBotConfig;
    });

    const getStatus: RemoteControlServiceShape["getStatus"] = () =>
      providerService
        .remoteControlStatusRead()
        .pipe(Effect.mapError(mapRemoteError("读取 Codex 远程控制状态失败。")));

    const enable: RemoteControlServiceShape["enable"] = (rawInput) =>
      decodeEnable(rawInput).pipe(
        Effect.mapError(mapRemoteError("远程控制启用参数无效。")),
        Effect.flatMap((input) => providerService.remoteControlEnable(input)),
        Effect.mapError(mapRemoteError("启用 Codex 远程控制失败。")),
      );

    const disable: RemoteControlServiceShape["disable"] = (rawInput) =>
      decodeDisable(rawInput).pipe(
        Effect.mapError(mapRemoteError("远程控制停用参数无效。")),
        Effect.flatMap((input) => providerService.remoteControlDisable(input)),
        Effect.mapError(mapRemoteError("停用 Codex 远程控制失败。")),
      );

    const startPairing: RemoteControlServiceShape["startPairing"] = (rawInput) =>
      decodePairingStart(rawInput).pipe(
        Effect.mapError(mapRemoteError("远程控制配对参数无效。")),
        Effect.flatMap((input) =>
          providerService
            .remoteControlPairingStart({
              ...input,
              manualCode: input.manualCode ?? true,
            })
            .pipe(Effect.map((session) => ({ input, session }))),
        ),
        Effect.tap(({ input, session }) =>
          Effect.gen(function* () {
            const createdAt = yield* nowIso();
            const nowSeconds = Date.now() / 1000;
            yield* Ref.update(activePairingsRef, (current) => [
              ...current.filter((pairing) => pairing.session.expiresAt > nowSeconds),
              {
                session,
                providerInstanceId: input.providerInstanceId ?? DEFAULT_CODEX_PROVIDER_INSTANCE_ID,
                createdAt,
              },
            ]);
          }),
        ),
        Effect.map(({ session }) => session),
        Effect.mapError(mapRemoteError("启动 Codex 远程控制配对失败。")),
      );

    const getPairingStatus: RemoteControlServiceShape["getPairingStatus"] = (rawInput) =>
      decodePairingStatus(rawInput).pipe(
        Effect.mapError(mapRemoteError("远程控制配对状态参数无效。")),
        Effect.flatMap((input) => providerService.remoteControlPairingStatus(input)),
        Effect.mapError(mapRemoteError("读取 Codex 远程控制配对状态失败。")),
      );

    const listClients: RemoteControlServiceShape["listClients"] = (rawInput) =>
      decodeClientsList(rawInput).pipe(
        Effect.mapError(mapRemoteError("远程控制客户端列表参数无效。")),
        Effect.flatMap((input) => providerService.remoteControlClientsList(input)),
        Effect.mapError(mapRemoteError("读取 Codex 远程控制客户端列表失败。")),
      );

    const revokeClient: RemoteControlServiceShape["revokeClient"] = (rawInput) =>
      decodeClientRevoke(rawInput).pipe(
        Effect.mapError(mapRemoteError("远程控制客户端撤销参数无效。")),
        Effect.flatMap((input) => providerService.remoteControlClientRevoke(input)),
        Effect.mapError(mapRemoteError("撤销 Codex 远程控制客户端失败。")),
      );

    const updateQqBotConfig: RemoteControlServiceShape["updateQqBotConfig"] = (rawInput) =>
      decodeQqBotConfigPatch(rawInput).pipe(
        Effect.mapError(mapRemoteError("QQ Bot 配置参数无效。")),
        Effect.tap((input) =>
          Effect.all([
            writeOptionalSecret(QQ_APP_ID_SECRET, input.appId),
            writeOptionalSecret(QQ_APP_SECRET_SECRET, input.secret),
            writeOptionalSecret(QQ_TOKEN_SECRET, input.token),
            input.enabled === undefined
              ? Effect.void
              : Ref.set(enabledRef, input.enabled).pipe(
                  Effect.flatMap(() =>
                    secretStore.set(QQ_ENABLED_SECRET, textEncoder.encode(String(input.enabled))),
                  ),
                ),
          ]),
        ),
        Effect.flatMap(() => readQqBotConfig),
        Effect.mapError(mapRemoteError("保存 QQ Bot 配置失败。")),
      );

    const listQqBindings: RemoteControlServiceShape["listQqBindings"] = () =>
      Ref.get(bindingsRef).pipe(Effect.map((bindings) => ({ bindings: [...bindings] })));

    const revokeQqBinding: RemoteControlServiceShape["revokeQqBinding"] = (rawInput) =>
      decodeQqBindingRevoke(rawInput).pipe(
        Effect.mapError(mapRemoteError("QQ 绑定撤销参数无效。")),
        Effect.flatMap((input) =>
          updateBindings((bindings) =>
            bindings.filter((binding) => binding.id !== input.bindingId),
          ),
        ),
        Effect.map((bindings) => ({ bindings: [...bindings] })),
        Effect.mapError(mapRemoteError("撤销 QQ 绑定失败。")),
      );

    const bindQqUser = (input: QqBotHandleMessageInput, code: string) =>
      Effect.gen(function* () {
        const nowSeconds = Date.now() / 1000;
        const pairings = yield* Ref.get(activePairingsRef);
        const pairing = pairings.find(
          (candidate) =>
            candidate.session.expiresAt > nowSeconds &&
            (candidate.session.manualPairingCode === code ||
              candidate.session.pairingCode === code),
        );
        if (!pairing) {
          return "绑定码无效或已过期，请在 T3 Code 远程控制页面重新生成。";
        }
        const createdAt = yield* nowIso();
        const binding = {
          id: Crypto.randomUUID(),
          qqUserId: input.userId,
          qqGroupId: input.groupId ?? null,
          environmentId: pairing.session.environmentId,
          providerInstanceId: pairing.providerInstanceId,
          displayName: input.displayName ?? null,
          createdAt,
          lastSeenAt: createdAt,
        } satisfies QqRemoteBinding;
        yield* updateBindings((bindings) => [
          ...bindings.filter(
            (current) =>
              current.qqUserId !== binding.qqUserId || current.qqGroupId !== binding.qqGroupId,
          ),
          binding,
        ]);
        return `已绑定 QQ 用户 ${input.userId} 到环境 ${binding.environmentId}。`;
      });

    const requireBinding = (input: QqBotHandleMessageInput) =>
      Ref.get(bindingsRef).pipe(
        Effect.flatMap((bindings) => {
          const binding = bindings.find(
            (candidate) =>
              candidate.qqUserId === input.userId &&
              (candidate.qqGroupId ?? undefined) === input.groupId,
          );
          return binding
            ? Effect.succeed(binding)
            : Effect.fail(
                toRemoteControlError(
                  "请先在 T3 Code 远程控制页面生成绑定码，并发送 /bind <code>。",
                ),
              );
        }),
        Effect.tap((binding) =>
          nowIso().pipe(
            Effect.flatMap((lastSeenAt) =>
              updateBindings((bindings) =>
                bindings.map((current) =>
                  current.id === binding.id ? { ...current, lastSeenAt } : current,
                ),
              ),
            ),
          ),
        ),
      );

    const loadFullThreadDiffReply = (threadIdText: string) =>
      Effect.gen(function* () {
        if (!providerService.listThreadTurns) {
          return "当前 provider 不支持读取会话 turn 列表，无法生成 diff。";
        }
        const threadId = ThreadId.make(threadIdText);
        const turns = yield* providerService.listThreadTurns({
          threadId,
          limit: 500,
          itemsView: "summary",
          sortDirection: "asc",
        });
        const toTurnCount = turns.data.length;
        if (toTurnCount === 0) {
          return `会话 ${threadIdText} 暂无可用 diff。`;
        }
        const diff = yield* checkpointDiffQuery.getFullThreadDiff({
          threadId,
          toTurnCount,
          ignoreWhitespace: false,
        });
        if (!diff.diff.trim()) {
          return `会话 ${threadIdText} 当前没有文件变更。`;
        }
        return truncateForQq(`会话 ${threadIdText} 的 diff：\n${diff.diff}`);
      });

    const loadThreadSummaryReply = (threadIdText: string) =>
      Effect.gen(function* () {
        if (!providerService.listThreadTurns) {
          return "当前 provider 不支持读取会话 turn 摘要。";
        }
        const turns = yield* providerService.listThreadTurns({
          threadId: ThreadId.make(threadIdText),
          limit: 5,
          itemsView: "summary",
          sortDirection: "desc",
        });
        const lines = turns.data.flatMap((turn) => {
          const itemSummaries = turn.items
            .map(readSummaryText)
            .filter((value): value is string => Boolean(value));
          return itemSummaries.length > 0
            ? [`turn ${turn.id} · ${turn.status}`, ...itemSummaries.map((item) => `- ${item}`)]
            : [`turn ${turn.id} · ${turn.status}`];
        });
        return lines.length === 0
          ? `会话 ${threadIdText} 暂无摘要。`
          : truncateForQq(`会话 ${threadIdText} 最近摘要：\n${lines.join("\n")}`);
      });

    const handleQqMessage: RemoteControlServiceShape["handleQqMessage"] = (rawInput) =>
      decodeQqMessage(rawInput).pipe(
        Effect.mapError(mapRemoteError("QQ 消息参数无效。")),
        Effect.flatMap((input) =>
          Effect.gen(function* () {
            const command = parseQqCommand(input.content);
            let reply: string;
            if (command.kind === "bind") {
              reply = yield* bindQqUser(input, command.argument);
            } else if (command.kind === "new") {
              const binding = yield* requireBinding(input);
              if (!command.argument) {
                reply = "用法：/new <message>";
              } else {
                const threadId = makeRemoteQqThreadId();
                yield* providerService.startSession(threadId, {
                  threadId,
                  providerInstanceId: binding.providerInstanceId,
                  runtimeMode: "approval-required",
                });
                const result = yield* providerService.sendTurn({
                  threadId,
                  input: command.argument,
                });
                reply = `已创建会话 ${result.threadId}，turn ${result.turnId}。`;
              }
            } else if (command.kind === "status") {
              yield* requireBinding(input);
              const status = yield* getStatus();
              reply = `远程控制状态：${status.status}，环境：${status.environmentId ?? "未连接"}`;
            } else if (command.kind === "threads") {
              yield* requireBinding(input);
              const sessions = yield* providerService.listSessions();
              reply =
                sessions.length === 0
                  ? "当前没有活动会话。"
                  : sessions
                      .map(
                        (session) =>
                          `${session.threadId} · ${session.status}${
                            session.activeTurnId ? ` · turn ${session.activeTurnId}` : ""
                          }`,
                      )
                      .join("\n");
            } else if (command.kind === "ask") {
              yield* requireBinding(input);
              const [threadId, prompt] = splitFirst(command.argument);
              if (!threadId || !prompt) {
                reply = "用法：/ask <threadId> <message>";
              } else {
                const result = yield* providerService.sendTurn({
                  threadId: ThreadId.make(threadId),
                  input: prompt,
                });
                reply = `已发送到会话 ${result.threadId}，turn ${result.turnId}。`;
              }
            } else if (command.kind === "steer") {
              yield* requireBinding(input);
              const [threadId, rest] = splitFirst(command.argument);
              const [turnId, prompt] = splitFirst(rest);
              if (!threadId || !turnId || !prompt) {
                reply = "用法：/steer <threadId> <turnId> <message>";
              } else {
                const result = yield* providerService.steerTurn({
                  threadId: ThreadId.make(threadId),
                  expectedTurnId: TurnId.make(turnId),
                  input: prompt,
                });
                reply = `已追加到会话 ${result.threadId}，turn ${result.turnId}。`;
              }
            } else if (command.kind === "interrupt") {
              yield* requireBinding(input);
              const [threadId, turnId] = splitFirst(command.argument);
              if (!threadId) {
                reply = "用法：/interrupt <threadId> [turnId]";
              } else {
                yield* providerService.interruptTurn({
                  threadId: ThreadId.make(threadId),
                  ...(turnId ? { turnId: TurnId.make(turnId) } : {}),
                });
                reply = `已中断会话 ${threadId}。`;
              }
            } else if (command.kind === "approve" || command.kind === "deny") {
              yield* requireBinding(input);
              const [threadId, requestId] = splitFirst(command.argument);
              if (!threadId || !requestId) {
                reply = `用法：/${command.kind} <threadId> <requestId>`;
              } else {
                yield* providerService.respondToRequest({
                  threadId: ThreadId.make(threadId),
                  requestId: ApprovalRequestId.make(requestId),
                  decision: command.kind === "approve" ? "accept" : "decline",
                });
                reply = command.kind === "approve" ? "已批准请求。" : "已拒绝请求。";
              }
            } else if (command.kind === "diff") {
              yield* requireBinding(input);
              const [threadId] = splitFirst(command.argument);
              if (!threadId) {
                reply = "用法：/diff <threadId>";
              } else {
                reply = yield* loadFullThreadDiffReply(threadId);
              }
            } else if (command.kind === "summary") {
              yield* requireBinding(input);
              const [threadId] = splitFirst(command.argument);
              if (!threadId) {
                reply = "用法：/summary <threadId>";
              } else {
                reply = yield* loadThreadSummaryReply(threadId);
              }
            } else {
              reply =
                "未知指令。可用：/bind、/new、/status、/threads、/ask、/steer、/interrupt、/approve、/deny、/diff、/summary。";
            }
            return { command, reply };
          }),
        ),
        Effect.mapError(mapRemoteError("处理 QQ 消息失败。")),
      );

    const getSnapshot: RemoteControlServiceShape["getSnapshot"] = () =>
      Effect.gen(function* () {
        const status = yield* getStatus();
        const qqBot = yield* readQqBotConfig;
        const bindings = (yield* listQqBindings()).bindings;
        const clients = status.environmentId
          ? (yield* listClients({ environmentId: status.environmentId })).data
          : [];
        return { status, qqBot, bindings, clients };
      });

    return {
      getSnapshot,
      getStatus,
      enable,
      disable,
      startPairing,
      getPairingStatus,
      listClients,
      revokeClient,
      updateQqBotConfig,
      listQqBindings,
      revokeQqBinding,
      handleQqMessage,
    } satisfies RemoteControlServiceShape;
  }),
);
