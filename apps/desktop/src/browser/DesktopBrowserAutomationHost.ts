// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off globalDate:off globalRandom:off
import * as NodeHttp from "node:http";
import type { AddressInfo } from "node:net";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

export interface DesktopBrowserAutomationTabState {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly visible: boolean;
  readonly width: number;
  readonly height: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export interface DesktopBrowserAutomationState {
  readonly endpoint: string;
  readonly selectedTabId: string | null;
  readonly tabs: readonly DesktopBrowserAutomationTabState[];
  readonly lastError: string | null;
  readonly lastScreenshotDataUrl: string | null;
  readonly lastScreenshotPath: string | null;
  readonly lastToolCallAt: string | null;
  readonly toolCallSequence: number;
  readonly updatedAt: string;
}

export interface DesktopBrowserAutomationBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}

export interface DesktopBrowserAutomationHostShape {
  readonly endpoint: string;
  readonly token: string;
  readonly state: Effect.Effect<DesktopBrowserAutomationState>;
  readonly navigate: (url: string) => Effect.Effect<DesktopBrowserAutomationState>;
  readonly reload: Effect.Effect<DesktopBrowserAutomationState>;
  readonly goBack: Effect.Effect<DesktopBrowserAutomationState>;
  readonly goForward: Effect.Effect<DesktopBrowserAutomationState>;
  readonly setPanelBounds: (bounds: DesktopBrowserAutomationBounds) => Effect.Effect<void>;
  readonly reveal: Effect.Effect<void>;
}

export class DesktopBrowserAutomationHost extends Context.Service<
  DesktopBrowserAutomationHost,
  DesktopBrowserAutomationHostShape
>()("t3/desktop/browser/AutomationHost") {}

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

interface ConsoleLogEntry {
  readonly level: string;
  readonly message: string;
  readonly url: string;
  readonly line: number;
  readonly timestamp: string;
}

interface BrowserTab {
  readonly id: string;
  readonly view: Electron.WebContentsView;
  readonly consoleLogs: ConsoleLogEntry[];
  attachedWindow: Electron.BrowserWindow | null;
  width: number;
  height: number;
}

