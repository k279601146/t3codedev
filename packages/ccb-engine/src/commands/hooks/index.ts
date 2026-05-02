import type { Command } from "../../commands.ts"

const hooks = {
  type: 'local-jsx',
  name: 'hooks',
  description: 'View hook configurations for tool events',
  immediate: true,
  load: () => import('./hooks.tsx'),
} satisfies Command

export default hooks
