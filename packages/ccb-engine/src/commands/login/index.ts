import type { Command } from "../../commands.ts"
import { hasAnthropicApiKeyAuth } from "../../utils/auth.ts"
import { isEnvTruthy } from "../../utils/envUtils.ts"

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasAnthropicApiKeyAuth()
      ? 'Switch Anthropic accounts'
      : 'Sign in with your Anthropic account',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.tsx'),
  }) satisfies Command
