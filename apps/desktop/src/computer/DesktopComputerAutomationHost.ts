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

export interface DesktopComputerAutomationWindow extends DesktopComputerAutomationForegroundWindow {
  readonly id: string;
  readonly app?: string | null;
  readonly bounds: DesktopComputerAutomationRect | null;
  readonly visible: boolean;
  readonly isMinimized?: boolean;
  readonly isProtected: boolean;
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
  readonly selectedWindow: DesktopComputerAutomationWindow | null;
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
  readonly approvalRequest?: unknown;
};

interface MutableHostState {
  available: boolean;
  paused: boolean;
  allowedApps: Map<string, DesktopComputerAutomationAppPermission>;
  virtualScreen: DesktopComputerAutomationRect | null;
  cursor: DesktopComputerAutomationPoint | null;
  foregroundWindow: DesktopComputerAutomationForegroundWindow | null;
  selectedWindow: DesktopComputerAutomationWindow | null;
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

type CodexComputerUseResponse = {
  readonly id?: number | string;
  readonly ok?: boolean;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly approvalRequest?: unknown;
};

const NAMESPACE = "t3_computer";
const CONFIRMATION_REQUIRED_PREFIX = "T3_COMPUTER_CONFIRMATION_REQUIRED:";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const INPUT_TOOLS = new Set([
  "computer_click",
  "computer_click_element",
  "computer_click_window",
  "computer_double_click",
  "computer_double_click_window",
  "computer_drag",
  "computer_drag_window",
  "computer_scroll",
  "computer_scroll_window",
  "computer_type",
  "computer_type_window",
  "computer_press",
  "computer_press_window",
  "computer_hotkey",
  "computer_hotkey_window",
  "computer_set_value",
  "computer_perform_secondary_action",
]);
const ACTION_TOOLS = new Set([
  ...INPUT_TOOLS,
  "computer_activate_window",
  "computer_focus_app",
  "computer_move_mouse",
  "computer_move_mouse_window",
]);

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

function imageAndTextResponse(imageUrl: string | null, text: string): ToolResponse {
  return imageUrl ? imageResponse(imageUrl, text) : textResponse(text);
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

function readBooleanAlias(
  args: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): boolean | undefined {
  return readBoolean(args, camelKey) ?? readBoolean(args, snakeKey);
}

function readStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function readElementIndex(args: Record<string, unknown>): number | undefined {
  return readNumber(args, "element_index") ?? readNumber(args, "elementIndex");
}

function readWindowId(
  args: Record<string, unknown>,
  selectedWindow: DesktopComputerAutomationWindow | null,
): string | undefined {
  return readString(args, "windowId") ?? readString(args, "id") ?? selectedWindow?.id;
}

function sanitizeScreenshotText(result: unknown, imageUrl?: string): unknown {
  const record = { ...asRecord(result) };
  const screenshot = asRecord(record.screenshot);
  if (Object.keys(screenshot).length > 0) {
    record.screenshot = {
      ...screenshot,
      url: imageUrl ? "<inputImage content item>" : screenshot.url,
    };
    record.screenshots = [
      {
        id: readString(screenshot, "id") ?? "window-0",
        zIndex: readNumber(screenshot, "zIndex") ?? 0,
        url: imageUrl ? "<inputImage content item>" : readString(screenshot, "url"),
        originX: readNumber(screenshot, "originX"),
        originY: readNumber(screenshot, "originY"),
        width: readNumber(screenshot, "width"),
        height: readNumber(screenshot, "height"),
        captureMethod: readString(screenshot, "captureMethod"),
        fallbackReason: readString(screenshot, "fallbackReason"),
      },
    ];
  }
  return record;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function userProfileHome(): string | null {
  return process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || null;
}

function parseDataUrlBytes(dataUrl: string): Buffer | null {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
  const payload = match?.[1];
  return payload ? Buffer.from(payload, "base64") : null;
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

function windowFromUnknown(value: unknown): DesktopComputerAutomationWindow | null {
  const record = asRecord(value);
  const id = readString(record, "id");
  if (!id) return null;
  const app = readString(record, "app") ?? null;
  const title = readString(record, "title") ?? "";
  const processName = readString(record, "processName") ?? null;
  const processId = readNumber(record, "processId") ?? null;
  const visible = readBoolean(record, "visible") ?? true;
  const isMinimized = readBoolean(record, "isMinimized") ?? false;
  const isProtected = readBoolean(record, "isProtected") ?? false;
  return {
    id,
    app,
    title,
    processId,
    processName,
    bounds: rectFromUnknown(record.bounds),
    visible,
    isMinimized,
    isProtected,
  };
}

function normalizeProcessName(processName: string | null | undefined): string {
  return (processName ?? "").trim().toLowerCase().replace(/\.exe$/, "");
}

function compactProcessName(processName: string | null | undefined): string {
  return normalizeProcessName(processName).replace(/[\s_-]+/g, "");
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

function isWindowScopedTool(tool: string): boolean {
  return (
    tool.endsWith("_window") ||
    tool === "computer_activate_window" ||
    tool === "computer_click_element" ||
    tool === "computer_set_value" ||
    tool === "computer_perform_secondary_action"
  );
}

function protectedForegroundReason(
  foreground: DesktopComputerAutomationForegroundWindow | null,
  options?: { readonly attemptedT3WindowYield?: boolean },
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
    compactProcessName(processName).includes("t3code") ||
    processName.includes("codex") ||
    (processName === "electron" && (title.includes("t3 code") || title.includes("codex")));
  if (looksLikeSelf) {
    if (options?.attemptedT3WindowYield) {
      return "computer_use moved the T3 Code window out of the way, but the active foreground window is still T3 Code. Bring the target app to the foreground or make it visible, then retry.";
    }
    return "computer_use cannot automate T3 Code or Codex itself because that could bypass safety controls.";
  }
  return null;
}

function isT3OrCodexForeground(
  foreground: DesktopComputerAutomationForegroundWindow | null,
): boolean {
  const processName = normalizeProcessName(foreground?.processName);
  const compactName = compactProcessName(processName);
  const title = (foreground?.title ?? "").toLowerCase();
  return (
    compactName.includes("t3code") ||
    processName.includes("codex") ||
    (processName === "electron" && (title.includes("t3 code") || title.includes("codex")))
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    selectedWindow: null,
    lastAction: null,
    lastError:
      environment.platform === "win32" ? null : "computer_use is only implemented on Windows.",
    lastScreenshotDataUrl: null,
    lastScreenshotPath: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: nowIso(),
  };
  let attemptedT3WindowYieldForCurrentTool = false;
  let lastAllowableForegroundWindow: DesktopComputerAutomationForegroundWindow | null = null;

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
    selectedWindow: mutable.selectedWindow,
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

  const resolveCodexComputerUseHelperPath = async (): Promise<string | null> => {
    const candidates = [
      ...environment.resolveResourcePathCandidates("computer-use/codex-computer-use.exe"),
      ...environment.resolveResourcePathCandidates("computer-use/bin/windows/codex-computer-use.exe"),
    ];
    const home = userProfileHome();
    if (home) {
      const bundledRoot = NodePath.join(
        home,
        ".codex",
        "plugins",
        "cache",
        "openai-bundled",
        "computer-use",
      );
      try {
        const entries = await NodeFs.readdir(bundledRoot, { withFileTypes: true });
        for (const entry of entries
          .filter((item) => item.isDirectory())
          .map((item) => item.name)
          .sort()
          .reverse()) {
          candidates.push(
            NodePath.join(
              bundledRoot,
              entry,
              "node_modules",
              "@oai",
              "sky",
              "bin",
              "windows",
              "codex-computer-use.exe",
            ),
          );
        }
      } catch {
        // Official Codex plugin cache is optional.
      }
    }
    for (const candidate of candidates) {
      try {
        await NodeFs.access(candidate);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };

  const requestCodexComputerUseHelper = async (
    method: string,
    params: Record<string, unknown>,
    approvedApp: string | null,
    timeoutMs = 12_000,
  ): Promise<unknown> => {
    const helperPath = await resolveCodexComputerUseHelperPath();
    if (!helperPath) {
      throw new Error("Codex Windows.Graphics.Capture helper is not installed.");
    }
    const child = NodeChildProcess.spawn(helperPath, ["--parent-pid", String(process.pid)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const request = {
      id: 1,
      method,
      params,
      ...(approvedApp ? { meta: { "x-oai-cua-approved-app": approvedApp } } : {}),
    };
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exit = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Codex WGC helper timed out during ${method}.`));
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`, "utf8");
    await exit;

    const line = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1);
    if (!line) {
      throw new Error(
        stderr.trim()
          ? `Codex WGC helper returned no response: ${stderr.trim()}`
          : "Codex WGC helper returned no response.",
      );
    }
    const response = JSON.parse(line) as CodexComputerUseResponse;
    if (response.ok === true) {
      return response.result;
    }
    const approval = asRecord(response.approvalRequest);
    const approvalDisplayName = readString(approval, "displayName") ?? readString(approval, "app");
    if (approvalDisplayName) {
      throw new Error(`Codex WGC helper requested approval for ${approvalDisplayName}.`);
    }
    throw new Error(String(response.error ?? "Codex WGC helper failed."));
  };

  const tryCaptureWindowWithCodexWgc = async (
    window: DesktopComputerAutomationWindow | null,
    filePath: string,
  ): Promise<{ readonly result: unknown; readonly dataUrl: string; readonly filePath: string } | null> => {
    if (!window?.app || !isNonEmptyString(window.id)) {
      return null;
    }
    const numericWindowId = Number(window.id);
    if (!Number.isInteger(numericWindowId) || numericWindowId < 0) {
      return null;
    }
    const result = await requestCodexComputerUseHelper(
      "get_window_state",
      {
        window: { app: window.app, id: numericWindowId },
        include_screenshot: true,
        include_text: false,
      },
      window.app,
    );
    const screenshots = asRecord(result).screenshots;
    const firstScreenshot = Array.isArray(screenshots) ? asRecord(screenshots[0]) : {};
    const screenshotUrl = readString(firstScreenshot, "url");
    if (!screenshotUrl) {
      throw new Error("Codex WGC helper did not return a screenshot URL.");
    }
    const bytes = parseDataUrlBytes(screenshotUrl);
    if (!bytes) {
      throw new Error("Codex WGC helper returned a non-PNG screenshot URL.");
    }
    await NodeFs.writeFile(filePath, bytes);
    return {
      result: {
        ...asRecord(result),
        screenshot: {
          path: filePath,
          id: readString(firstScreenshot, "id") ?? "window-0",
          zIndex: readNumber(firstScreenshot, "zIndex") ?? 0,
          originX: readNumber(firstScreenshot, "originX"),
          originY: readNumber(firstScreenshot, "originY"),
          width: readNumber(firstScreenshot, "width"),
          height: readNumber(firstScreenshot, "height"),
          scaleFactor: 1,
          coordinateSpace: "window",
          captureMethod: "windowsGraphicsCapture",
          source: "codex-computer-use",
        },
      },
      dataUrl: screenshotUrl,
      filePath,
    };
  };

  const mergeWgcResult = (
    fallbackResult: unknown,
    wgcResult: unknown,
    fallbackReason?: string,
  ): unknown => {
    const fallbackRecord = asRecord(fallbackResult);
    const wgcRecord = asRecord(wgcResult);
    return {
      ...fallbackRecord,
      ...wgcRecord,
      selectedWindow: fallbackRecord.selectedWindow ?? wgcRecord.window,
      window: fallbackRecord.selectedWindow ?? wgcRecord.window,
      screenshot: {
        ...asRecord(fallbackRecord.screenshot),
        ...asRecord(wgcRecord.screenshot),
        ...(fallbackReason ? { fallbackReason } : {}),
      },
    };
  };

  const withScreenshotFallbackReason = (result: unknown, fallbackReason: string): unknown => {
    const record = asRecord(result);
    const screenshot = asRecord(record.screenshot);
    return {
      ...record,
      screenshot: {
        ...screenshot,
        captureMethod: readString(screenshot, "captureMethod") ?? "printWindow",
        fallbackReason,
      },
    };
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
    const nextForeground = foregroundFromUnknown(record.foregroundWindow);
    const nextSelectedWindow = windowFromUnknown(record.selectedWindow);
    mutable.virtualScreen = rectFromUnknown(record.virtualScreen) ?? mutable.virtualScreen;
    mutable.cursor = pointFromUnknown(record.cursor) ?? mutable.cursor;
    mutable.foregroundWindow = nextForeground ?? mutable.foregroundWindow;
    mutable.selectedWindow = nextSelectedWindow ?? mutable.selectedWindow;
    if (nextForeground && !protectedForegroundReason(nextForeground)) {
      lastAllowableForegroundWindow = nextForeground;
    }
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

  const minimizeT3WindowsForComputerUse = async () => {
    await Effect.runPromise(
      electronWindow.syncAllAppearance((window) =>
        Effect.sync(() => {
          if (window.isDestroyed() || window.isMinimized()) {
            return;
          }
          window.minimize();
        }),
      ),
    );
  };

  const refreshForegroundAfterT3Yield = async () => {
    attemptedT3WindowYieldForCurrentTool = false;
    const result = await requestHelper("state");
    applyHelperState(result);
    if (!isT3OrCodexForeground(mutable.foregroundWindow)) {
      return;
    }

    attemptedT3WindowYieldForCurrentTool = true;
    mutable.lastAction = "computer_yield_t3_window";
    publishState();
    await minimizeT3WindowsForComputerUse();
    await delay(350);

    const refreshed = await requestHelper("state");
    applyHelperState(refreshed);
    publishState();
  };

  const allowForegroundApp = async () => {
    const result = await requestHelper("state");
    applyHelperState(result);
    const candidate = protectedForegroundReason(mutable.foregroundWindow)
      ? lastAllowableForegroundWindow
      : mutable.foregroundWindow;
    const permission = permissionFromForeground(candidate);
    if (!permission) {
      throw new Error(
        "No target app is available to allow. Bring the target app to the foreground, or mention it with @AppName so computer_use can focus it first.",
      );
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

  const allowAutomationTarget = async (
    target: DesktopComputerAutomationForegroundWindow | null,
  ) => {
    const permission = permissionFromForeground(target);
    if (!permission) {
      throw new Error("No target app is available to allow.");
    }
    mutable.allowedApps.set(permission.appKey, permission);
    await persistPermissions();
  };

  const resolveWindowTarget = async (
    args: Record<string, unknown>,
  ): Promise<DesktopComputerAutomationWindow | null> => {
    const windowId = readWindowId(args, mutable.selectedWindow);
    if (!windowId) return mutable.selectedWindow;
    const result = await requestHelper("selectWindow", { windowId });
    applyHelperState(result);
    return mutable.selectedWindow;
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
        const target = isWindowScopedTool(tool)
          ? await resolveWindowTarget(args)
          : mutable.foregroundWindow;
        await allowAutomationTarget(target);
      }
      return undefined;
    }
    const confirmationTarget =
      isWindowScopedTool(tool) ? await resolveWindowTarget(args) : mutable.foregroundWindow;
    if (!confirmationTarget) {
      try {
        await refreshForegroundAfterT3Yield();
      } catch {
        // Fall through to confirmation when foreground context is unavailable.
      }
    }
    const target = confirmationTarget ?? mutable.foregroundWindow;
    const protectedReason = protectedForegroundReason(target, {
      attemptedT3WindowYield: attemptedT3WindowYieldForCurrentTool,
    });
    if (protectedReason) {
      throw new Error(protectedReason);
    }
    const foregroundAppKey = appKeyForForeground(target);
    if (foregroundAppKey && mutable.allowedApps.has(foregroundAppKey)) {
      await touchForegroundPermission(target);
      return undefined;
    }
    if (runtimeMode === "approval-required") {
      return `computer_use wants to run ${tool} in ${displayNameForForeground(target)}.`;
    }
    return `computer_use wants to use ${displayNameForForeground(target)} for ${tool}.`;
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
    attemptedT3WindowYieldForCurrentTool = false;
    try {
      if (environment.platform !== "win32") {
        throw new Error("computer_use is only implemented on Windows.");
      }
      if (mutable.paused && ACTION_TOOLS.has(tool)) {
        return textResponse("computer_use is paused by the user.", false);
      }
      if (tool === "computer_state" || tool === "computer_screenshot" || ACTION_TOOLS.has(tool)) {
        await refreshForegroundAfterT3Yield();
      }
      if (INPUT_TOOLS.has(tool)) {
        const protectedReason = protectedForegroundReason(mutable.foregroundWindow, {
          attemptedT3WindowYield: attemptedT3WindowYieldForCurrentTool,
        });
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
        case "computer_list_apps": {
          const query = readString(args, "query") ?? "";
          const result = await requestHelper("listApps", { query });
          applyHelperState(result);
          publishState();
          return textResponse(JSON.stringify(result, null, 2));
        }
        case "computer_list_windows": {
          const query = readString(args, "query") ?? "";
          const result = await requestHelper("listWindows", { query });
          applyHelperState(result);
          publishState();
          return textResponse(JSON.stringify(result, null, 2));
        }
        case "computer_select_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          if (!windowId) return textResponse("computer_select_window requires windowId.", false);
          const result = await requestHelper("selectWindow", { windowId });
          applyHelperState(result);
          publishState();
          return textResponse(`Selected window for computer_use.\n${JSON.stringify(result, null, 2)}`);
        }
        case "computer_activate_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          if (!windowId) return textResponse("computer_activate_window requires windowId.", false);
          const result = await requestHelper("activateWindow", { windowId });
          applyHelperState(result);
          publishState();
          const protectedReason = protectedForegroundReason(mutable.foregroundWindow);
          if (protectedReason) return textResponse(protectedReason, false);
          return textResponse(`Activated window for computer_use.\n${JSON.stringify(result, null, 2)}`);
        }
        case "computer_window_screenshot": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          if (!windowId) return textResponse("computer_window_screenshot requires windowId.", false);
          const filePath = NodePath.join(screenshotDir, `window-${Date.now()}.png`);
          let result = await requestHelper(
            "windowScreenshot",
            { windowId, path: filePath },
            DEFAULT_TIMEOUT_MS,
          );
          applyHelperState(result);
          let dataUrl: string | null = null;
          let screenshotPath = filePath;
          try {
            const wgc = await tryCaptureWindowWithCodexWgc(
              mutable.selectedWindow,
              NodePath.join(screenshotDir, `window-wgc-${Date.now()}.png`),
            );
            if (wgc) {
              result = mergeWgcResult(result, wgc.result);
              dataUrl = wgc.dataUrl;
              screenshotPath = wgc.filePath;
            }
          } catch (error) {
            result = withScreenshotFallbackReason(
              result,
              `Windows.Graphics.Capture unavailable: ${normalizeError(error)}`,
            );
          }
          if (!dataUrl) {
            const png = await NodeFs.readFile(filePath);
            dataUrl = `data:image/png;base64,${png.toString("base64")}`;
          }
          mutable.lastScreenshotDataUrl = dataUrl;
          mutable.lastScreenshotPath = screenshotPath;
          publishState();
          return imageResponse(
            dataUrl,
            `Window screenshot captured: ${screenshotPath}\n${JSON.stringify(
              sanitizeScreenshotText(result, dataUrl),
              null,
              2,
            )}`,
          );
        }
        case "computer_get_window_state": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          if (!windowId) return textResponse("computer_get_window_state requires windowId.", false);
          const includeScreenshot =
            readBooleanAlias(args, "includeScreenshot", "include_screenshot") ?? true;
          const includeText = readBooleanAlias(args, "includeText", "include_text") ?? false;
          if (!includeScreenshot && !includeText) {
            return textResponse(
              "computer_get_window_state requires includeScreenshot, includeText, or both.",
              false,
            );
          }
          const filePath = includeScreenshot
            ? NodePath.join(screenshotDir, `window-state-${Date.now()}.png`)
            : "";
          let result = await requestHelper(
            "windowState",
            { windowId, path: filePath, includeScreenshot, includeText },
            includeText ? 45_000 : DEFAULT_TIMEOUT_MS,
          );
          applyHelperState(result);
          let dataUrl: string | null = null;
          let screenshotPath = filePath;
          if (includeScreenshot) {
            try {
              const wgc = await tryCaptureWindowWithCodexWgc(
                mutable.selectedWindow,
                NodePath.join(screenshotDir, `window-state-wgc-${Date.now()}.png`),
              );
              if (wgc) {
                result = mergeWgcResult(result, wgc.result);
                dataUrl = wgc.dataUrl;
                screenshotPath = wgc.filePath;
              }
            } catch (error) {
              result = withScreenshotFallbackReason(
                result,
                `Windows.Graphics.Capture unavailable: ${normalizeError(error)}`,
              );
            }
            if (!dataUrl) {
              const png = await NodeFs.readFile(filePath);
              dataUrl = `data:image/png;base64,${png.toString("base64")}`;
            }
            mutable.lastScreenshotDataUrl = dataUrl;
            mutable.lastScreenshotPath = screenshotPath;
          }
          publishState();
          return imageAndTextResponse(
            dataUrl,
            `Window state captured${includeScreenshot ? `: ${screenshotPath}` : ""}\n${JSON.stringify(
              sanitizeScreenshotText(result, dataUrl ?? undefined),
              null,
              2,
            )}`,
          );
        }
        case "computer_accessibility_snapshot": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          if (!windowId) {
            return textResponse("computer_accessibility_snapshot requires windowId.", false);
          }
          const result = await requestHelper("accessibilitySnapshot", { windowId }, 45_000);
          applyHelperState(result);
          publishState();
          return textResponse(JSON.stringify(result, null, 2));
        }
        case "computer_focus_app": {
          const app = readString(args, "app") ?? readString(args, "name");
          if (!app?.trim()) {
            return textResponse("computer_focus_app requires app.", false);
          }
          if (/(^|\s)(t3\s*code|codex|terminal|powershell|cmd)(\s|$)/i.test(app)) {
            return textResponse(
              "computer_focus_app cannot target T3 Code, Codex, or terminal applications.",
              false,
            );
          }
          applyHelperState(await requestHelper("focusApp", { app }));
          publishState();
          const protectedReason = protectedForegroundReason(mutable.foregroundWindow);
          if (protectedReason) {
            return textResponse(protectedReason, false);
          }
          return textResponse(
            `Focused ${displayNameForForeground(mutable.foregroundWindow)} for computer_use.\n${JSON.stringify(
              currentState().foregroundWindow,
              null,
              2,
            )}`,
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
        case "computer_move_mouse_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const x = readNumber(args, "x");
          const y = readNumber(args, "y");
          if (!windowId || x === undefined || y === undefined) {
            return textResponse("computer_move_mouse_window requires windowId, x, and y.", false);
          }
          const result = await requestHelper("moveMouseInWindow", { windowId, x, y });
          applyHelperState(result);
          publishState();
          return textResponse(`Moved mouse in window ${windowId} to ${x},${y}`);
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
        case "computer_click_element": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const elementIndex = readElementIndex(args);
          if (!windowId || elementIndex === undefined) {
            return textResponse(
              "computer_click_element requires windowId and element_index.",
              false,
            );
          }
          const button = readString(args, "button") ?? "left";
          const count = Math.max(1, Math.min(3, readNumber(args, "click_count") ?? 1));
          const result = await requestHelper("clickElement", {
            windowId,
            elementIndex,
            button,
            count,
          });
          applyHelperState(result);
          publishState();
          return textResponse(
            `Clicked ${button} on element_index ${elementIndex} in window ${windowId}.`,
          );
        }
        case "computer_click_window":
        case "computer_double_click_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const x = readNumber(args, "x");
          const y = readNumber(args, "y");
          if (!windowId || x === undefined || y === undefined) {
            return textResponse(`${tool} requires windowId, x, and y.`, false);
          }
          const button = readString(args, "button") ?? "left";
          const result = await requestHelper("clickInWindow", {
            windowId,
            x,
            y,
            button,
            count: tool === "computer_double_click_window" ? 2 : 1,
          });
          applyHelperState(result);
          publishState();
          return textResponse(
            `${tool === "computer_double_click_window" ? "Double-clicked" : "Clicked"} ${button} in window ${windowId} at ${x},${y}`,
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
        case "computer_drag_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const fromX = readNumber(args, "fromX");
          const fromY = readNumber(args, "fromY");
          const toX = readNumber(args, "toX");
          const toY = readNumber(args, "toY");
          if (
            !windowId ||
            fromX === undefined ||
            fromY === undefined ||
            toX === undefined ||
            toY === undefined
          ) {
            return textResponse(
              "computer_drag_window requires windowId, fromX, fromY, toX, and toY.",
              false,
            );
          }
          const durationMs = Math.max(80, Math.min(5000, readNumber(args, "durationMs") ?? 500));
          const result = await requestHelper(
            "dragInWindow",
            { windowId, fromX, fromY, toX, toY, durationMs },
            durationMs + 5000,
          );
          applyHelperState(result);
          publishState();
          return textResponse(`Dragged in window ${windowId} from ${fromX},${fromY} to ${toX},${toY}`);
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
        case "computer_scroll_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const x = readNumber(args, "x");
          const y = readNumber(args, "y");
          if (!windowId || x === undefined || y === undefined) {
            return textResponse("computer_scroll_window requires windowId, x, and y.", false);
          }
          const deltaX = readNumber(args, "deltaX") ?? 0;
          const deltaY = readNumber(args, "deltaY") ?? -600;
          const result = await requestHelper("scrollInWindow", {
            windowId,
            x,
            y,
            deltaX,
            deltaY,
          });
          applyHelperState(result);
          publishState();
          return textResponse(`Scrolled in window ${windowId} at ${x},${y}`);
        }
        case "computer_type": {
          const text = readString(args, "text");
          if (text === undefined) return textResponse("computer_type requires text.", false);
          applyHelperState(await requestHelper("type", { text }));
          publishState();
          return textResponse(`Typed ${text.length} characters.`);
        }
        case "computer_type_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const text = readString(args, "text");
          if (!windowId || text === undefined) {
            return textResponse("computer_type_window requires windowId and text.", false);
          }
          const result = await requestHelper("typeInWindow", { windowId, text });
          applyHelperState(result);
          publishState();
          return textResponse(`Typed ${text.length} characters in window ${windowId}.`);
        }
        case "computer_press": {
          const key = readString(args, "key");
          if (!key) return textResponse("computer_press requires key.", false);
          applyHelperState(await requestHelper("press", { key }));
          publishState();
          return textResponse(`Pressed ${key}`);
        }
        case "computer_press_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const key = readString(args, "key");
          if (!windowId || !key) {
            return textResponse("computer_press_window requires windowId and key.", false);
          }
          const result = await requestHelper("pressInWindow", { windowId, key });
          applyHelperState(result);
          publishState();
          return textResponse(`Pressed ${key} in window ${windowId}`);
        }
        case "computer_hotkey": {
          const keys = readStringArray(args, "keys");
          if (!keys || keys.length === 0)
            return textResponse("computer_hotkey requires keys.", false);
          applyHelperState(await requestHelper("hotkey", { keys }));
          publishState();
          return textResponse(`Pressed hotkey ${keys.join("+")}`);
        }
        case "computer_hotkey_window": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const keys = readStringArray(args, "keys");
          if (!windowId || !keys || keys.length === 0) {
            return textResponse("computer_hotkey_window requires windowId and keys.", false);
          }
          const result = await requestHelper("hotkeyInWindow", { windowId, keys });
          applyHelperState(result);
          publishState();
          return textResponse(`Pressed hotkey ${keys.join("+")} in window ${windowId}`);
        }
        case "computer_set_value": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const elementIndex = readElementIndex(args);
          const value = readString(args, "value");
          if (!windowId || elementIndex === undefined || value === undefined) {
            return textResponse(
              "computer_set_value requires windowId, element_index, and value.",
              false,
            );
          }
          const result = await requestHelper("setElementValue", {
            windowId,
            elementIndex,
            value,
          });
          applyHelperState(result);
          publishState();
          return textResponse(`Set value on element_index ${elementIndex} in window ${windowId}.`);
        }
        case "computer_perform_secondary_action": {
          const windowId = readWindowId(args, mutable.selectedWindow);
          const elementIndex = readElementIndex(args);
          const action = readString(args, "action");
          if (!windowId || elementIndex === undefined || !action) {
            return textResponse(
              "computer_perform_secondary_action requires windowId, element_index, and action.",
              false,
            );
          }
          const result = await requestHelper("performSecondaryAction", {
            windowId,
            elementIndex,
            action,
          });
          applyHelperState(result);
          publishState();
          return textResponse(
            `Performed ${action} on element_index ${elementIndex} in window ${windowId}.`,
          );
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
