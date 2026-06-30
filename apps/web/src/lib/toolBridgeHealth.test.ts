import { describe, expect, it } from "vitest";
import type {
  DesktopBrowserAutomationState,
  DesktopBrowserExternalAutomationState,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";

import {
  buildToolBridgeHealthItems,
  describeComputerAutomationPermission,
  summarizeToolBridgeHealth,
} from "./toolBridgeHealth";

const NOW = "2026-06-30T00:00:00.000Z";

function browserState(overrides: Partial<DesktopBrowserAutomationState> = {}) {
  return {
    endpoint: "http://127.0.0.1:13773/browser",
    selectedTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        title: "Local App",
        url: "http://localhost:5733",
        visible: true,
        width: 1280,
        height: 720,
        canGoBack: false,
        canGoForward: false,
      },
    ],
    lastError: null,
    lastScreenshotDataUrl: null,
    lastScreenshotPath: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: NOW,
    ...overrides,
  } satisfies DesktopBrowserAutomationState;
}

function browserExternalState(
  overrides: Partial<DesktopBrowserExternalAutomationState> = {},
) {
  return {
    endpoint: "ws://127.0.0.1:13773/browser-external",
    token: "secret-token",
    connected: true,
    extensionId: "extension-id",
    browserName: "Chrome",
    profileName: "Default",
    selectedTabId: null,
    tabs: [],
    permissions: [],
    lastError: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: NOW,
    ...overrides,
  } satisfies DesktopBrowserExternalAutomationState;
}

function computerState(overrides: Partial<DesktopComputerAutomationState> = {}) {
  return {
    endpoint: "http://127.0.0.1:13773/computer",
    platform: "win32",
    available: true,
    paused: false,
    allowedApps: [],
    virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 },
    cursor: { x: 10, y: 10 },
    foregroundWindow: { title: "Editor", processId: 123, processName: "Code.exe" },
    selectedWindow: null,
    lastAction: null,
    lastError: null,
    lastScreenshotDataUrl: null,
    lastScreenshotPath: null,
    lastToolCallAt: null,
    toolCallSequence: 0,
    updatedAt: NOW,
    ...overrides,
  } satisfies DesktopComputerAutomationState;
}

describe("tool bridge health", () => {
  it("marks all bridges ready when desktop states are healthy", () => {
    const items = buildToolBridgeHealthItems({
      browserState: browserState(),
      browserExternalState: browserExternalState(),
      browserExternalInstalled: true,
      computerState: computerState(),
    });

    expect(items.map((item) => [item.id, item.status])).toEqual([
      ["browser_use", "ready"],
      ["browser_use_external", "ready"],
      ["computer_use", "ready"],
    ]);
    expect(items.every((item) => item.reason === "ready" && item.actionLabel === null)).toBe(true);
    expect(summarizeToolBridgeHealth(items)).toEqual({
      total: 3,
      ready: 3,
      warning: 0,
      unavailable: 0,
      status: "ready",
    });
  });

  it("surfaces setup and pause states as warnings", () => {
    const items = buildToolBridgeHealthItems({
      browserState: browserState(),
      browserExternalState: browserExternalState({ connected: false }),
      browserExternalInstalled: true,
      computerState: computerState({ paused: true }),
    });

    expect(items.map((item) => [item.id, item.status, item.summary])).toEqual([
      ["browser_use", "ready", "可直接使用"],
      ["browser_use_external", "warning", "等待 Chrome 扩展配对"],
      ["computer_use", "warning", "已暂停"],
    ]);
    expect(items.map((item) => [item.id, item.reason, item.actionLabel])).toEqual([
      ["browser_use", "ready", null],
      ["browser_use_external", "chrome-extension-unpaired", "打开配对流程"],
      ["computer_use", "computer-paused", "打开 Computer Use 详情继续"],
    ]);
    expect(summarizeToolBridgeHealth(items).status).toBe("warning");
  });

  it("treats missing desktop states as unavailable", () => {
    const items = buildToolBridgeHealthItems({
      browserState: null,
      browserExternalState: null,
      browserExternalInstalled: false,
      computerState: null,
    });

    expect(items.every((item) => item.status === "unavailable")).toBe(true);
    expect(items.every((item) => item.reason === "desktop-bridge-missing")).toBe(true);
    expect(summarizeToolBridgeHealth(items)).toMatchObject({
      ready: 0,
      warning: 0,
      unavailable: 3,
      status: "unavailable",
    });
  });

  it("describes whether the foreground app is already allowed", () => {
    const allowed = computerState({
      allowedApps: [
        {
          appKey: "process:code",
          displayName: "Code.exe",
          processName: "Code.exe",
          title: "Editor",
          allowedAt: NOW,
          lastUsedAt: null,
        },
      ],
    });
    const unapproved = computerState({
      allowedApps: [],
      foregroundWindow: { title: "Browser", processId: 456, processName: "chrome.exe" },
    });

    expect(describeComputerAutomationPermission(allowed)).toMatchObject({
      status: "allowed",
      summary: "前台 App 已允许",
      foregroundLabel: "Code.exe",
      allowedAppCount: 1,
    });
    expect(describeComputerAutomationPermission(unapproved)).toMatchObject({
      status: "approval-required",
      summary: "前台 App 使用前需确认",
      foregroundLabel: "chrome.exe",
      allowedAppCount: 0,
    });
  });
});
