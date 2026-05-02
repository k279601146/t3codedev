import type { UUID } from 'crypto'
import { getSessionId } from "@t3tools/ccb-engine/src/bootstrap/state.ts"
import {
  getBridgeBaseUrlOverride,
  getBridgeTokenOverride,
} from "../../bridge/bridgeConfig.ts"
import type { ToolUseContext } from "@t3tools/ccb-engine/src/Tool.ts"
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from "@t3tools/ccb-engine/src/types/command.ts"
import { getMessagesAfterCompactBoundary } from "@t3tools/ccb-engine/src/utils/messages.ts"
import {
  getTranscriptPath,
  saveAgentName,
  saveCustomTitle,
} from "@t3tools/ccb-engine/src/utils/sessionStorage.ts"
import { isTeammate } from "@t3tools/ccb-engine/src/utils/teammate.ts"
import { generateSessionName } from "./generateSessionName.ts"

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  // Prevent teammates from renaming - their names are set by team leader
  if (isTeammate()) {
    onDone(
      'Cannot rename: This session is a swarm teammate. Teammate names are set by the team leader.',
      { display: 'system' },
    )
    return null
  }

  let newName: string
  if (!args || args.trim() === '') {
    const generated = await generateSessionName(
      getMessagesAfterCompactBoundary(context.messages),
      context.abortController.signal,
    )
    if (!generated) {
      onDone(
        'Could not generate a name: no conversation context yet. Usage: /rename <name>',
        { display: 'system' },
      )
      return null
    }
    newName = generated
  } else {
    newName = args.trim()
  }

  const sessionId = getSessionId() as UUID
  const fullPath = getTranscriptPath()

  // Always save the custom title (session name)
  await saveCustomTitle(sessionId, newName, fullPath)

  // Sync title to bridge session on claude.ai/code (best-effort, non-blocking).
  // v2 env-less bridge stores cse_* in replBridgeSessionId â€?
  // updateBridgeSessionTitle retags internally for the compat endpoint.
  const appState = context.getAppState()
  const bridgeSessionId = appState.replBridgeSessionId
  if (bridgeSessionId) {
    const tokenOverride = getBridgeTokenOverride()
    void import('../../bridge/createSession.ts').then(
      ({ updateBridgeSessionTitle }) =>
        updateBridgeSessionTitle(bridgeSessionId, newName, {
          baseUrl: getBridgeBaseUrlOverride(),
          getAccessToken: tokenOverride ? () => tokenOverride : undefined,
        }).catch(() => {}),
    )
  }

  // Also persist as the session's agent name for prompt-bar display
  await saveAgentName(sessionId, newName, fullPath)
  context.setAppState(prev => ({
    ...prev,
    standaloneAgentContext: {
      ...prev.standaloneAgentContext,
      name: newName,
    },
  }))

  onDone(`Session renamed to: ${newName}`, { display: 'system' })
  return null
}

