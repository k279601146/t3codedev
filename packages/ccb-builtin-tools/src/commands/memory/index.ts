import type { Command } from "../../commands.ts"

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit Claude memory files',
  load: () => import('./memory.tsx'),
}

export default memory

