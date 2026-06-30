import type {
  DesktopBrowserAutomationState,
  DesktopComputerAutomationState,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useBrowserExternalPluginState } from "../browserExternalPluginState";
import {
  buildToolBridgeHealthItems,
  summarizeToolBridgeHealth,
} from "../lib/toolBridgeHealth";

export function useToolBridgeHealth() {
  const [browserState, setBrowserState] = useState<DesktopBrowserAutomationState | null>(null);
  const [computerState, setComputerState] = useState<DesktopComputerAutomationState | null>(null);
  const browserExternalPlugin = useBrowserExternalPluginState();
  const browserExternalState = browserExternalPlugin.state;

  const refreshBrowser = useCallback(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    if (!bridge?.getBrowserAutomationState) {
      setBrowserState(null);
      return;
    }
    void bridge
      .getBrowserAutomationState()
      .then(setBrowserState)
      .catch(() => setBrowserState(null));
  }, []);

  const refreshComputer = useCallback(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    if (!bridge?.getComputerAutomationState) {
      setComputerState(null);
      return;
    }
    void bridge
      .getComputerAutomationState()
      .then(setComputerState)
      .catch(() => setComputerState(null));
  }, []);

  const refreshBrowserExternal = browserExternalPlugin.refresh;

  useEffect(() => {
    refreshBrowser();
    refreshComputer();
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    const unsubscribeBrowser = bridge?.onBrowserAutomationState?.((state) =>
      setBrowserState(state),
    );
    const unsubscribeComputer = bridge?.onComputerAutomationState?.((state) =>
      setComputerState(state),
    );
    return () => {
      unsubscribeBrowser?.();
      unsubscribeComputer?.();
    };
  }, [refreshBrowser, refreshComputer]);

  const refreshAll = useCallback(() => {
    refreshBrowser();
    refreshBrowserExternal();
    refreshComputer();
  }, [refreshBrowser, refreshBrowserExternal, refreshComputer]);

  const items = useMemo(
    () =>
      buildToolBridgeHealthItems({
        browserState,
        browserExternalState,
        browserExternalInstalled: browserExternalPlugin.installed,
        computerState,
      }),
    [browserExternalPlugin.installed, browserExternalState, browserState, computerState],
  );

  const summary = useMemo(() => summarizeToolBridgeHealth(items), [items]);

  return {
    browserState,
    browserExternalPlugin,
    browserExternalState,
    computerState,
    items,
    refreshAll,
    refreshBrowser,
    refreshBrowserExternal,
    refreshComputer,
    setComputerState,
    summary,
  };
}
