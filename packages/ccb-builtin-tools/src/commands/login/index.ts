import type { Command } from "../../commands.ts"
import { hasAnthropicApiKeyAuth } from "@t3tools/ccb-engine/src/utils/auth.ts"
import { isEnvTruthy } from "@t3tools/ccb-engine/src/utils/envUtils.ts"

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

