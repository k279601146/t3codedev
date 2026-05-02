import type { Command } from "../../commands.ts"

const peers = {
  type: 'local',
  name: 'peers',
  aliases: ['who'],
  description: 'List connected Claude Code peers',
  supportsNonInteractive: true,
  load: () => import('./peers.ts'),
} satisfies Command

export default peers
