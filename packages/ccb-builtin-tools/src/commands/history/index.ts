import type { Command } from "../../commands.ts"

const history = {
  type: 'local',
  name: 'history',
  aliases: ['hist'],
  description: 'View session history of a connected sub CLI',
  supportsNonInteractive: false,
  load: () => import('./history.ts'),
} satisfies Command

export default history

