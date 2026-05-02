import { getIsNonInteractiveSession } from "@t3tools/ccb-engine/src/bootstrap/state.ts"
import type { Command } from "../../commands.ts"

const command: Command = {
  name: 'chrome',
  description: 'Claude in Chrome (Beta) settings',
  availability: [],
  isEnabled: () => !getIsNonInteractiveSession(),
  type: 'local-jsx',
  load: () => import('./chrome.tsx'),
}

export default command

