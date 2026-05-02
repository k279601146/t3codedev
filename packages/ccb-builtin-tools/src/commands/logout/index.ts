import type { Command } from "../../commands.ts"
import { isEnvTruthy } from "@t3tools/ccb-engine/src/utils/envUtils.ts"

export default {
  type: 'local-jsx',
  name: 'logout',
  description: 'Sign out from your Anthropic account',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGOUT_COMMAND),
  load: () => import('./logout.tsx'),
} satisfies Command

