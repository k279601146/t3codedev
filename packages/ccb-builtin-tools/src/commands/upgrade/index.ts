import type { Command } from "../../commands.ts"
import { getSubscriptionType } from "@t3tools/ccb-engine/src/utils/auth.ts"
import { isEnvTruthy } from "@t3tools/ccb-engine/src/utils/envUtils.ts"

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: 'Upgrade to Max for higher rate limits and more Opus',
  availability: ['claude-ai'],
  isEnabled: () =>
    !isEnvTruthy(process.env.DISABLE_UPGRADE_COMMAND) &&
    getSubscriptionType() !== 'enterprise',
  load: () => import('./upgrade.tsx'),
} satisfies Command

export default upgrade

