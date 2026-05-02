import type { Command } from "../../commands.ts"

const pipeStatus = {
  type: 'local',
  name: 'pipe-status',
  description: 'Show current pipe connection status',
  supportsNonInteractive: true,
  load: () => import('./pipe-status.ts'),
} satisfies Command

export default pipeStatus

