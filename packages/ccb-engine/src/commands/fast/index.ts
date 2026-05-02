import type { Command } from "../../commands.ts"
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeEnabled,
} from "../../utils/fastMode.ts"
import { shouldInferenceConfigCommandBeImmediate } from "../../utils/immediateCommand.ts"

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return `Toggle fast mode (${FAST_MODE_MODEL_DISPLAY} only)`
  },
  availability: ['claude-ai', 'console'],
  isEnabled: () => isFastModeEnabled(),
  get isHidden() {
    return !isFastModeEnabled()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.tsx'),
} satisfies Command

export default fast
