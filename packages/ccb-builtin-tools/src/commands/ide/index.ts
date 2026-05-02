import type { Command } from "../../commands.ts"

const ide = {
  type: 'local-jsx',
  name: 'ide',
  description: 'Manage IDE integrations and show status',
  argumentHint: '[open]',
  load: () => import('./ide.tsx'),
} satisfies Command

export default ide

