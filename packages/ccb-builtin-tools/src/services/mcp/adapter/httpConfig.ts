// Host HTTP config adapter â€?bridges getUserAgent/getSessionId to mcp-client's HttpConfig interface

import type { HttpConfig } from '@claude-code-best/mcp-client/index.ts'
import { getMCPUserAgent } from "../../../utils/http.ts"
import { getSessionId } from "../../../bootstrap/state.ts"

/**
 * Creates an HttpConfig implementation using the host's user agent and session ID.
 */
export function createMcpHttpConfig(): HttpConfig {
  return {
    getUserAgent: () => getMCPUserAgent(),
    getSessionId: () => getSessionId(),
  }
}

