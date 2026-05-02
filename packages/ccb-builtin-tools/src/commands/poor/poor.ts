import type { LocalCommandCall } from "@t3tools/ccb-engine/src/types/command.ts"
import { isPoorModeActive, setPoorMode } from "./poorMode.ts"

export const call: LocalCommandCall = async (_, context) => {
  const currentlyActive = isPoorModeActive()
  const newState = !currentlyActive
  setPoorMode(newState)

  if (newState) {
    // Disable prompt suggestion in AppState
    context.setAppState(prev => ({
      ...prev,
      promptSuggestionEnabled: false,
    }))
  } else {
    // Re-enable prompt suggestion
    context.setAppState(prev => ({
      ...prev,
      promptSuggestionEnabled: true,
    }))
  }

  const status = newState ? 'ON' : 'OFF'
  const details = newState
    ? 'extract_memories and prompt_suggestion are disabled'
    : 'extract_memories and prompt_suggestion are restored'
  return { type: 'text', value: `Poor mode ${status} â€?${details}` }
}

