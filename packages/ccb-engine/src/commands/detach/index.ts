import type { Command } from "../../commands.ts"

const detach = {
  type: 'local',
  name: 'detach',
  description: 'Detach from a sub CLI (or all connected subs)',
  supportsNonInteractive: false,
  load: () => import('./detach.ts'),
} satisfies Command

export default detach
