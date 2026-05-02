import type { Command } from "../../commands.ts"
import { shouldInferenceConfigCommandBeImmediate } from "../../utils/immediateCommand.ts"
import { getMainLoopModel, renderModelName } from "../../utils/model/model.ts"

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Set the AI model for Claude Code (currently ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.tsx'),
} satisfies Command
