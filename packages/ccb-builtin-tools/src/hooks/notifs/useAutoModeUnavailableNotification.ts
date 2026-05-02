import {  feature  } from "../../featureFlags.ts";
import { useEffect, useRef } from 'react'
import { useNotifications } from "../../context/notifications.tsx"
import { getIsRemoteMode } from "@t3tools/ccb-engine/src/bootstrap/state.ts"
import { useAppState } from "@t3tools/ccb-engine/src/state/AppState.tsx"
import type { PermissionMode } from "@t3tools/ccb-engine/src/utils/permissions/PermissionMode.ts"
import {
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
} from "@t3tools/ccb-engine/src/utils/permissions/permissionSetup.ts"
import { hasAutoModeOptIn } from "@t3tools/ccb-engine/src/utils/settings/settings.ts"

/**
 * Shows a one-shot notification when the shift-tab carousel wraps past where
 * auto mode would have been. Covers all reasons (settings, circuit-breaker,
 * org-allowlist). The startup case (defaultMode: auto silently downgraded) is
 * handled by verifyAutoModeGateAccess ï¿?checkAndDisableAutoModeIfNeeded.
 */
export function useAutoModeUnavailableNotification(): void {
  const { addNotification } = useNotifications()
  const mode = useAppState(s => s.toolPermissionContext.mode)
  const isAutoModeAvailable = useAppState(
    s => s.toolPermissionContext.isAutoModeAvailable,
  )
  const shownRef = useRef(false)
  const prevModeRef = useRef<PermissionMode>(mode)

  useEffect(() => {
    const prevMode = prevModeRef.current
    prevModeRef.current = mode

    if (!feature('TRANSCRIPT_CLASSIFIER')) return
    if (getIsRemoteMode()) return
    if (shownRef.current) return

    const wrappedPastAutoSlot =
      mode === 'default' &&
      prevMode !== 'default' &&
      prevMode !== 'auto' &&
      !isAutoModeAvailable &&
      hasAutoModeOptIn()

    if (!wrappedPastAutoSlot) return

    const reason = getAutoModeUnavailableReason()
    if (!reason) return

    shownRef.current = true
    addNotification({
      key: 'auto-mode-unavailable',
      text: getAutoModeUnavailableNotification(reason),
      color: 'warning',
      priority: 'medium',
    })
  }, [mode, isAutoModeAvailable, addNotification])
}

