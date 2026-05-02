import type { LocalCommandCall } from "../../types/command.ts"
import { clearConversation } from "./conversation.ts"

export const call: LocalCommandCall = async (_, context) => {
  await clearConversation(context)
  return { type: 'text', value: '' }
}
