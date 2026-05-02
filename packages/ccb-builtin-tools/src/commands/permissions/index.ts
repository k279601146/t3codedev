import type { Command } from "../../commands.ts"

const permissions = {
  type: 'local-jsx',
  name: 'permissions',
  aliases: ['allowed-tools'],
  description: 'Manage allow & deny tool permission rules',
  load: () => import('./permissions.tsx'),
} satisfies Command

export default permissions

