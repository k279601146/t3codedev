import type { Command } from "../../commands.ts"

const send = {
  type: 'local',
  name: 'send',
  description: 'Send a message to a connected sub CLI',
  supportsNonInteractive: false,
  load: () => import('./send.ts'),
} satisfies Command

export default send

