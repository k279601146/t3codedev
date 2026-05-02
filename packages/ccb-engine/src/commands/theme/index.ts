import type { Command } from "../../commands.ts"

const theme = {
  type: 'local-jsx',
  name: 'theme',
  description: 'Change the theme',
  load: () => import('./theme.tsx'),
} satisfies Command

export default theme
