import type { Command } from "../../commands.ts"

const pipes = {
  type: 'local',
  name: 'pipes',
  description: 'Inspect pipe registry state and toggle the pipe selector',
  supportsNonInteractive: true,
  load: () => import('./pipes.ts'),
} satisfies Command

export default pipes

