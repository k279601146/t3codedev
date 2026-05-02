import type { Command } from "../../commands.ts"
import { shouldInferenceConfigCommandBeImmediate } from "@t3tools/ccb-engine/src/utils/immediateCommand.ts"
import { getMainLoopModel, renderModelName } from "@t3tools/ccb-engine/src/utils/model/model.ts"

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

