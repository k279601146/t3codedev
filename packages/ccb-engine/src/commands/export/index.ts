import type { Command } from "../../commands.ts"

const exportCommand = {
  type: 'local-jsx',
  name: 'export',
  description: 'Export the current conversation to a file or clipboard',
  argumentHint: '[filename]',
  load: () => import('./export.tsx'),
} satisfies Command

export default exportCommand
