// mcp-client 鈥?MCP protocol client
// Strict protocol layer: connection, transport, tool discovery, execution

// Types & schemas
export {
  ConfigScope,
  TransportType,
  McpStdioServerConfigSchema,
  McpSSEServerConfigSchema,
  McpHTTPServerConfigSchema,
  McpWebSocketServerConfigSchema,
  McpSdkServerConfigSchema,
  McpClaudeAIProxyServerConfigSchema,
  McpServerConfigSchema,
  McpJsonConfigSchema,
} from "./types.ts"

export type {
  ConfigScope as ConfigScopeType,
  Transport,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpSSEIDEServerConfig,
  McpWebSocketIDEServerConfig,
  McpHTTPServerConfig,
  McpWebSocketServerConfig,
  McpSdkServerConfig,
  McpClaudeAIProxyServerConfig,
  McpServerConfig,
  ScopedMcpServerConfig,
  McpJsonConfig,
  MCPServerConnection,
  ConnectedMCPServer,
  FailedMCPServer,
  NeedsAuthMCPServer,
  PendingMCPServer,
  DisabledMCPServer,
  ServerResource,
  SerializedTool,
  SerializedClient,
  MCPCliState,
} from "./types.ts"

// Errors
export {
  McpError,
  McpConnectionError,
  McpAuthError,
  McpTimeoutError,
  McpToolCallError,
  McpSessionExpiredError,
} from "./errors.ts"

// Interfaces (host dependency injection)
export type {
  Logger,
  AnalyticsSink,
  FeatureGate,
  AuthProvider,
  ProxyConfig,
  ContentStorage,
  ImageProcessor,
  HttpConfig,
  SubprocessEnvProvider,
  McpClientDependencies,
} from "./interfaces.ts"

// Transport
export { createLinkedTransportPair } from "./transport/InProcessTransport.ts"

// String utilities
export {
  buildMcpToolName,
  normalizeNameForMCP,
  mcpInfoFromString,
  getMcpPrefix,
  getToolNameForPermissionCheck,
  getMcpDisplayName,
  extractMcpToolDisplayName,
} from "./strings.ts"

// Cache
export { memoizeWithLRU } from "./cache.ts"

// Sanitization
export { recursivelySanitizeUnicode } from "./sanitization.ts"

// Connection utilities
export {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  MAX_MCP_DESCRIPTION_LENGTH,
  MAX_ERRORS_BEFORE_RECONNECT,
  createMcpClient,
  withConnectionTimeout,
  captureStderr,
  isTerminalConnectionError,
  isMcpSessionExpiredError,
  installConnectionMonitor,
  terminateWithSignalEscalation,
  createCleanup,
  buildConnectedServer,
} from "./connection.ts"
export type {
  CreateClientOptions,
  ConnectionMonitorOptions,
  CleanupOptions,
  BuildConnectedServerOptions,
} from "./connection.ts"

// Tool discovery
export {
  MCP_FETCH_CACHE_SIZE,
  discoverTools,
  createCachedToolDiscovery,
} from "./discovery.ts"
export type { DiscoveryOptions } from "./discovery.ts"

// Tool execution
export { callMcpTool } from "./execution.ts"
export type { CallToolOptions, CallToolResult } from "./execution.ts"

// Manager (main API)
export { createMcpManager } from "./manager.ts"
export type { McpManager } from "./manager.ts"
