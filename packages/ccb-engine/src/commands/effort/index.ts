import type { Command } from "../../commands.ts"
import { shouldInferenceConfigCommandBeImmediate } from "../../utils/immediateCommand.ts"

export default {
  type: 'local-jsx',
  name: 'effort',
  description: 'Set effort level for model usage',
  argumentHint: '[low|medium|high|xhigh|max|auto]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./effort.tsx'),
} satisfies Command
