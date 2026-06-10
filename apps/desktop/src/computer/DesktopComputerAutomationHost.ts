// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off globalDate:off globalRandom:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodeHttp from "node:http";
import type { AddressInfo } from "node:net";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

export interface DesktopComputerAutomationRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopComputerAutomationPoint {
  readonly x: number;
  readonly y: number;
}

export interface DesktopComputerAutomationForegroundWindow {
  readonly title: string;
  readonly processId: number | null;
  readonly processName: string | null;
}

export interface DesktopComputerAutomationAppPermission {
  readonly appKey: string;
  readonly displayName: string;
  readonly processName: string | null;
  readonly title: string | null;
  readonly allowedAt: string;
  readonly lastUsedAt: string | null;
}

export interface DesktopComputerAutomationState {
  readonly endpoint: string;
  readonly platform: string;
  readonly available: boolean;
  readonly paused: boolean;
  readonly allowedApps: ReadonlyArray<DesktopComputerAutomationAppPermission>;
  readonly virtualScreen: DesktopComputerAutomationRect | null;
  readonly cursor: DesktopComputerAutomationPoint | null;
  readonly foregroundWindow: DesktopComputerAutomationForegroundWindow | null;
  readonly lastAction: string | null;
  readonly lastError: string | null;
  readonly lastScreenshotDataUrl: string | null;
  readonly lastScreenshotPath: string | null;
  readonly lastToolCallAt: string | null;
  readonly toolCallSequence: number;
  readonly updatedAt: string;
}

export interface DesktopComputerAutomationHostShape {
  readonly endpoint: string;
  readonly token: string;
  readonly state: Effect.Effect<DesktopComputerAutomationState>;
  readonly setPaused: (paused: boolean) => Effect.Effect<DesktopComputerAutomationState>;
  readonly allowForegroundApp: () => Effect.Effect<DesktopComputerAutomationState>;
  readonly removeAppPermission: (appKey: string) => Effect.Effect<DesktopComputerAutomationState>;
  readonly clearAppPermissions: () => Effect.Effect<DesktopComputerAutomationState>;
}

export class DesktopComputerAutomationHost extends Context.Service<
  DesktopComputerAutomationHost,
  DesktopComputerAutomationHostShape
>()("t3/desktop/computer/AutomationHost") {}

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

type HelperRequest = {
  readonly id: string;
  readonly command: string;
  readonly arguments?: Record<string, unknown>;
};

type HelperResponse = {
  readonly id?: string;
  readonly ok?: boolean;
  readonly result?: unknown;
  readonly error?: unknown;
};

interface MutableHostState {
  available: boolean;
  paused: boolean;
  allowedApps: Map<string, DesktopComputerAutomationAppPermission>;
  virtualScreen: DesktopComputerAutomationRect | null;
  cursor: DesktopComputerAutomationPoint | null;
  foregroundWindow: DesktopComputerAutomationForegroundWindow | null;
  lastAction: string | null;
  lastError: string | null;
  lastScreenshotDataUrl: string | null;
  lastScreenshotPath: string | null;
  lastToolCallAt: string | null;
  toolCallSequence: number;
  updatedAt: string;
}

interface HelperProcess {
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly pending: Map<
    string,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >;
}

const NAMESPACE = "t3_computer";
const CONFIRMATION_REQUIRED_PREFIX = "T3_COMPUTER_CONFIRMATION_REQUIRED:";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const INPUT_TOOLS = new Set([
  "computer_click",
  "computer_double_click",
  "computer_drag",
  "computer_scroll",
  "computer_type",
  "computer_press",
  "computer_hotkey",
]);
const ACTION_TOOLS = new Set([...INPUT_TOOLS, "computer_move_mouse"]);

function nowIso(): string {
  return new Date().toISOString();
}

