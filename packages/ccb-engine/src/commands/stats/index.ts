import type { Command } from "../../commands.ts"

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: 'Show your Claude Code usage statistics and activity',
  load: () => import('./stats.tsx'),
} satisfies Command

export default stats
