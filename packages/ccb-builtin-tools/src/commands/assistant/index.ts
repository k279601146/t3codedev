import type { Command } from "../../commands.ts"
import { isAssistantEnabled } from "./gate.ts"

const assistant = {
  type: 'local-jsx',
  name: 'assistant',
  description: 'Open the Kairos assistant panel',
  isEnabled: isAssistantEnabled,
  get isHidden() {
    return !isAssistantEnabled()
  },
  immediate: true,
  load: () => import('./assistant.tsx'),
} satisfies Command

export default assistant

