import type { Command } from "../../commands.ts"

const lang = {
  type: 'local-jsx',
  name: 'lang',
  description: 'Set display language (en/zh/auto)',
  immediate: true,
  argumentHint: '<en|zh|auto>',
  load: () => import('./lang.ts'),
} satisfies Command

export default lang

