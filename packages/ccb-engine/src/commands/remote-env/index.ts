import type { Command } from "../../commands.ts"
import { isPolicyAllowed } from "../../services/policyLimits/index.ts"
import { isClaudeAISubscriber } from "../../utils/auth.ts"

export default {
  type: 'local-jsx',
  name: 'remote-env',
  description: 'Configure the default remote environment for teleport sessions',
  isEnabled: () =>
    isClaudeAISubscriber() && isPolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return !isClaudeAISubscriber() || !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('./remote-env.tsx'),
} satisfies Command
