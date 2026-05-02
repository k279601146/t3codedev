import type { Command } from "../../commands.ts"

const skills = {
  type: 'local-jsx',
  name: 'skills',
  description: 'List available skills',
  load: () => import('./skills.tsx'),
} satisfies Command

export default skills
