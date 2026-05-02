import type { Command } from "../../commands.ts"
import { isEnvTruthy } from "@t3tools/ccb-engine/src/utils/envUtils.ts"

const installGitHubApp = {
  type: 'local-jsx',
  name: 'install-github-app',
  description: 'Set up Claude GitHub Actions for a repository',
  availability: ['claude-ai', 'console'],
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_INSTALL_GITHUB_APP_COMMAND),
  load: () => import('./install-github-app.tsx'),
} satisfies Command

export default installGitHubApp

