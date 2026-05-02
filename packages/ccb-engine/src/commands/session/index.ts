import { getIsRemoteMode } from "../../bootstrap/state.ts"
import type { Command } from "../../commands.ts"

const session = {
  type: 'local-jsx',
  name: 'session',
  aliases: ['remote'],
  description: 'Show remote session URL and QR code',
  isEnabled: () => getIsRemoteMode(),
  get isHidden() {
    return !getIsRemoteMode()
  },
  load: () => import('./session.tsx'),
} satisfies Command

export default session
