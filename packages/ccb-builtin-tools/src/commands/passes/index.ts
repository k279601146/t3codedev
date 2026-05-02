import type { Command } from "../../commands.ts"
import {
  checkCachedPassesEligibility,
  getCachedReferrerReward,
} from "@t3tools/ccb-engine/src/services/api/referral.ts"

export default {
  type: 'local-jsx',
  name: 'passes',
  get description() {
    const reward = getCachedReferrerReward()
    if (reward) {
      return 'Share a free week of Claude Code with friends and earn extra usage'
    }
    return 'Share a free week of Claude Code with friends'
  },
  get isHidden() {
    const { eligible, hasCache } = checkCachedPassesEligibility()
    return !eligible || !hasCache
  },
  load: () => import('./passes.tsx'),
} satisfies Command

