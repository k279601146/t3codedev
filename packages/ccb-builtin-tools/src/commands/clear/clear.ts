import type { LocalCommandCall } from "@t3tools/ccb-engine/src/types/command.ts"
import { clearConversation } from "./conversation.ts"

export const call: LocalCommandCall = async (_, context) => {
  await clearConversation(context)
  return { type: 'text', value: '' }
}

