import type { Command } from "../../commands.ts"

const config = {
  aliases: ['settings'],
  type: 'local-jsx',
  name: 'config',
  description: 'Open config panel',
  load: () => import('./config.tsx'),
} satisfies Command

export default config
