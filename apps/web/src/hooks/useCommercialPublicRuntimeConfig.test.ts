import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "@t3tools/contracts";

import {
  __resetCommercialPublicRuntimeConfigForTests,
  refreshCommercialPublicRuntimeConfig,
  shouldConnectCommercialPublicRuntimeConfigEventSource,
} from "./useCommercialPublicRuntimeConfig";

const originalWindow = globalThis.window;

afterEach(() => {
  __resetCommercialPublicRuntimeConfigForTests();
  vi.unstubAllGlobals();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

function installWindowStub(windowStub: Partial<Window & typeof globalThis>): void {
  vi.stubGlobal("window", windowStub);
}

describe("useCommercialPublicRuntimeConfig", () => {
  it("does not open the cross-origin event stream when desktop bridge can fetch config", () => {
    installWindowStub({
      EventSource: vi.fn() as unknown as typeof EventSource,
      desktopBridge: {
        getCommercialPublicRuntimeConfig: vi.fn(),
      } as unknown as DesktopBridge,
    });

    expect(shouldConnectCommercialPublicRuntimeConfigEventSource()).toBe(false);
  });

  it("allows the event stream for hosted browser builds without the desktop bridge", () => {
    installWindowStub({
      EventSource: vi.fn() as unknown as typeof EventSource,
    });

    expect(shouldConnectCommercialPublicRuntimeConfigEventSource()).toBe(true);
  });

  it("loads public runtime config through the desktop bridge when available", async () => {
    const getCommercialPublicRuntimeConfig = vi.fn().mockResolvedValue({
      featureFlags: {
        upgradeEntryEnabled: true,
        emailAuthEnabled: true,
        desktopDownloadPromptEnabled: true,
        t3ClientModelSelectorEnabled: false,
      },
    });
    const fetchMock = vi.fn();

    installWindowStub({
      fetch: fetchMock as unknown as typeof fetch,
      desktopBridge: {
        getCommercialPublicRuntimeConfig,
      } as unknown as DesktopBridge,
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = await refreshCommercialPublicRuntimeConfig({ force: true });

    expect(config?.featureFlags.t3ClientModelSelectorEnabled).toBe(false);
    expect(getCommercialPublicRuntimeConfig).toHaveBeenCalledWith({
      accountWebBaseUrl: "https://www.bahew.com",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
