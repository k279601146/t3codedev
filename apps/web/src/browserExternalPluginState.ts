import type { DesktopBrowserExternalAutomationState } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useState } from "react";

import { useLocalStorage } from "./hooks/useLocalStorage";

export const BROWSER_EXTERNAL_PLUGIN_INSTALLED_KEY = "t3code:browser-external-plugin-installed:v1";

export function useBrowserExternalPluginState() {
  const [installed, setInstalled] = useLocalStorage(
    BROWSER_EXTERNAL_PLUGIN_INSTALLED_KEY,
    false,
    Schema.Boolean,
  );
  const [state, setState] = useState<DesktopBrowserExternalAutomationState | null>(null);

  const refresh = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getBrowserExternalAutomationState) {
      setState(null);
      return;
    }
    void bridge
      .getBrowserExternalAutomationState()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    refresh();
    return window.desktopBridge?.onBrowserExternalAutomationState?.(setState);
  }, [refresh]);

  useEffect(() => {
    if (state?.connected && !installed) {
      setInstalled(true);
    }
  }, [installed, setInstalled, state?.connected]);

  return {
    installed,
    setInstalled,
    state,
    connected: installed && state?.connected === true,
    refresh,
  };
}

export function promptUsesChromePlugin(prompt: string): boolean {
  return /(^|\s)@chrome(?=\s|$)/i.test(prompt);
}
