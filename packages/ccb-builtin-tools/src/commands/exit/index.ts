import type { Command } from "../../commands.ts"

const exit = {
  type: 'local-jsx',
  name: 'exit',
  aliases: ['quit'],
  description: 'Exit the REPL',
  immediate: true,
  load: () => import('./exit.tsx'),
} satisfies Command

export default exit

