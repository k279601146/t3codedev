// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off globalDate:off globalRandom:off
import * as NodeHttp from "node:http";
import type { AddressInfo } from "node:net";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

export interface DesktopBrowserExternalAutomationTabState {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly visible: boolean;
  readonly width: number;
  readonly height: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export interface DesktopBrowserExternalAutomationPermission {
  readonly host: string;
  readonly decision: "allow" | "block";
  readonly scope: "session" | "always";
  readonly updatedAt: string;
}

export interface DesktopBrowserExternalAutomationState {
  readonly endpoint: string;
  readonly token: string;
  readonly connected: boolean;
  readonly extensionId: string | null;
  readonly browserName: string | null;
  readonly profileName: string | null;
  readonly selectedTabId: string | null;
  readonly tabs: ReadonlyArray<DesktopBrowserExternalAutomationTabState>;
  readonly permissions: ReadonlyArray<DesktopBrowserExternalAutomationPermission>;
  readonly lastError: string | null;
  readonly lastToolCallAt: string | null;
  readonly toolCallSequence: number;
  readonly updatedAt: string;
}

export interface DesktopBrowserExternalAutomationHostShape {
  readonly endpoint: string;
  readonly token: string;
  readonly state: Effect.Effect<DesktopBrowserExternalAutomationState>;
}

export class DesktopBrowserExternalAutomationHost extends Context.Service<
  DesktopBrowserExternalAutomationHost,
  DesktopBrowserExternalAutomationHostShape
>()("t3/desktop/browserExternal/AutomationHost") {}

type ToolCallPayload = {
  readonly arguments?: unknown;
  readonly namespace?: string | null;
  readonly tool?: string;
};

type ToolResponse = {
  readonly success: boolean;
  readonly contentItems: ReadonlyArray<
    | { readonly type: "inputText"; readonly text: string }
    | { readonly type: "inputImage"; readonly imageUrl: string }
  >;
};

type ExtensionCommand =
  | {
      readonly id: string;
      readonly type: "tool/call";
      readonly payload: ToolCallPayload;
    }
  | {
      readonly id: string;
      readonly type: "permission/request";
      readonly payload: {
        readonly host: string;
        readonly tool: string;
      };
    };

interface PendingToolCall {
  readonly id: string;
  readonly payload: ToolCallPayload;
  readonly createdAt: number;
  resolve(response: ToolResponse): void;
}

interface MutableHostState {
  connected: boolean;
  extensionId: string | null;
  browserName: string | null;
  profileName: string | null;
  selectedTabId: string | null;
  tabs: DesktopBrowserExternalAutomationTabState[];
  permissions: Map<string, DesktopBrowserExternalAutomationPermission>;
  lastError: string | null;
  lastToolCallAt: string | null;
  toolCallSequence: number;
  updatedAt: string;
}

const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const TOOL_CALL_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 25_000;
const EXTENSION_STALE_AFTER_MS = 45_000;
const EXTENSION_WATCHDOG_INTERVAL_MS = 10_000;
const T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX = "T3_BROWSER_CONFIRMATION_REQUIRED:";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

export function isBrowserExternalAutomationAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === "chrome-extension:") {
      return url.hostname.length > 0;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const hostname = url.hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

function corsHeadersForRequest(
  request: NodeHttp.IncomingMessage,
): Record<string, string> {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !isBrowserExternalAutomationAllowedOrigin(origin)) {
    return {};
  }
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
  };
}

function textResponse(text: string, success = true): ToolResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" ? raw : undefined;
}

function hostFromPayload(payload: ToolCallPayload): string | null {
  const args = asRecord(payload.arguments);
  const rawUrl = readString(args, "url");
  if (!rawUrl) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    return url.hostname;
  } catch {
    return null;
  }
}

function hostFromTabUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") {
      return null;
    }
    return url.protocol === "file:" ? "file:" : url.hostname;
  } catch {
    return null;
  }
}

function hostFromKnownTab(payload: ToolCallPayload, mutable: MutableHostState): string | null {
  const args = asRecord(payload.arguments);
  const tabId = readString(args, "tabId") ?? mutable.selectedTabId;
  const tab = tabId
    ? mutable.tabs.find((candidate) => candidate.id === tabId)
    : (mutable.tabs.find((candidate) => candidate.visible) ?? mutable.tabs[0]);
  return tab?.url ? hostFromTabUrl(tab.url) : null;
}

function requiresHostPermission(payload: ToolCallPayload): boolean {
  return (
    payload.tool !== "browser_list_tabs" &&
    payload.tool !== "browser_select_tab" &&
    payload.tool !== "browser_close_tab" &&
    payload.tool !== "browser_set_visibility"
  );
}

