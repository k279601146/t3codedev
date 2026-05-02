import type { Command } from "../../commands.ts"

const rename = {
  type: 'local-jsx',
  name: 'rename',
  description: 'Rename the current conversation',
  immediate: true,
  argumentHint: '[name]',
  load: () => import('./rename.ts'),
} satisfies Command

export default rename
