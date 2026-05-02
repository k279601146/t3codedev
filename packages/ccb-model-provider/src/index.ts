// @ant/model-provider
// Model provider abstraction layer for Claude Code
//
// This package owns the model calling logic and provides:
// - Core query functions (queryModelWithStreaming, etc.)
// - Provider implementations (Anthropic, OpenAI, Gemini, Grok)
// - Type definitions (Message, Tool, Usage, etc.)
// - Dependency injection hooks (analytics, cost tracking, etc.)
//
// Initialization:
//   registerClientFactories({ ... })  // inject auth clients
//   registerHooks({ ... })            // inject analytics/cost/logging

// Hooks (dependency injection)
export { registerHooks, getHooks } from "./hooks/index.ts"
export type { ModelProviderHooks } from "./hooks/types.ts"

// Client factories
export { registerClientFactories, getClientFactories } from "./client/index.ts"
export type { ClientFactories } from "./client/types.ts"

// Types
export * from "./types/index.ts"

// Provider model mappings
export { resolveOpenAIModel } from "./providers/openai/modelMapping.ts"
export { resolveGrokModel } from "./providers/grok/modelMapping.ts"
export { resolveGeminiModel } from "./providers/gemini/modelMapping.ts"

// Gemini provider utilities
export { anthropicMessagesToGemini } from "./providers/gemini/convertMessages.ts"
export {
  anthropicToolsToGemini,
  anthropicToolChoiceToGemini,
} from "./providers/gemini/convertTools.ts"
export { adaptGeminiStreamToAnthropic } from "./providers/gemini/streamAdapter.ts"
export {
  GEMINI_THOUGHT_SIGNATURE_FIELD,
  type GeminiContent,
  type GeminiGenerateContentRequest,
  type GeminiPart,
  type GeminiStreamChunk,
  type GeminiTool,
  type GeminiFunctionCallingConfig,
  type GeminiFunctionDeclaration,
  type GeminiFunctionCall,
  type GeminiFunctionResponse,
  type GeminiInlineData,
  type GeminiUsageMetadata,
  type GeminiCandidate,
} from "./providers/gemini/types.ts"

// Error utilities
export {
  formatAPIError,
  extractConnectionErrorDetails,
  sanitizeAPIError,
  getSSLErrorHint,
  type ConnectionErrorDetails,
} from "./errorUtils.ts"

// Shared OpenAI conversion utilities
export { anthropicMessagesToOpenAI } from "./shared/openaiConvertMessages.ts"
export type { ConvertMessagesOptions } from "./shared/openaiConvertMessages.ts"
export {
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
} from "./shared/openaiConvertTools.ts"
export { adaptOpenAIStreamToAnthropic } from "./shared/openaiStreamAdapter.ts"
