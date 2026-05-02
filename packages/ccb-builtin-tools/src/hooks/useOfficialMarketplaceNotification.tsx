import * as React from 'react';
import type { Notification } from "../context/notifications.tsx";
import { Text } from '@anthropic/ink';
import { logForDebugging } from "../utils/debug.ts";
import { checkAndInstallOfficialMarketplace } from "../utils/plugins/officialMarketplaceStartupCheck.ts";
import { useStartupNotification } from "./notifs/useStartupNotification.ts";

/**
 * Hook that handles official marketplace auto-installation and shows
 * notifications for success/failure in the bottom right of the REPL.
 */
export function useOfficialMarketplaceNotification(): void {
  useStartupNotification(async () => {
    const result = await checkAndInstallOfficialMarketplace();
    const notifs: Notification[] = [];

    // Check for config save failure first - this is critical
    if (result.configSaveFailed) {
      logForDebugging('Showing marketplace config save failure notification');
      notifs.push({
        key: 'marketplace-config-save-failed',
        jsx: <Text color="error">Failed to save marketplace retry info Â· Check ~/.claude.json permissions</Text>,
        priority: 'immediate',
        timeoutMs: 10000,
      });
    }

    if (result.installed) {
      logForDebugging('Showing marketplace installation success notification');
      notifs.push({
        key: 'marketplace-installed',
        jsx: <Text color="success">âœ?Anthropic marketplace installed Â· /plugin to see available plugins</Text>,
        priority: 'immediate',
        timeoutMs: 7000,
      });
    } else if (result.skipped && result.reason === 'unknown') {
      logForDebugging('Showing marketplace installation failure notification');
      notifs.push({
        key: 'marketplace-install-failed',
        jsx: <Text color="warning">Failed to install Anthropic marketplace Â· Will retry on next startup</Text>,
        priority: 'immediate',
        timeoutMs: 8000,
      });
    }
    // Don't show notifications for:
    // - already_installed (user already has it)
    // - policy_blocked (enterprise policy, don't nag)
    // - already_attempted (handled by retry logic now)
    // - git_unavailable (marketplace is a nice-to-have; if git is missing
    //   or is a non-functional macOS xcrun shim, retry silently on backoff
    //   rather than nagging â€?the user will sort git out for other reasons)
    return notifs;
  });
}