async function readRequestJson(request: NodeHttp.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_HTTP_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeadersForRequest(request),
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

function makeTokenEffect(): Effect.Effect<string> {
  return Effect.gen(function* () {
    let token = "";
    while (token.length < 64) {
      token += (yield* Random.nextUUIDv4).replaceAll("-", "");
    }
    return token.slice(0, 64);
  });
}

function buildState(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly mutable: MutableHostState;
}): DesktopBrowserExternalAutomationState {
  return {
    endpoint: input.endpoint,
    token: input.token,
    connected: input.mutable.connected,
    extensionId: input.mutable.extensionId,
    browserName: input.mutable.browserName,
    profileName: input.mutable.profileName,
    selectedTabId: input.mutable.selectedTabId,
    tabs: input.mutable.tabs,
    permissions: [...input.mutable.permissions.values()],
    lastError: input.mutable.lastError,
    lastToolCallAt: input.mutable.lastToolCallAt,
    toolCallSequence: input.mutable.toolCallSequence,
    updatedAt: input.mutable.updatedAt,
  };
}

const make = Effect.gen(function* () {
  yield* Effect.service(ElectronApp.ElectronApp).pipe(Effect.flatMap((app) => app.whenReady));
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const token = yield* makeTokenEffect();
  const mutable: MutableHostState = {
    connected: false,
    extensionId: null,
    browserName: null,
    profileName: null,
    selectedTabId: null,
    tabs: [],
    permissions: new Map(),
    lastError: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: nowIso(),
  };
  const pendingToolCalls = new Map<string, PendingToolCall>();
  const commandQueue: ExtensionCommand[] = [];
  const pollWaiters = new Set<(commands: ExtensionCommand[]) => void>();
  let endpoint = "";
  let lastExtensionSeenAt = 0;

  const currentState = () => buildState({ endpoint, token, mutable });
  const publishState = () => {
    mutable.updatedAt = nowIso();
    void Effect.runPromise(
      electronWindow.sendAll(IpcChannels.BROWSER_EXTERNAL_AUTOMATION_STATE_CHANNEL, currentState()),
    );
  };
  const enqueueCommand = (command: ExtensionCommand) => {
    commandQueue.push(command);
    for (const waiter of pollWaiters) {
      waiter(commandQueue.splice(0));
    }
    pollWaiters.clear();
  };
  const authorizeRequest = (request: NodeHttp.IncomingMessage): boolean =>
    request.headers.authorization === `Bearer ${token}`;

  const waitForCommands = () =>
    new Promise<ExtensionCommand[]>((resolve) => {
      if (commandQueue.length > 0) {
        resolve(commandQueue.splice(0));
        return;
      }
      const timeout = setTimeout(() => {
        pollWaiters.delete(waiter);
        resolve([]);
      }, POLL_TIMEOUT_MS);
      const waiter = (commands: ExtensionCommand[]) => {
        clearTimeout(timeout);
        resolve(commands);
      };
      pollWaiters.add(waiter);
    });

  const callExtensionTool = (payload: ToolCallPayload): Promise<ToolResponse> =>
    new Promise((resolve) => {
      if (!mutable.connected) {
        resolve(
          textResponse(
            "Bahew Chrome Extension is not connected. Open Bahew Plugins > Browser Use External, copy the current Endpoint and Token into the extension popup, then keep Chrome open. Re-pair after restarting Bahew.",
            false,
          ),
        );
        return;
      }

      const host = hostFromPayload(payload) ?? hostFromKnownTab(payload, mutable);
      if (host && requiresHostPermission(payload)) {
        const permission = mutable.permissions.get(host);
        if (permission?.decision === "block") {
          resolve(textResponse(`Chrome host ${host} is blocked for browser_use_external.`, false));
          return;
        }
        if (!permission) {
          resolve(
            textResponse(
              `${T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX}browser_use_external wants to use ${host}.`,
              false,
            ),
          );
          return;
        }
      }

      const id = `external-tool-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const timeout = setTimeout(() => {
        pendingToolCalls.delete(id);
        mutable.lastError = `Timed out waiting for Chrome extension result for ${payload.tool ?? ""}.`;
        publishState();
        resolve(textResponse(mutable.lastError, false));
      }, TOOL_CALL_TIMEOUT_MS);
      pendingToolCalls.set(id, {
        id,
        payload,
        createdAt: Date.now(),
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
      });
      mutable.lastToolCallAt = nowIso();
      mutable.toolCallSequence += 1;
      mutable.lastError = null;
      publishState();
      enqueueCommand({ id, type: "tool/call", payload });
    });

  const applyStateUpdate = (raw: unknown) => {
    const body = asRecord(raw);
    const tabs = Array.isArray(body.tabs) ? body.tabs : undefined;
    mutable.connected = true;
    lastExtensionSeenAt = Date.now();
    mutable.extensionId = readString(body, "extensionId") ?? mutable.extensionId;
    mutable.browserName = readString(body, "browserName") ?? mutable.browserName;
    mutable.profileName = readString(body, "profileName") ?? mutable.profileName;
    mutable.selectedTabId = readString(body, "selectedTabId") ?? mutable.selectedTabId;
    if (tabs) {
      mutable.tabs = tabs
        .map((tab) => asRecord(tab))
        .map((tab) => ({
          id: readString(tab, "id") ?? "",
          title: readString(tab, "title") ?? "",
          url: readString(tab, "url") ?? "",
          visible: tab.visible === true,
          width: typeof tab.width === "number" ? tab.width : 0,
          height: typeof tab.height === "number" ? tab.height : 0,
          canGoBack: tab.canGoBack === true,
          canGoForward: tab.canGoForward === true,
        }))
        .filter((tab) => tab.id.length > 0);
    }
    publishState();
  };

  const extensionWatchdog = setInterval(() => {
    if (!mutable.connected || Date.now() - lastExtensionSeenAt <= EXTENSION_STALE_AFTER_MS) {
      return;
    }
    mutable.connected = false;
    publishState();
  }, EXTENSION_WATCHDOG_INTERVAL_MS);

  const server = NodeHttp.createServer((request, response) => {
    void (async () => {
      try {
        if (request.method === "OPTIONS") {
          writeJson(request, response, 204, {});
          return;
        }
        if (!authorizeRequest(request)) {
          writeJson(request, response, 401, { error: "Unauthorized" });
          return;
        }

        if (request.method === "GET" && request.url === "/state") {
          writeJson(request, response, 200, currentState());
          return;
        }

        if (request.method === "POST" && request.url === "/tool-call") {
          const payload = (await readRequestJson(request)) as ToolCallPayload;
          const args = asRecord(payload.arguments);
          const confirmed = args.t3UserConfirmed === true || args.userConfirmed === true;
          const host = hostFromPayload(payload) ?? hostFromKnownTab(payload, mutable);
          if (confirmed && host) {
            mutable.permissions.set(host, {
              host,
              decision: "allow",
              scope: args.userAlwaysAllowHost === true ? "always" : "session",
              updatedAt: nowIso(),
            });
            publishState();
          }
          const result = await callExtensionTool(payload);
          writeJson(request, response, 200, result);
          return;
        }

        if (request.method === "POST" && request.url === "/permission/resolve") {
          const body = asRecord(await readRequestJson(request));
          const host = readString(body, "host");
          const decision = readString(body, "decision");
          const scope = readString(body, "scope") === "always" ? "always" : "session";
          if (!host || (decision !== "allow" && decision !== "block")) {
            writeJson(request, response, 400, {
              error: "permission/resolve requires host and decision allow/block.",
            });
            return;
          }
          mutable.permissions.set(host, {
            host,
            decision,
            scope,
            updatedAt: nowIso(),
          });
          publishState();
          writeJson(request, response, 200, { ok: true, state: currentState() });
          return;
        }

        if (request.method === "POST" && request.url === "/extension/register") {
          applyStateUpdate(await readRequestJson(request));
          writeJson(request, response, 200, { ok: true, endpoint, app: environment.displayName });
          return;
        }

        if (request.method === "POST" && request.url === "/extension/state") {
          applyStateUpdate(await readRequestJson(request));
          writeJson(request, response, 200, { ok: true });
          return;
        }

        if (request.method === "POST" && request.url === "/extension/poll") {
          applyStateUpdate(await readRequestJson(request));
          const commands = await waitForCommands();
          writeJson(request, response, 200, { commands });
          return;
        }

        if (request.method === "POST" && request.url === "/extension/result") {
          const body = asRecord(await readRequestJson(request));
          const id = readString(body, "id") ?? "";
          const pending = pendingToolCalls.get(id);
          if (!pending) {
            writeJson(request, response, 404, { error: "Unknown tool call id" });
            return;
          }
          pendingToolCalls.delete(id);
          const result = asRecord(body.result) as ToolResponse;
          pending.resolve(
            result?.contentItems ? result : textResponse("Malformed extension result.", false),
          );
          writeJson(request, response, 200, { ok: true });
          return;
        }

        writeJson(request, response, 404, { error: "Not found" });
      } catch (error) {
        const message = normalizeError(error);
        mutable.lastError = message;
        publishState();
        writeJson(request, response, 500, { error: message });
      }
    })();
  });

  const address = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<AddressInfo>((resolve, reject) => {
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (typeof address === "string" || address === null) {
              reject(new Error("External browser automation host did not bind to a TCP port."));
              return;
            }
            resolve(address);
          });
          server.once("error", reject);
        }),
    ),
    () =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const pending of pendingToolCalls.values()) {
              pending.resolve(textResponse("External browser host is shutting down.", false));
            }
            pendingToolCalls.clear();
            for (const waiter of pollWaiters) {
              waiter([]);
            }
            pollWaiters.clear();
            clearInterval(extensionWatchdog);
            server.close(() => resolve());
          }),
      ),
  );
  endpoint = `http://127.0.0.1:${address.port}`;
  publishState();

  return DesktopBrowserExternalAutomationHost.of({
    endpoint,
    token,
    state: Effect.sync(currentState),
  });
});

export const layer = Layer.effect(DesktopBrowserExternalAutomationHost, make);
