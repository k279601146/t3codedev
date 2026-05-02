import type { Command } from "../../commands.ts"

const claimMain = {
  type: 'local',
  name: 'claim-main',
  description:
    'Claim main role for this machine (overrides current main machine)',
  supportsNonInteractive: false,
  load: () => import('./claim-main.ts'),
} satisfies Command

export default claimMain
