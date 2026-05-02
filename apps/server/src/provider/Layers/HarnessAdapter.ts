/**
 * HarnessAdapter — maps CCB engine events to T3Code's ProviderRuntimeEvent stream.
 *
 * Phase 2: Tool system integration and permission hooks.
 *
 * @module provider/Layers/HarnessAdapter
 */
import {
  EventId,
  type HarnessSettings,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Exit, Queue, Random, Ref, Scope, Stream } from "effect";
import type { ProviderInstanceId } from "@t3tools/contracts";
import {
  QueryEngine,
  getTools,
  getCommands,
  getDefaultAppState,
  assembleToolPool,
} from "@t3tools/ccb-engine";

import {
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("harness");

interface HarnessSessionContext {
  session: ProviderSession;
  engine: QueryEngine;
  sessionScope: Scope.Closeable;
  pendingRequests: Map<
    string,
    {
      resolve: (decision: { behavior: "allow" | "deny" }) => void;
      reject: (err: any) => void;
    }
  >;
}

export const makeHarnessAdapter = (
  config: HarnessSettings,
  opts: {
    instanceId: ProviderInstanceId;
    nativeEventLogger?: EventNdjsonLogger;
  },
): Effect.Effect<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const sessions = yield* Ref.make<Map<string, HarnessSessionContext>>(
      new Map(),
    );
    const eventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const map = yield* Ref.get(sessions);
        for (const ctx of map.values()) {
          yield* Scope.close(ctx.sessionScope, Exit.void);
        }
        yield* Queue.shutdown(eventQueue);
      }),
    );

    const emitEvent = (event: ProviderRuntimeEvent) =>
      Queue.offer(eventQueue, event).pipe(Effect.asVoid);

    const getSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(sessions);
        const ctx = map.get(threadId);
        if (!ctx) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        return ctx;
      });

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },

      startSession: (input) =>
        Effect.gen(function* () {
          const threadId =
            input.threadId ??
            ThreadId.make(
              `harness-${yield* Random.nextIntBetween(100000, 999999)}`,
            );
          const sessionScope = yield* Scope.make();
          const pendingRequests = new Map<
            string,
            {
              resolve: (decision: { behavior: "allow" | "deny" }) => void;
              reject: (err: any) => void;
            }
          >();

          const canUseTool = async (
            tool: any,
            toolInput: any,
            _ctx: any,
            _msg: any,
            toolUseID: string,
          ) => {
            return new Promise<{ behavior: "allow" | "deny" }>(
              (resolve, reject) => {
                const requestId =
                  toolUseID || `req-${Math.random().toString(36).slice(2)}`;
                pendingRequests.set(requestId, { resolve, reject });

                Effect.runSync(
                  emitEvent({
                    type: "request.opened",
                    eventId: EventId.make(
                      `harness-req-${Math.random().toString(36).slice(2)}`,
                    ),
                    provider: PROVIDER,
                    threadId,
                    turnId: TurnId.make("active"),
                    requestId: requestId as any, // Use any because of branded string issues in this context
                    createdAt: new Date().toISOString(),
                    payload: {
                      requestType: "command_execution_approval",
                      args: {
                        method: tool.name,
                        params: toolInput,
                      },
                    },
                  } as any),
                );
              },
            );
          };

          const appState = getDefaultAppState();
          const commands = yield* Effect.promise(() =>
            getCommands(input.cwd ?? process.cwd()),
          );

          // Map T3Code settings to CCB environment
          if (config.apiKey) {
            process.env.ANTHROPIC_API_KEY = config.apiKey;
          }

          const engine = new QueryEngine({
            cwd: input.cwd ?? process.cwd(),
            getAppState: () => appState,
            setAppState: (f: any) => {
              // AppState is updated internally by CCB
            },
            readFileCache: new Map() as any,
            tools: assembleToolPool(
              appState.toolPermissionContext,
              appState.mcp.tools,
            ),
            commands,
            agents: [],
            mcpClients: [],
            canUseTool,
            userSpecifiedModel: input.modelSelection?.model ?? config.model,
          } as any);

          const context: HarnessSessionContext = {
            session: {
              provider: PROVIDER,
              threadId,
              status: "ready",
              runtimeMode: "full-access",
              model:
                input.modelSelection?.model ??
                config.model ??
                "gemini-2.5-flash",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            engine,
            sessionScope,
            pendingRequests,
          };

          yield* Ref.update(sessions, (m) => new Map(m).set(threadId, context));
          return context.session;
        }),

      sendTurn: (input) =>
        Effect.gen(function* () {
          const ctx = yield* getSession(input.threadId);
          const turnId = TurnId.make(
            `harness-turn-${yield* Random.nextIntBetween(100000, 999999)}`,
          );

          yield* emitEvent({
            type: "turn.started",
            eventId: EventId.make(
              `harness-evt-${yield* Random.nextIntBetween(100000, 999999)}`,
            ),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            createdAt: new Date().toISOString(),
            payload: {},
          });

          yield* Stream.fromAsyncIterable(
            ctx.engine.submitMessage([{ type: "text", text: input.input ?? "" }]),
            (e) => e,
          ).pipe(
            Stream.runForEach((msg) =>
              Effect.gen(function* () {
                if (msg.type === "assistant" || msg.type === "result") {
                  yield* emitEvent({
                    type: "content.delta",
                    eventId: EventId.make(
                      `harness-evt-${Math.floor(Math.random() * 1000000)}`,
                    ),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId,
                    createdAt: new Date().toISOString(),
                    payload: {
                      streamKind: "assistant_text",
                      delta:
                        msg.type === "assistant" && msg.message
                          ? String(msg.message.content)
                          : "",
                    },
                  });
                }
              }),
            ),
            Effect.flatMap(() =>
              emitEvent({
                type: "turn.completed",
                eventId: EventId.make(
                  `harness-evt-${Math.floor(Math.random() * 1000000)}`,
                ),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId,
                createdAt: new Date().toISOString(),
                payload: {
                  state: "completed",
                },
              }),
            ),
            Effect.forkIn(ctx.sessionScope),
          );

          return { threadId: input.threadId, turnId };
        }),

      interruptTurn: (threadId) =>
        getSession(threadId).pipe(Effect.asVoid),

      respondToRequest: (threadId, requestId, decision) =>
        Effect.gen(function* () {
          const ctx = yield* getSession(threadId);
          const request = ctx.pendingRequests.get(requestId);
          if (request) {
            request.resolve({
              behavior:
                decision === "accept" || decision === "acceptForSession"
                  ? "allow"
                  : "deny",
            });
            ctx.pendingRequests.delete(requestId);
          }
        }),

      respondToUserInput: (_threadId, _requestId, _answers) => Effect.void,

      stopSession: (threadId) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessions);
          const ctx = map.get(threadId);
          if (ctx) {
            yield* Scope.close(ctx.sessionScope, Exit.void);
            yield* Ref.update(sessions, (m) => {
              const next = new Map(m);
              next.delete(threadId);
              return next;
            });
          }
        }),

      listSessions: () =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessions);
          return [...map.values()].map((ctx) => ctx.session);
        }),

      hasSession: (threadId) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessions);
          return map.has(threadId);
        }),

      readThread: (threadId) =>
        Effect.map(getSession(threadId), () => ({ threadId, turns: [] })),

      rollbackThread: (threadId, _numTurns) =>
        Effect.map(getSession(threadId), () => ({ threadId, turns: [] })),

      stopAll: () =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessions);
          for (const ctx of map.values()) {
            yield* Scope.close(ctx.sessionScope, Exit.void);
          }
          yield* Ref.set(sessions, new Map());
        }),

      streamEvents: Stream.fromQueue(eventQueue),
    };
  });
