import React from 'react';
import { getIsInteractive } from "../../bootstrap/state.ts";
import { ManagedSettingsSecurityDialog } from "../../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.ts";
import {
  extractDangerousSettings,
  hasDangerousSettings,
  hasDangerousSettingsChanged,
} from "../../components/ManagedSettingsSecurityDialog/utils.ts";
import { wrappedRender as render } from '@anthropic/ink';
import { KeybindingSetup } from "../../keybindings/KeybindingProviderSetup.tsx";
import { AppStateProvider } from "../../state/AppState.tsx";
import { gracefulShutdownSync } from "../../utils/gracefulShutdown.ts";
import { getBaseRenderOptions } from "../../utils/renderOptions.ts";
import type { SettingsJson } from "../../utils/settings/types.ts";
import { logEvent } from "../analytics/index.ts";

export type SecurityCheckResult = 'approved' | 'rejected' | 'no_check_needed';

/**
 * Check if new remote managed settings contain dangerous settings that require user approval.
 * Shows a blocking dialog if dangerous settings have changed or been added.
 *
 * @param cachedSettings The current cached settings (may be null for first run)
 * @param newSettings The new settings fetched from the API
 * @returns 'approved' if user accepts, 'rejected' if user declines, 'no_check_needed' if no dangerous changes
 */
export async function checkManagedSettingsSecurity(
  cachedSettings: SettingsJson | null,
  newSettings: SettingsJson | null,
): Promise<SecurityCheckResult> {
  // If new settings don't have dangerous settings, no check needed
  if (!newSettings || !hasDangerousSettings(extractDangerousSettings(newSettings))) {
    return 'no_check_needed';
  }

  // If dangerous settings haven't changed, no check needed
  if (!hasDangerousSettingsChanged(cachedSettings, newSettings)) {
    return 'no_check_needed';
  }

  // Skip dialog in non-interactive mode (consistent with trust dialog behavior)
  if (!getIsInteractive()) {
    return 'no_check_needed';
  }

  // Log that dialog is being shown
  logEvent('tengu_managed_settings_security_dialog_shown', {});

  // Show blocking dialog
  return new Promise<SecurityCheckResult>(resolve => {
    void (async () => {
      const { unmount } = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <ManagedSettingsSecurityDialog
              settings={newSettings}
              onAccept={() => {
                logEvent('tengu_managed_settings_security_dialog_accepted', {});
                unmount();
                void resolve('approved');
              }}
              onReject={() => {
                logEvent('tengu_managed_settings_security_dialog_rejected', {});
                unmount();
                void resolve('rejected');
              }}
            />
          </KeybindingSetup>
        </AppStateProvider>,
        getBaseRenderOptions(false),
      );
    })();
  });
}

/**
 * Handle the security check result by exiting if rejected
 * Returns true if we should continue, false if we should stop
 */
export function handleSecurityCheckResult(result: SecurityCheckResult): boolean {
  if (result === 'rejected') {
    gracefulShutdownSync(1);
    return false;
  }
  return true;
}
