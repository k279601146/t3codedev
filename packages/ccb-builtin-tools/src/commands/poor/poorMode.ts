/**
 * Poor mode state â€?when active, skips extract_memories and prompt_suggestion
 * to reduce token consumption.
 *
 * Persisted to settings.json so it survives session restarts.
 */

import {
  getInitialSettings,
  updateSettingsForSource,
} from "@t3tools/ccb-engine/src/utils/settings/settings.ts"

let poorModeActive: boolean | null = null

export function isPoorModeActive(): boolean {
  if (poorModeActive === null) {
    poorModeActive = getInitialSettings().poorMode === true
  }
  return poorModeActive
}

export function setPoorMode(active: boolean): void {
  poorModeActive = active
  updateSettingsForSource('userSettings', {
    poorMode: active || undefined,
  })
}

