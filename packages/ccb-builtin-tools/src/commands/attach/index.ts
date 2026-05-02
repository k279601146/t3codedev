import type { Command } from "../../commands.ts"

const attach = {
  type: 'local',
  name: 'attach',
  description: 'Attach to a sub Claude CLI instance via named pipe',
  supportsNonInteractive: false,
  load: () => import('./attach.ts'),
} satisfies Command

export default attach

