import type { Command } from "../../commands.ts"
import { isClaudeAISubscriber } from "../../utils/auth.ts"

const rateLimitOptions = {
  type: 'local-jsx',
  name: 'rate-limit-options',
  description: 'Show options when rate limit is reached',
  isEnabled: () => {
    if (!isClaudeAISubscriber()) {
      return false
    }

    return true
  },
  isHidden: true, // Hidden from help - only used internally
  load: () => import('./rate-limit-options.tsx'),
} satisfies Command

export default rateLimitOptions