interface StringEventEmitter {
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

interface MutableHostState {
  selectedTabId: string | null;
  panelBounds: DesktopBrowserAutomationBounds | null;
  lastError: string | null;
  lastScreenshotDataUrl: string | null;
  lastScreenshotPath: string | null;
  lastToolCallAt: string | null;
  toolCallSequence: number;
  updatedAt: string;
}

const NAMESPACE = "t3_browser";
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MAX_CONSOLE_LOGS = 500;
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 60_000;
const DANGEROUS_READ_PATTERN =
  /\b(cookie|localStorage|sessionStorage|indexedDB|password|credential|navigator\.credentials)\b/i;
const RISKY_ACTION_TEXT_PATTERN =
  /\b(pay|purchase|buy|checkout|submit|send|delete|remove|archive|transfer|confirm|authorize|permission|upload)\b/i;
const CONFIRMATION_REQUIRED_PREFIX = "T3_BROWSER_CONFIRMATION_REQUIRED:";

function textResponse(text: string, success = true): ToolResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function imageResponse(imageUrl: string, text?: string): ToolResponse {
  return {
    success: true,
    contentItems: [
      { type: "inputImage", imageUrl },
      ...(text ? [{ type: "inputText" as const, text }] : []),
    ],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function truncateText(text: string, maxLength = MAX_TEXT_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
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

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  if (
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.0.0.1") ||
    trimmed.startsWith("[::1]")
  ) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function isLocalAutomationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "file:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    );
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function onceWebContents(
  webContents: Electron.WebContents,
  events: readonly string[],
  timeoutMs: number,
): Promise<void> {
  const emitter = webContents as unknown as StringEventEmitter;
  return withTimeout(
    new Promise((resolve, reject) => {
      const cleanup = () => {
        for (const event of events) {
          emitter.removeListener(event, onSuccess);
        }
        emitter.removeListener("did-fail-load", onFail);
        emitter.removeListener("render-process-gone", onGone);
      };
      const onSuccess = () => {
        cleanup();
        resolve();
      };
      const onFail = (...args: unknown[]) => {
        const description = typeof args[2] === "string" ? args[2] : "Page load failed";
        cleanup();
        reject(new Error(description));
      };
      const onGone = (...args: unknown[]) => {
        const details = args[1] as Electron.RenderProcessGoneDetails | undefined;
        cleanup();
        reject(new Error(`Renderer process gone: ${details?.reason ?? "unknown"}`));
      };
      for (const event of events) {
        emitter.once(event, onSuccess);
      }
      emitter.once("did-fail-load", onFail);
      emitter.once("render-process-gone", onGone);
    }),
    timeoutMs,
    "Browser navigation",
  );
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
  readonly mutable: MutableHostState;
  readonly tabs: ReadonlyMap<string, BrowserTab>;
}): DesktopBrowserAutomationState {
  return {
    endpoint: input.endpoint,
    selectedTabId: input.mutable.selectedTabId,
    tabs: [...input.tabs.values()].map((tab) => ({
      id: tab.id,
      title: tab.view.webContents.isDestroyed() ? "" : tab.view.webContents.getTitle(),
      url: tab.view.webContents.isDestroyed() ? "" : tab.view.webContents.getURL(),
      visible: !tab.view.webContents.isDestroyed() && tab.attachedWindow !== null,
      width: tab.width,
      height: tab.height,
      canGoBack: !tab.view.webContents.isDestroyed() && tab.view.webContents.canGoBack(),
      canGoForward: !tab.view.webContents.isDestroyed() && tab.view.webContents.canGoForward(),
    })),
    lastError: input.mutable.lastError,
    lastScreenshotDataUrl: input.mutable.lastScreenshotDataUrl,
    lastScreenshotPath: input.mutable.lastScreenshotPath,
    lastToolCallAt: input.mutable.lastToolCallAt,
    toolCallSequence: input.mutable.toolCallSequence,
    updatedAt: input.mutable.updatedAt,
  };
}

function shouldBlockReadonlyExpression(expression: string): boolean {
  return DANGEROUS_READ_PATTERN.test(expression);
}

const domSnapshotScript = `
(() => {
  const lines = [];
  const title = document.title || "";
  const url = location.href;
  const text = (document.body?.innerText || "").replace(/\\s+\\n/g, "\\n").trim();
  lines.push("Title: " + title);
  lines.push("URL: " + url);
  if (text) lines.push("\\nText:\\n" + text.slice(0, 45000));
  const elements = [...document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")].slice(0, 250);
  if (elements.length) {
    lines.push("\\nInteractive elements:");
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
      if (!visible) continue;
      const tag = element.tagName.toLowerCase();
      const label = (element.innerText || element.value || element.getAttribute("aria-label") || element.placeholder || element.name || element.id || "").trim().replace(/\\s+/g, " ");
      const selector = element.id ? "#" + CSS.escape(element.id) : tag + (element.name ? "[name='" + CSS.escape(element.name) + "']" : "");
      lines.push("- " + tag + " " + selector + (label ? " :: " + label.slice(0, 160) : ""));
    }
  }
  return lines.join("\\n");
})()
`;

const visibleDomScript = `
(() => {
  function selectorFor(element) {
    if (element.id) return "#" + CSS.escape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.name) part += "[name='" + CSS.escape(node.name) + "']";
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + ([...parent.children].indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }
  return [...document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
      if (!visible) return null;
      return {
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || element.value || element.getAttribute("aria-label") || element.placeholder || element.name || element.id || "").trim().replace(/\\s+/g, " ").slice(0, 200),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })
    .filter(Boolean)
    .slice(0, 300);
})()
`;

function elementPointScript(selector: string): string {
  return `
(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return null;
  element.scrollIntoView({ block: "center", inline: "center" });
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()
`;
}

function riskInspectionScript(selector?: string): string {
  return `
(() => {
  const active = document.activeElement;
  const element = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "active"};
  if (!element) return { risky: false, reason: "No target element." };
  const text = (element.innerText || element.value || element.getAttribute("aria-label") || element.title || element.name || element.id || "").trim();
  const type = (element.getAttribute("type") || "").toLowerCase();
  const role = (element.getAttribute("role") || "").toLowerCase();
  const tag = element.tagName.toLowerCase();
  const form = element.closest("form");
  const risky =
    type === "submit" ||
    type === "file" ||
    role === "button" ||
    tag === "button" ||
    (form && (type === "text" || tag === "textarea" || tag === "select"));
  return { risky, text, tag, type, role, inForm: Boolean(form) };
})()
`;
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

const make = Effect.gen(function* () {
  yield* Effect.service(ElectronApp.ElectronApp).pipe(Effect.flatMap((app) => app.whenReady));
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const token = yield* makeTokenEffect();
  const tabs = new Map<string, BrowserTab>();
  const mutable: MutableHostState = {
    selectedTabId: null,
    panelBounds: null,
    lastError: null,
    lastScreenshotDataUrl: null,
    lastScreenshotPath: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: nowIso(),
  };
  const screenshotDir = NodePath.join(environment.stateDir, "browser-use");
  yield* fileSystem.makeDirectory(screenshotDir, { recursive: true }).pipe(Effect.ignore);

  let endpoint = "";

  const currentState = () => buildState({ endpoint, mutable, tabs });
  const publishState = () => {
    mutable.updatedAt = nowIso();
    void Effect.runPromise(
      electronWindow.sendAll(IpcChannels.BROWSER_AUTOMATION_STATE_CHANNEL, currentState()),
    );
  };
  const publishToolActivity = () => {
    mutable.toolCallSequence += 1;
    mutable.lastToolCallAt = nowIso();
    publishState();
  };

  const detachTab = (tab: BrowserTab) => {
    const attachedWindow = tab.attachedWindow;
    if (!attachedWindow || attachedWindow.isDestroyed()) {
      tab.attachedWindow = null;
      return;
    }
    try {
      attachedWindow.contentView.removeChildView(tab.view);
    } catch {
      // The view may already have been removed by Electron during window teardown.
    }
    tab.attachedWindow = null;
  };

  const attachSelectedTabToPanel = async () => {
    const bounds = mutable.panelBounds;
    const selectedTab = mutable.selectedTabId ? tabs.get(mutable.selectedTabId) : undefined;
    if (
      !bounds ||
      !bounds.visible ||
      bounds.width < 32 ||
      bounds.height < 32 ||
      !selectedTab ||
      selectedTab.view.webContents.isDestroyed()
    ) {
      for (const tab of tabs.values()) {
        detachTab(tab);
      }
      publishState();
      return;
    }

    const mainWindowOption = await Effect.runPromise(electronWindow.currentMainOrFirst);
    if (mainWindowOption._tag === "None") {
      publishState();
      return;
    }

    const mainWindow = mainWindowOption.value;
    for (const tab of tabs.values()) {
      if (tab !== selectedTab) {
        detachTab(tab);
      }
    }
    if (selectedTab.attachedWindow !== mainWindow) {
      detachTab(selectedTab);
      mainWindow.contentView.addChildView(selectedTab.view);
      selectedTab.attachedWindow = mainWindow;
    }
    selectedTab.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    });
    selectedTab.view.webContents.focus();
    publishState();
  };

  const markError = (error: unknown): ToolResponse => {
    const message = normalizeError(error);
    mutable.lastError = message;
    publishState();
    return textResponse(message, false);
  };

  const runUserNavigationAction = async (
    action: (tab: BrowserTab) => void | Promise<void>,
  ): Promise<DesktopBrowserAutomationState> => {
    try {
      mutable.lastError = null;
      const tab = await getTab();
      await action(tab);
      await attachSelectedTabToPanel();
      publishState();
      return currentState();
    } catch (error) {
      mutable.lastError = normalizeError(error);
      publishState();
      return currentState();
    }
  };

  const getTab = async (tabId?: string): Promise<BrowserTab> => {
    const id = tabId ?? mutable.selectedTabId;
    const existing = id ? tabs.get(id) : undefined;
    if (existing && !existing.view.webContents.isDestroyed()) {
      return existing;
    }
    if (existing) {
      detachTab(existing);
      tabs.delete(existing.id);
    }
    return createTab({});
  };

  const createTab = async (input: {
    readonly url?: string | undefined;
    readonly visible?: boolean | undefined;
  }) => {
    const id = makeTabId();
    const view = new Electron.WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "t3-browser-use",
      },
    });
    const tab: BrowserTab = {
      id,
      view,
      consoleLogs: [],
      attachedWindow: null,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    };
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    tabs.set(id, tab);
    mutable.selectedTabId = id;
    view.webContents.on("destroyed", () => {
      detachTab(tab);
      tabs.delete(id);
      if (mutable.selectedTabId === id) {
        mutable.selectedTabId = tabs.keys().next().value ?? null;
      }
      publishState();
    });
    view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      tab.consoleLogs.push({
        level: String(level),
        message,
        url: sourceId,
        line,
        timestamp: nowIso(),
      });
      if (tab.consoleLogs.length > MAX_CONSOLE_LOGS) {
        tab.consoleLogs.splice(0, tab.consoleLogs.length - MAX_CONSOLE_LOGS);
      }
      publishState();
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      void view.webContents.loadURL(url);
      return { action: "deny" };
    });
    view.webContents.on("did-navigate", publishState);
    view.webContents.on("did-navigate-in-page", publishState);
    view.webContents.on("page-title-updated", publishState);
    if (input.url) {
      await view.webContents.loadURL(normalizeUrl(input.url));
    } else {
      await view.webContents.loadURL("about:blank");
    }
    await attachSelectedTabToPanel();
    publishState();
    return tab;
  };

  const navigate = async (
    tab: BrowserTab,
    action: () => void | Promise<void>,
    timeoutMs: number,
  ) => {
    const wait = onceWebContents(tab.view.webContents, ["did-finish-load"], timeoutMs);
    await action();
    await wait.catch((error) => {
      if (!tab.view.webContents.isLoadingMainFrame()) return;
      throw error;
    });
    publishState();
  };

  const assertPublicRiskAllowed = async (
    tab: BrowserTab,
    selector: string | undefined,
    actionName: string,
    userConfirmed: boolean,
  ) => {
    if (userConfirmed) {
      return;
    }
    const url = tab.view.webContents.getURL();
    if (isLocalAutomationUrl(url)) {
      return;
    }
    const inspection = (await tab.view.webContents.executeJavaScript(
      riskInspectionScript(selector),
      true,
    )) as { risky?: unknown; text?: unknown; tag?: unknown; type?: unknown };
    const text = typeof inspection.text === "string" ? inspection.text : "";
    if (inspection.risky === true || RISKY_ACTION_TEXT_PATTERN.test(text)) {
      throw new Error(
        `${CONFIRMATION_REQUIRED_PREFIX}${actionName} wants to interact with a public page target that may submit data or perform a side effect. Target text: ${text || "unknown"}`,
      );
    }
  };

  const handleToolCall = async (payload: ToolCallPayload): Promise<ToolResponse> => {
    if (payload.namespace !== NAMESPACE) {
      return textResponse(`Unsupported namespace: ${payload.namespace ?? ""}`, false);
    }
    const tool = payload.tool;
    if (!tool) {
      return textResponse("Missing browser tool name.", false);
    }
    const args = asRecord(payload.arguments);
    const timeoutMs = readNumber(args, "timeoutMs") ?? 30_000;
    if (tool !== "browser_set_visibility" || readBoolean(args, "visible") !== false) {
      publishToolActivity();
    }
    try {
      switch (tool) {
        case "browser_new_tab": {
          const newTabInput = {
            ...(readString(args, "url") ? { url: readString(args, "url") } : {}),
            ...(readBoolean(args, "visible") !== undefined
              ? { visible: readBoolean(args, "visible") }
              : {}),
          };
          const tab = await createTab(newTabInput);
          return textResponse(
            JSON.stringify({ tabId: tab.id, url: tab.view.webContents.getURL() }),
          );
        }
        case "browser_list_tabs": {
          return textResponse(JSON.stringify(currentState().tabs, null, 2));
        }
        case "browser_select_tab": {
          const tabId = readString(args, "tabId");
          if (!tabId || !tabs.has(tabId)) return textResponse(`Unknown tab: ${tabId ?? ""}`, false);
          mutable.selectedTabId = tabId;
          await attachSelectedTabToPanel();
          publishState();
          return textResponse(`Selected tab ${tabId}`);
        }
        case "browser_close_tab": {
          const tabId = readString(args, "tabId");
          if (!tabId) return textResponse("tabId is required.", false);
          const tab = tabs.get(tabId);
          if (!tab) return textResponse(`Unknown tab: ${tabId}`, false);
          detachTab(tab);
          if (!tab.view.webContents.isDestroyed()) {
            tab.view.webContents.close({ waitForBeforeUnload: false });
          }
          tabs.delete(tabId);
          if (mutable.selectedTabId === tabId)
            mutable.selectedTabId = tabs.keys().next().value ?? null;
          await attachSelectedTabToPanel();
          publishState();
          return textResponse(`Closed tab ${tabId}`);
        }
        case "browser_goto": {
          const url = readString(args, "url");
          if (!url) return textResponse("url is required.", false);
          const tab = await getTab(readString(args, "tabId"));
          await tab.view.webContents.loadURL(normalizeUrl(url));
          publishState();
          return textResponse(`Navigated to ${tab.view.webContents.getURL()}`);
        }
        case "browser_reload": {
          const tab = await getTab(readString(args, "tabId"));
          await navigate(tab, () => tab.view.webContents.reload(), timeoutMs);
          return textResponse(`Reloaded ${tab.view.webContents.getURL()}`);
        }
        case "browser_back": {
          const tab = await getTab(readString(args, "tabId"));
          if (!tab.view.webContents.canGoBack()) return textResponse("Cannot go back.", false);
          await navigate(tab, () => tab.view.webContents.goBack(), timeoutMs);
          return textResponse(`Went back to ${tab.view.webContents.getURL()}`);
        }
        case "browser_forward": {
          const tab = await getTab(readString(args, "tabId"));
          if (!tab.view.webContents.canGoForward())
            return textResponse("Cannot go forward.", false);
          await navigate(tab, () => tab.view.webContents.goForward(), timeoutMs);
          return textResponse(`Went forward to ${tab.view.webContents.getURL()}`);
        }
        case "browser_title": {
          const tab = await getTab(readString(args, "tabId"));
          return textResponse(tab.view.webContents.getTitle());
        }
        case "browser_url": {
          const tab = await getTab(readString(args, "tabId"));
          return textResponse(tab.view.webContents.getURL());
        }
        case "browser_dom_snapshot": {
          const tab = await getTab(readString(args, "tabId"));
          const snapshot = await tab.view.webContents.executeJavaScript(domSnapshotScript, true);
          return textResponse(truncateText(String(snapshot)));
        }
        case "browser_visible_dom": {
          const tab = await getTab(readString(args, "tabId"));
          const snapshot = await tab.view.webContents.executeJavaScript(visibleDomScript, true);
          return textResponse(truncateText(JSON.stringify(snapshot, null, 2)));
        }
        case "browser_click": {
          const tab = await getTab(readString(args, "tabId"));
          const selector = readString(args, "selector");
          await assertPublicRiskAllowed(
            tab,
            selector,
            "browser_click",
            readBoolean(args, "userConfirmed") === true,
          );
          let x = readNumber(args, "x");
          let y = readNumber(args, "y");
          if (selector) {
            const point = (await tab.view.webContents.executeJavaScript(
              elementPointScript(selector),
              true,
            )) as { x: number; y: number } | null;
            if (!point) return textResponse(`Element not found or not visible: ${selector}`, false);
            x = point.x;
            y = point.y;
          }
          if (x === undefined || y === undefined) {
            return textResponse("browser_click requires selector or x/y.", false);
          }
          const button = (readString(args, "button") ?? "left") as "left" | "middle" | "right";
          tab.view.webContents.sendInputEvent({
            type: "mouseDown",
            x: Math.round(x),
            y: Math.round(y),
            button,
            clickCount: 1,
          });
          tab.view.webContents.sendInputEvent({
            type: "mouseUp",
            x: Math.round(x),
            y: Math.round(y),
            button,
            clickCount: 1,
          });
          publishState();
          return textResponse(`Clicked ${selector ?? `${x},${y}`}`);
        }
        case "browser_fill": {
          const tab = await getTab(readString(args, "tabId"));
          const selector = readString(args, "selector");
          const value = readString(args, "value");
          if (!selector || value === undefined)
            return textResponse("browser_fill requires selector and value.", false);
          await tab.view.webContents
            .executeJavaScript(
              `
(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  element.focus();
  if ("value" in element) element.value = ${JSON.stringify(value)};
  else element.textContent = ${JSON.stringify(value)};
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()
`,
              true,
            )
            .then((ok) => {
              if (!ok) throw new Error(`Element not found: ${selector}`);
            });
          publishState();
          return textResponse(`Filled ${selector}`);
        }
        case "browser_type": {
          const tab = await getTab(readString(args, "tabId"));
          const selector = readString(args, "selector");
          const text = readString(args, "text");
          if (text === undefined) return textResponse("browser_type requires text.", false);
          if (selector) {
            const point = await tab.view.webContents.executeJavaScript(
              elementPointScript(selector),
              true,
            );
            if (!point) return textResponse(`Element not found or not visible: ${selector}`, false);
            await tab.view.webContents.executeJavaScript(
              `document.querySelector(${JSON.stringify(selector)})?.focus()`,
              true,
            );
          }
          await tab.view.webContents.insertText(text);
          publishState();
          return textResponse(`Typed ${text.length} characters`);
        }
        case "browser_press": {
          const tab = await getTab(readString(args, "tabId"));
          const selector = readString(args, "selector");
          const key = readString(args, "key");
          if (!key) return textResponse("browser_press requires key.", false);
          if (key.toLowerCase() === "enter") {
            await assertPublicRiskAllowed(
              tab,
              selector,
              "browser_press Enter",
              readBoolean(args, "userConfirmed") === true,
            );
          }
          if (selector) {
            await tab.view.webContents.executeJavaScript(
              `document.querySelector(${JSON.stringify(selector)})?.focus()`,
              true,
            );
          }
          tab.view.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
          tab.view.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
          publishState();
          return textResponse(`Pressed ${key}`);
        }
        case "browser_screenshot": {
          const tab = await getTab(readString(args, "tabId"));
          const image = await tab.view.webContents.capturePage();
          const png = image.toPNG();
          const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
          const filePath = NodePath.join(screenshotDir, `${tab.id}-${Date.now()}.png`);
          await Effect.runPromise(fileSystem.writeFile(filePath, png));
          mutable.lastScreenshotDataUrl = dataUrl;
          mutable.lastScreenshotPath = filePath;
          publishState();
          return imageResponse(dataUrl, `Screenshot captured: ${filePath}`);
        }
        case "browser_console_logs": {
          const tab = await getTab(readString(args, "tabId"));
          const limit = readNumber(args, "limit") ?? 100;
          return textResponse(JSON.stringify(tab.consoleLogs.slice(-limit), null, 2));
        }
        case "browser_evaluate_readonly": {
          const expression = readString(args, "expression");
          if (!expression)
            return textResponse("browser_evaluate_readonly requires expression.", false);
          if (shouldBlockReadonlyExpression(expression)) {
            return textResponse(
              "Reading cookies, storage, credentials, or password data is not allowed.",
              false,
            );
          }
          const tab = await getTab(readString(args, "tabId"));
          const result = await tab.view.webContents.executeJavaScript(
            `Promise.resolve((() => (${expression}))()).then((value) => JSON.stringify(value, null, 2))`,
            true,
          );
          return textResponse(truncateText(String(result)));
        }
        case "browser_set_viewport": {
          const tab = await getTab(readString(args, "tabId"));
          const width = readNumber(args, "width");
          const height = readNumber(args, "height");
          if (!width || !height)
            return textResponse("browser_set_viewport requires width and height.", false);
          tab.width = Math.max(320, Math.min(4096, Math.round(width)));
          tab.height = Math.max(240, Math.min(4096, Math.round(height)));
          publishState();
          return textResponse(`Viewport set to ${tab.width}x${tab.height}`);
        }
        case "browser_reset_viewport": {
          const tab = await getTab(readString(args, "tabId"));
          tab.width = DEFAULT_WIDTH;
          tab.height = DEFAULT_HEIGHT;
          publishState();
          return textResponse(`Viewport reset to ${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}`);
        }
        case "browser_set_visibility": {
          const visible = readBoolean(args, "visible");
          if (visible === undefined)
            return textResponse("browser_set_visibility requires visible.", false);
          const tab = await getTab(readString(args, "tabId"));
          if (visible) {
            await attachSelectedTabToPanel();
            const mainWindowOption = await Effect.runPromise(electronWindow.currentMainOrFirst);
            if (mainWindowOption._tag === "Some") {
              await Effect.runPromise(electronWindow.reveal(mainWindowOption.value));
            }
          } else {
            detachTab(tab);
          }
          publishState();
          return textResponse(visible ? "Browser panel shown." : "Browser panel hidden.");
        }
        default:
          return textResponse(`Unsupported browser tool: ${tool}`, false);
      }
    } catch (error) {
      return markError(error);
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
        const result = await handleToolCall(payload);
        writeJson(response, 200, result);
      } catch (error) {
        writeJson(response, 500, textResponse(normalizeError(error), false));
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
              reject(new Error("Browser automation host did not bind to a TCP port."));
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
            for (const tab of tabs.values()) {
              detachTab(tab);
              if (!tab.view.webContents.isDestroyed()) {
                tab.view.webContents.close({ waitForBeforeUnload: false });
              }
            }
            server.close(() => resolve());
          }),
      ),
  );
  endpoint = `http://127.0.0.1:${address.port}`;
  publishState();

  return DesktopBrowserAutomationHost.of({
    endpoint,
    token,
    state: Effect.sync(currentState),
    navigate: (url) =>
      Effect.promise(() =>
        runUserNavigationAction((tab) => tab.view.webContents.loadURL(normalizeUrl(url))),
      ),
    reload: Effect.promise(() =>
      runUserNavigationAction(async (tab) => {
        if (tab.view.webContents.getURL() === "") {
          return;
        }
        await navigate(tab, () => tab.view.webContents.reload(), 30_000);
      }),
    ),
    goBack: Effect.promise(() =>
      runUserNavigationAction(async (tab) => {
        if (!tab.view.webContents.canGoBack()) {
          return;
        }
        await navigate(tab, () => tab.view.webContents.goBack(), 30_000);
      }),
    ),
    goForward: Effect.promise(() =>
      runUserNavigationAction(async (tab) => {
        if (!tab.view.webContents.canGoForward()) {
          return;
        }
        await navigate(tab, () => tab.view.webContents.goForward(), 30_000);
      }),
    ),
    setPanelBounds: (bounds) =>
      Effect.promise(async () => {
        mutable.panelBounds = {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          visible: bounds.visible,
        };
        await attachSelectedTabToPanel();
      }).pipe(Effect.asVoid),
    reveal: Effect.promise(async () => {
      await getTab();
      await attachSelectedTabToPanel();
      const mainWindowOption = await Effect.runPromise(electronWindow.currentMainOrFirst);
      if (mainWindowOption._tag === "Some") {
        await Effect.runPromise(electronWindow.reveal(mainWindowOption.value));
      }
    }).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(DesktopBrowserAutomationHost, make);
