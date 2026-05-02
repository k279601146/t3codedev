import type { Command } from "../../commands.ts"
import { isConsumerSubscriber } from "@t3tools/ccb-engine/src/utils/auth.ts"

const privacySettings = {
  type: 'local-jsx',
  name: 'privacy-settings',
  description: 'View and update your privacy settings',
  isEnabled: () => {
    return isConsumerSubscriber()
  },
  load: () => import('./privacy-settings.tsx'),
} satisfies Command

export default privacySettings

