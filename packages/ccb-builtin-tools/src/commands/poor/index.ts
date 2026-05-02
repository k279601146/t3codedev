import type { Command } from "../../commands.ts"

const poor = {
  type: 'local',
  name: 'poor',
  description:
    'Toggle poor mode â€?disable extract_memories and prompt_suggestion to save tokens',
  supportsNonInteractive: false,
  load: () => import('./poor.ts'),
} satisfies Command

export default poor

