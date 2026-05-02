import type { Command } from "../../commands.ts"
import { getFeatureValue_CACHED_MAY_BE_STALE } from "../../services/analytics/growthbook.ts"
import { isPolicyAllowed } from "../../services/policyLimits/index.ts"

const web = {
  type: 'local-jsx',
  name: 'web-setup',
  description:
    'Setup Claude Code on the web (requires connecting your GitHub account)',
  availability: ['claude-ai'],
  isEnabled: () =>
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_lantern', false) &&
    isPolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('./remote-setup.tsx'),
} satisfies Command

export default web
