import type { Command } from "../../commands.ts"

export default {
  type: 'local-jsx',
  name: 'diff',
  description: 'View uncommitted changes and per-turn diffs',
  load: () => import('./diff.tsx'),
} satisfies Command
