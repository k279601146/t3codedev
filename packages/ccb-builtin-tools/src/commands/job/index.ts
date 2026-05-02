import type { Command } from "../../commands.ts"
import {  feature  } from "../../featureFlags.ts";

const job = {
  type: 'local-jsx',
  name: 'job',
  description: 'Manage template jobs',
  argumentHint: '[list|new|reply|status]',
  isEnabled: () => {
    if (feature('TEMPLATES')) return true
    return false
  },
  load: () => import('./job.tsx'),
} satisfies Command

export default job

