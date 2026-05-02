import type { Command } from "../../commands.ts"

const tasks = {
  type: 'local-jsx',
  name: 'tasks',
  aliases: ['bashes'],
  description: 'List and manage background tasks',
  load: () => import('./tasks.tsx'),
} satisfies Command

export default tasks