function textResponse(text: string, success = true): ToolResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function imageResponse(imageUrl: string, text: string): ToolResponse {
  return {
    success: true,
    contentItems: [
      { type: "inputImage", imageUrl },
      { type: "inputText", text },
    ],
  };
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

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
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
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response: NodeHttp.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function rectFromUnknown(value: unknown): DesktopComputerAutomationRect | null {
  const record = asRecord(value);
  const x = readNumber(record, "x");
  const y = readNumber(record, "y");
  const width = readNumber(record, "width");
  const height = readNumber(record, "height");
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? null
    : { x, y, width, height };
}

function pointFromUnknown(value: unknown): DesktopComputerAutomationPoint | null {
  const record = asRecord(value);
  const x = readNumber(record, "x");
  const y = readNumber(record, "y");
  return x === undefined || y === undefined ? null : { x, y };
}

function foregroundFromUnknown(value: unknown): DesktopComputerAutomationForegroundWindow | null {
  const record = asRecord(value);
  const title = readString(record, "title") ?? "";
  const processName = readString(record, "processName") ?? null;
  const processId = readNumber(record, "processId") ?? null;
  return { title, processId, processName };
}

function normalizeProcessName(processName: string | null | undefined): string {
  return (processName ?? "").trim().toLowerCase().replace(/\.exe$/, "");
}

function displayNameForForeground(
  foreground: DesktopComputerAutomationForegroundWindow | null,
): string {
  const processName = foreground?.processName?.trim();
  const title = foreground?.title?.trim();
  return processName || title || "Unknown app";
}

function appKeyForForeground(
  foreground: DesktopComputerAutomationForegroundWindow | null,
): string | null {
  const processName = normalizeProcessName(foreground?.processName);
  if (processName) return `process:${processName}`;
  const title = foreground?.title?.trim().toLowerCase();
  if (title) return `title:${title.slice(0, 120)}`;
  return null;
}

function permissionFromForeground(
  foreground: DesktopComputerAutomationForegroundWindow | null,
  now = nowIso(),
): DesktopComputerAutomationAppPermission | null {
  const appKey = appKeyForForeground(foreground);
  if (!appKey) return null;
  return {
    appKey,
    displayName: displayNameForForeground(foreground),
    processName: foreground?.processName ?? null,
    title: foreground?.title ?? null,
    allowedAt: now,
    lastUsedAt: null,
  };
}

function protectedForegroundReason(
  foreground: DesktopComputerAutomationForegroundWindow | null,
): string | null {
  const processName = normalizeProcessName(foreground?.processName);
  const title = (foreground?.title ?? "").toLowerCase();
  const terminalProcesses = new Set([
    "cmd",
    "powershell",
    "pwsh",
    "windowsterminal",
    "wt",
    "conhost",
    "openconsole",
    "bash",
    "wsl",
  ]);
  if (terminalProcesses.has(processName)) {
    return "computer_use cannot automate terminal applications because that could bypass T3 Code safety controls.";
  }
  const looksLikeSelf =
    processName.includes("t3code") ||
    processName.includes("codex") ||
    (processName === "electron" && (title.includes("t3 code") || title.includes("codex")));
  if (looksLikeSelf) {
    return "computer_use cannot automate T3 Code or Codex itself because that could bypass safety controls.";
  }
  return null;
}

const make = Effect.gen(function* () {
  yield* Effect.service(ElectronApp.ElectronApp).pipe(Effect.flatMap((app) => app.whenReady));
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const token = yield* makeTokenEffect();
  const screenshotDir = NodePath.join(environment.stateDir, "computer-use");
  const permissionsPath = NodePath.join(screenshotDir, "app-permissions.json");
  yield* fileSystem.makeDirectory(screenshotDir, { recursive: true }).pipe(Effect.ignore);

  let endpoint = "";
  let helper: HelperProcess | null = null;
  let helperSequence = 0;
  const mutable: MutableHostState = {
    available: environment.platform === "win32",
    paused: false,
    allowedApps: new Map(),
    virtualScreen: null,
    cursor: null,
    foregroundWindow: null,
    lastAction: null,
    lastError:
      environment.platform === "win32" ? null : "computer_use is only implemented on Windows.",
    lastScreenshotDataUrl: null,
    lastScreenshotPath: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: nowIso(),
  };

  const currentState = (): DesktopComputerAutomationState => ({
    endpoint,
    platform: environment.platform,
    available: mutable.available,
    paused: mutable.paused,
    allowedApps: [...mutable.allowedApps.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    ),
    virtualScreen: mutable.virtualScreen,
    cursor: mutable.cursor,
    foregroundWindow: mutable.foregroundWindow,
    lastAction: mutable.lastAction,
    lastError: mutable.lastError,
    lastScreenshotDataUrl: mutable.lastScreenshotDataUrl,
    lastScreenshotPath: mutable.lastScreenshotPath,
    lastToolCallAt: mutable.lastToolCallAt,
    toolCallSequence: mutable.toolCallSequence,
    updatedAt: mutable.updatedAt,
  });

  const publishState = () => {
    mutable.updatedAt = nowIso();
    void Effect.runPromise(
      electronWindow.sendAll(IpcChannels.COMPUTER_AUTOMATION_STATE_CHANNEL, currentState()),
    );
  };

  const persistPermissions = async () => {
    const payload = JSON.stringify([...mutable.allowedApps.values()], null, 2);
    await NodeFs.writeFile(permissionsPath, payload, "utf8");
  };

  const loadPermissions = async () => {
    try {
      const raw = await NodeFs.readFile(permissionsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        const record = asRecord(entry);
        const appKey = readString(record, "appKey");
        const displayName = readString(record, "displayName");
        const allowedAt = readString(record, "allowedAt");
        if (!appKey || !displayName || !allowedAt) continue;
        mutable.allowedApps.set(appKey, {
          appKey,
          displayName,
          processName: readString(record, "processName") ?? null,
          title: readString(record, "title") ?? null,
          allowedAt,
          lastUsedAt: readString(record, "lastUsedAt") ?? null,
        });
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        mutable.lastError = normalizeError(error);
      }
    }
  };

  yield* Effect.promise(loadPermissions);

  const resolveHelperPath = async (): Promise<string> => {
    for (const candidate of environment.resolveResourcePathCandidates(
      "computer-use/windows-helper.ps1",
    )) {
      if (
        await Effect.runPromise(
          fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false)),
        )
      ) {
        return candidate;
      }
    }
    throw new Error("Windows computer_use helper was not found.");
  };

  const stopHelper = () => {
    const existing = helper;
    helper = null;
    if (!existing) return;
    for (const pending of existing.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Computer helper stopped."));
    }
    existing.pending.clear();
    existing.child.kill();
  };

  const ensureHelper = async (): Promise<HelperProcess> => {
    if (environment.platform !== "win32") {
      throw new Error("computer_use is only implemented on Windows.");
    }
    if (helper && !helper.child.killed) {
      return helper;
    }

    const helperPath = await resolveHelperPath();
    const child = NodeChildProcess.spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const next: HelperProcess = { child, pending: new Map() };
    helper = next;
    const lines = NodeReadline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let payload: HelperResponse;
      try {
        payload = JSON.parse(line) as HelperResponse;
      } catch {
        return;
      }
      const id = typeof payload.id === "string" ? payload.id : undefined;
      if (!id) return;
      const pending = next.pending.get(id);
      if (!pending) return;
      next.pending.delete(id);
      clearTimeout(pending.timeout);
      if (payload.ok === true) {
        pending.resolve(payload.result);
      } else {
        pending.reject(new Error(String(payload.error ?? "Computer helper failed.")));
      }
    });
    child.stderr.on("data", (chunk) => {
      mutable.lastError = String(chunk).trim() || mutable.lastError;
      publishState();
    });
    child.once("exit", () => {
      if (helper === next) helper = null;
      for (const pending of next.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Computer helper exited."));
      }
      next.pending.clear();
    });
    child.once("error", (error) => {
      if (helper === next) helper = null;
      for (const pending of next.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      next.pending.clear();
    });
    return next;
  };

  const requestHelper = async (
    command: string,
    args: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> => {
    const running = await ensureHelper();
    const id = `computer-${++helperSequence}`;
    const request: HelperRequest = { id, command, arguments: args };
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        running.pending.delete(id);
        reject(new Error(`Computer helper command ${command} timed out.`));
      }, timeoutMs);
      running.pending.set(id, { resolve, reject, timeout });
      running.child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
        if (!error) return;
        running.pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      });
    });
  };

  const applyHelperState = (result: unknown) => {
    const record = asRecord(result);
    mutable.virtualScreen = rectFromUnknown(record.virtualScreen) ?? mutable.virtualScreen;
    mutable.cursor = pointFromUnknown(record.cursor) ?? mutable.cursor;
    mutable.foregroundWindow =
      foregroundFromUnknown(record.foregroundWindow) ?? mutable.foregroundWindow;
    mutable.available = environment.platform === "win32";
    mutable.lastError = null;
  };

  const runStateRefresh = async () => {
    const result = await requestHelper("state");
    applyHelperState(result);
    publishState();
    return currentState();
  };

  const markToolActivity = (tool: string) => {
    mutable.toolCallSequence += 1;
    mutable.lastToolCallAt = nowIso();
    mutable.lastAction = tool;
  };

  const allowForegroundApp = async () => {
    const result = await requestHelper("state");
    applyHelperState(result);
    const permission = permissionFromForeground(mutable.foregroundWindow);
    if (!permission) {
      throw new Error("No foreground app is available to allow.");
    }
    mutable.allowedApps.set(permission.appKey, permission);
    await persistPermissions();
    publishState();
    return currentState();
  };

  const touchForegroundPermission = async (
    foreground: DesktopComputerAutomationForegroundWindow | null,
  ) => {
    const appKey = appKeyForForeground(foreground);
    if (!appKey) return;
    const existing = mutable.allowedApps.get(appKey);
    if (!existing) return;
    mutable.allowedApps.set(appKey, { ...existing, lastUsedAt: nowIso() });
    await persistPermissions();
  };

  const shouldRequireConfirmation = async (
    tool: string,
    args: Record<string, unknown>,
  ): Promise<string | undefined> => {
    const runtimeMode = readString(args, "runtimeMode");
    const userConfirmed = readBoolean(args, "userConfirmed") === true;
    const userAlwaysAllowApp = readBoolean(args, "userAlwaysAllowApp") === true;
    if (!INPUT_TOOLS.has(tool) || userConfirmed) {
      if (INPUT_TOOLS.has(tool) && userAlwaysAllowApp) {
        await allowForegroundApp();
      }
      return undefined;
    }
    try {
      const result = await requestHelper("state");
      applyHelperState(result);
    } catch {
      // Fall through to confirmation when foreground context is unavailable.
    }
    const protectedReason = protectedForegroundReason(mutable.foregroundWindow);
    if (protectedReason) {
      throw new Error(protectedReason);
    }
    const foregroundAppKey = appKeyForForeground(mutable.foregroundWindow);
    if (foregroundAppKey && mutable.allowedApps.has(foregroundAppKey)) {
      await touchForegroundPermission(mutable.foregroundWindow);
      return undefined;
    }
    if (runtimeMode === "approval-required") {
      return `computer_use wants to run ${tool} in ${displayNameForForeground(mutable.foregroundWindow)}.`;
    }
    return `computer_use wants to use ${displayNameForForeground(mutable.foregroundWindow)} for ${tool}.`;
  };

  const handleToolCall = async (payload: ToolCallPayload): Promise<ToolResponse> => {
    if (payload.namespace !== NAMESPACE) {
      return textResponse(`Unsupported namespace: ${payload.namespace ?? ""}`, false);
    }
    const tool = payload.tool;
    if (!tool) {
      return textResponse("Missing computer tool name.", false);
    }
    const args = asRecord(payload.arguments);
    markToolActivity(tool);
    try {
      if (environment.platform !== "win32") {
        throw new Error("computer_use is only implemented on Windows.");
      }
      if (mutable.paused && ACTION_TOOLS.has(tool)) {
        return textResponse("computer_use is paused by the user.", false);
      }
      if (INPUT_TOOLS.has(tool)) {
        const result = await requestHelper("state");
        applyHelperState(result);
        const protectedReason = protectedForegroundReason(mutable.foregroundWindow);
        if (protectedReason) {
          return textResponse(protectedReason, false);
        }
      }
      const confirmationMessage = await shouldRequireConfirmation(tool, args);
      if (confirmationMessage) {
        return textResponse(`${CONFIRMATION_REQUIRED_PREFIX}${confirmationMessage}`, false);
      }

      switch (tool) {
        case "computer_state": {
          const state = await runStateRefresh();
          return textResponse(JSON.stringify(state, null, 2));
        }
        case "computer_screenshot": {
          const filePath = NodePath.join(screenshotDir, `desktop-${Date.now()}.png`);
          const result = await requestHelper("screenshot", { path: filePath }, DEFAULT_TIMEOUT_MS);
          applyHelperState(result);
          const png = await NodeFs.readFile(filePath);
          const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
          mutable.lastScreenshotDataUrl = dataUrl;
          mutable.lastScreenshotPath = filePath;
          publishState();
          return imageResponse(
            dataUrl,
            `Screenshot captured: ${filePath}\n${JSON.stringify(result, null, 2)}`,
          );
        }
        case "computer_move_mouse": {
          const x = readNumber(args, "x");
          const y = readNumber(args, "y");
          if (x === undefined || y === undefined) {
            return textResponse("computer_move_mouse requires x and y.", false);
          }
          applyHelperState(await requestHelper("moveMouse", { x, y }));
          publishState();
          return textResponse(`Moved mouse to ${x},${y}`);
        }
        case "computer_click":
        case "computer_double_click": {
          const cursor =
            mutable.cursor ?? pointFromUnknown(asRecord(await requestHelper("state")).cursor);
          const x = readNumber(args, "x") ?? cursor?.x;
          const y = readNumber(args, "y") ?? cursor?.y;
          if (x === undefined || y === undefined)
            return textResponse(`${tool} requires x and y.`, false);
          const button = readString(args, "button") ?? "left";
          applyHelperState(
            await requestHelper("click", {
              x,
              y,
              button,
              count: tool === "computer_double_click" ? 2 : 1,
            }),
          );
          publishState();
          return textResponse(
            `${tool === "computer_double_click" ? "Double-clicked" : "Clicked"} ${button} at ${x},${y}`,
          );
        }
        case "computer_drag": {
          const fromX = readNumber(args, "fromX");
          const fromY = readNumber(args, "fromY");
          const toX = readNumber(args, "toX");
          const toY = readNumber(args, "toY");
          if (
            fromX === undefined ||
            fromY === undefined ||
            toX === undefined ||
            toY === undefined
          ) {
            return textResponse("computer_drag requires fromX, fromY, toX, and toY.", false);
          }
          const durationMs = Math.max(80, Math.min(5000, readNumber(args, "durationMs") ?? 500));
          applyHelperState(
            await requestHelper("drag", { fromX, fromY, toX, toY, durationMs }, durationMs + 5000),
          );
          publishState();
          return textResponse(`Dragged from ${fromX},${fromY} to ${toX},${toY}`);
        }
        case "computer_scroll": {
          const cursor =
            mutable.cursor ?? pointFromUnknown(asRecord(await requestHelper("state")).cursor);
          const x = readNumber(args, "x") ?? cursor?.x;
          const y = readNumber(args, "y") ?? cursor?.y;
          if (x === undefined || y === undefined)
            return textResponse("computer_scroll requires x and y.", false);
          const deltaX = readNumber(args, "deltaX") ?? 0;
          const deltaY = readNumber(args, "deltaY") ?? -600;
          applyHelperState(await requestHelper("scroll", { x, y, deltaX, deltaY }));
          publishState();
          return textResponse(`Scrolled at ${x},${y}`);
        }
        case "computer_type": {
          const text = readString(args, "text");
          if (text === undefined) return textResponse("computer_type requires text.", false);
          applyHelperState(await requestHelper("type", { text }));
          publishState();
          return textResponse(`Typed ${text.length} characters.`);
        }
        case "computer_press": {
          const key = readString(args, "key");
          if (!key) return textResponse("computer_press requires key.", false);
          applyHelperState(await requestHelper("press", { key }));
          publishState();
          return textResponse(`Pressed ${key}`);
        }
        case "computer_hotkey": {
          const keys = readStringArray(args, "keys");
          if (!keys || keys.length === 0)
            return textResponse("computer_hotkey requires keys.", false);
          applyHelperState(await requestHelper("hotkey", { keys }));
          publishState();
          return textResponse(`Pressed hotkey ${keys.join("+")}`);
        }
        case "computer_wait": {
          const durationMs = Math.max(0, Math.min(30_000, readNumber(args, "durationMs") ?? 1000));
          await new Promise((resolve) => setTimeout(resolve, durationMs));
          publishState();
          return textResponse(`Waited ${durationMs}ms`);
        }
        default:
          return textResponse(`Unsupported T3 computer tool: ${tool}`, false);
      }
    } catch (error) {
      mutable.lastError = normalizeError(error);
      publishState();
      return textResponse(mutable.lastError, false);
    }
  };

  const server = NodeHttp.createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== "POST" || request.url !== "/tool-call") {
          writeJson(response, 404, { error: "Not found" });
          return;
        }
        if (request.headers.authorization !== `Bearer ${token}`) {
          writeJson(response, 401, { error: "Unauthorized" });
          return;
        }
        const payload = (await readRequestJson(request)) as ToolCallPayload;
        writeJson(response, 200, await handleToolCall(payload));
      } catch (error) {
        writeJson(response, 500, { error: normalizeError(error) });
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
              reject(new Error("Computer automation host did not bind to a TCP port."));
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
            stopHelper();
            server.close(() => resolve());
          }),
      ),
  );
  endpoint = `http://127.0.0.1:${address.port}`;
  publishState();

  return DesktopComputerAutomationHost.of({
    endpoint,
    token,
    state: Effect.sync(currentState),
    setPaused: (paused) =>
      Effect.sync(() => {
        mutable.paused = paused;
        publishState();
        return currentState();
      }),
    allowForegroundApp: () => Effect.promise(allowForegroundApp),
    removeAppPermission: (appKey) =>
      Effect.promise(async () => {
        mutable.allowedApps.delete(appKey);
        await persistPermissions();
        publishState();
        return currentState();
      }),
    clearAppPermissions: () =>
      Effect.promise(async () => {
        mutable.allowedApps.clear();
        await persistPermissions();
        publishState();
        return currentState();
      }),
  });
});

export const layer = Layer.effect(DesktopComputerAutomationHost, make);
