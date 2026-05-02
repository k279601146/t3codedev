// Host dependency injection â€?assembles McpClientDependencies from host infrastructure
// This is the single entry point for creating the dependencies object used by createMcpManager()

import type { McpClientDependencies } from '@claude-code-best/mcp-client/index.ts'
import { createMcpLogger } from "./logger.ts"
import { createMcpHttpConfig } from "./httpConfig.ts"
import { createMcpProxyConfig } from "./proxy.ts"
import { createMcpAnalytics } from "./analytics.ts"
import { createMcpSubprocessEnv } from "./subprocessEnv.ts"
import { createMcpStorage } from "./storage.ts"
import { createMcpImageProcessor } from "./imageProcessor.ts"
import { createMcpAuth } from "./auth.ts"
/**
 * Creates the full set of MCP client dependencies using host infrastructure.
 * All adapters are lazy â€?they only call into host modules when invoked.
 *
 * Note: featureGate is omitted because Bun's feature() requires string-literal
 * arguments at compile time and cannot accept runtime variables. The interface
 * field is optional and the mcp-client package does not use it currently.
 */
export function createMcpDependencies(): McpClientDependencies {
  return {
    logger: createMcpLogger(),
    httpConfig: createMcpHttpConfig(),
    proxy: createMcpProxyConfig(),
    analytics: createMcpAnalytics(),
    subprocessEnv: createMcpSubprocessEnv(),
    storage: createMcpStorage(),
    imageProcessor: createMcpImageProcessor(),
    auth: createMcpAuth(),
  }
}

