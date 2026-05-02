import {  feature  } from "../../featureFlags.ts";
import { useEffect, useRef } from 'react'
import { useNotifications } from "../../context/notifications.tsx"
import { toError } from "@t3tools/ccb-engine/src/utils/errors.ts"
import { logError } from "@t3tools/ccb-engine/src/utils/log.ts"
import { getIsRemoteMode } from "@t3tools/ccb-engine/src/bootstrap/state.ts"
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from "@t3tools/ccb-engine/src/state/AppState.tsx"
import type { ToolPermissionContext } from "@t3tools/ccb-engine/src/Tool.ts"
import { verifyAutoModeGateAccess } from "./permissionSetup.ts"

/**
 * No-op ï¿?bypass permissions is always available.
 */
export async function checkAndDisableBypassPermissionsIfNeeded(
  _toolPermissionContext: ToolPermissionContext,
  _setAppState: (
    f: (
      prev: import('../../state/AppState.tsx').AppState,
    ) => import('../../state/AppState.tsx').AppState,
  ) => void,
): Promise<void> {
  // Bypass permissions is always available ï¿?no gate check needed
}

/**
 * Reset stub ï¿?kept for interface compatibility.
 */
export function resetBypassPermissionsCheck(): void {
  // No-op
}

/**
 * No-op hook ï¿?bypass permissions is always available.
 */
export function useKickOffCheckAndDisableBypassPermissionsIfNeeded(): void {
  // No-op
}

let autoModeCheckRan = false

export async function checkAndDisableAutoModeIfNeeded(
  toolPermissionContext: ToolPermissionContext,
  setAppState: (
    f: (
      prev: import('../../state/AppState.tsx').AppState,
    ) => import('../../state/AppState.tsx').AppState,
  ) => void,
  fastMode?: boolean,
): Promise<void> {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (autoModeCheckRan) {
      return
    }
    autoModeCheckRan = true

    const { updateContext, notification } = await verifyAutoModeGateAccess(
      toolPermissionContext,
      fastMode,
    )
    setAppState(prev => {
      const nextCtx = updateContext(prev.toolPermissionContext)
      const newState =
        nextCtx === prev.toolPermissionContext
          ? prev
          : { ...prev, toolPermissionContext: nextCtx }
      if (!notification) return newState
      return {
        ...newState,
        notifications: {
          ...newState.notifications,
          queue: [
            ...newState.notifications.queue,
            {
              key: 'auto-mode-gate-notification',
              text: notification,
              color: 'warning' as const,
              priority: 'high' as const,
            },
          ],
        },
      }
    })
  }
}

/**
 * Reset the run-once flag for checkAndDisableAutoModeIfNeeded.
 * Call this after /login so the gate check re-runs with the new org.
 */
export function resetAutoModeGateCheck(): void {
  autoModeCheckRan = false
}

export function useKickOffCheckAndDisableAutoModeIfNeeded(): void {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const fastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const store = useAppStateStore()
  const isFirstRunRef = useRef(true)

  // Runs on mount (startup check) AND whenever the model or fast mode changes
  useEffect(() => {
    if (getIsRemoteMode()) return
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false
    } else {
      resetAutoModeGateCheck()
    }
    void checkAndDisableAutoModeIfNeeded(
      store.getState().toolPermissionContext,
      setAppState,
      fastMode,
    ).catch(error => {
      logError(
        new Error('Auto mode gate check failed', { cause: toError(error) }),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainLoopModel, mainLoopModelForSession, fastMode])
}

