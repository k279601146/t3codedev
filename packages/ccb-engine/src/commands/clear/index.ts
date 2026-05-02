/**
 * Clear command - minimal metadata only.
 * Implementation is lazy-loaded from clear.ts to reduce startup time.
 * Utility functions:
 * - clearSessionCaches: import from "./clear/caches.ts"
 * - clearConversation: import from "./clear/conversation.ts"
 */
import type { Command } from "../../commands.ts"

const clear = {
  type: 'local',
  name: 'clear',
  description: 'Clear conversation history and free up context',
  aliases: ['reset', 'new'],
  supportsNonInteractive: false, // Should just create a new session
  load: () => import('./clear.ts'),
} satisfies Command

export default clear
