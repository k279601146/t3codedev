// Host subprocess environment adapter

import type { SubprocessEnvProvider } from '@claude-code-best/mcp-client/index.ts'
import { subprocessEnv } from "../../../utils/subprocessEnv.ts"

/**
 * Creates a SubprocessEnvProvider using the host's subprocess environment logic.
 */
export function createMcpSubprocessEnv(): SubprocessEnvProvider {
  return {
    getEnv(additional?: Record<string, string>) {
      return { ...subprocessEnv(), ...additional } as Record<string, string>
    },
  }
}
