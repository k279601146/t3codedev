import type { Command } from "../../commands.ts"
import { isBuddyLive } from "../../buddy/useBuddyNotification.tsx"

const buddy = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Hatch a coding companion · pet, off',
  argumentHint: '[pet|off]',
  immediate: true,
  get isHidden() {
    return !isBuddyLive()
  },
  load: () => import('./buddy.ts'),
} satisfies Command

export default buddy

