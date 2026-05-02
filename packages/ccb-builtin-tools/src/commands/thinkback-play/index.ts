import type { Command } from "../../commands.ts"
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from "@t3tools/ccb-engine/src/services/analytics/growthbook.ts"

// Hidden command that just plays the animation
// Called by the thinkback skill after generation is complete
const thinkbackPlay = {
  type: 'local',
  name: 'thinkback-play',
  description: 'Play the thinkback animation',
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  isHidden: true,
  supportsNonInteractive: false,
  load: () => import('./thinkback-play.ts'),
} satisfies Command

export default thinkbackPlay

