/**
 * Session cache clearing utilities.
 * This module is imported at startup by main.tsx, so keep imports minimal.
 */
import {  feature  } from "../../featureFlags.ts";
import {
  clearInvokedSkills,
  setLastEmittedDate,
} from "@t3tools/ccb-engine/src/bootstrap/state.ts"
import { clearCommandsCache } from "../../commands.ts"
import { getSessionStartDate } from "@t3tools/ccb-engine/src/constants/common.ts"
import {
  getGitStatus,
  getSystemContext,
  getUserContext,
  setSystemPromptInjection,
} from "../../context.ts"
import { clearFileSuggestionCaches } from "../../hooks/fileSuggestions.ts"
import { clearAllPendingCallbacks } from "../../hooks/useSwarmPermissionPoller.ts"
import { clearAllDumpState } from "@t3tools/ccb-engine/src/services/api/dumpPrompts.ts"
import { resetPromptCacheBreakDetection } from "@t3tools/ccb-engine/src/services/api/promptCacheBreakDetection.ts"
import { clearAllSessions } from "@t3tools/ccb-engine/src/services/api/sessionIngress.ts"
import { runPostCompactCleanup } from "@t3tools/ccb-engine/src/services/compact/postCompactCleanup.ts"
import { resetAllLSPDiagnosticState } from "@t3tools/ccb-engine/src/services/lsp/LSPDiagnosticRegistry.ts"
import { clearTrackedMagicDocs } from "@t3tools/ccb-engine/src/services/MagicDocs/magicDocs.ts"
import { clearDynamicSkills } from "../../skills/loadSkillsDir.ts"
import { resetSentSkillNames } from "@t3tools/ccb-engine/src/utils/attachments.ts"
import { clearCommandPrefixCaches } from "@t3tools/ccb-engine/src/utils/bash/commands.ts"
import { resetGetMemoryFilesCache } from "@t3tools/ccb-engine/src/utils/claudemd.ts"
import { clearRepositoryCaches } from "@t3tools/ccb-engine/src/utils/detectRepository.ts"
import { clearResolveGitDirCache } from "@t3tools/ccb-engine/src/utils/git/gitFilesystem.ts"
import { clearStoredImagePaths } from "@t3tools/ccb-engine/src/utils/imageStore.ts"
import { clearSessionEnvVars } from "@t3tools/ccb-engine/src/utils/sessionEnvVars.ts"

/**
 * Clear all session-related caches.
 * Call this when resuming a session to ensure fresh file/skill discovery.
 * This is a subset of what clearConversation does - it only clears caches
 * without affecting messages, session ID, or triggering hooks.
 *
 * @param preservedAgentIds - Agent IDs whose per-agent state should survive
 *   the clear (e.g., background tasks preserved across /clear). When non-empty,
 *   agentId-keyed state (invoked skills) is selectively cleared and requestId-keyed
 *   state (pending permission callbacks, dump state, cache-break tracking) is left
 *   intact since it cannot be safely scoped to the main session.
 */
export function clearSessionCaches(
  preservedAgentIds: ReadonlySet<string> = new Set(),
): void {
  const hasPreserved = preservedAgentIds.size > 0
  // Clear context caches
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  getGitStatus.cache.clear?.()
  getSessionStartDate.cache.clear?.()
  // Clear file suggestion caches (for @ mentions)
  clearFileSuggestionCaches()

  // Clear commands/skills cache
  clearCommandsCache()

  // Clear prompt cache break detection state
  if (!hasPreserved) resetPromptCacheBreakDetection()

  // Clear system prompt injection (cache breaker)
  setSystemPromptInjection(null)

  // Clear last emitted date so it's re-detected on next turn
  setLastEmittedDate(null)

  // Run post-compaction cleanup (clears system prompt sections, microcompact tracking,
  // classifier approvals, speculative checks, and ï¿?for main-thread compacts ï¿?memory
  // files cache with load_reason 'compact').
  runPostCompactCleanup()
  // Reset sent skill names so the skill listing is re-sent after /clear.
  // runPostCompactCleanup intentionally does NOT reset this (post-compact
  // re-injection costs ~4K tokens), but /clear wipes messages entirely so
  // the model needs the full listing again.
  resetSentSkillNames()
  // Override the memory cache reset with 'session_start': clearSessionCaches is called
  // from /clear and --resume/--continue, which are NOT compaction events. Without this,
  // the InstructionsLoaded hook would fire with load_reason 'compact' instead of
  // 'session_start' on the next getMemoryFiles() call.
  resetGetMemoryFilesCache('session_start')

  // Clear stored image paths cache
  clearStoredImagePaths()

  // Clear all session ingress caches (lastUuidMap, sequentialAppendBySession)
  clearAllSessions()
  // Clear swarm permission pending callbacks
  if (!hasPreserved) clearAllPendingCallbacks()

  // Clear tungsten session usage tracking
  if (process.env.USER_TYPE === 'ant') {
    void import(
      '@claude-code-best/builtin-tools/tools/TungstenTool/TungstenTool.ts'
    ).then(({ clearSessionsWithTungstenUsage, resetInitializationState }) => {
      clearSessionsWithTungstenUsage()
      resetInitializationState()
    })
  }
  // Clear attribution caches (file content cache, pending bash states)
  // Dynamic import to preserve dead code elimination for COMMIT_ATTRIBUTION feature flag
  if (feature('COMMIT_ATTRIBUTION')) {
    void import('../../utils/attributionHooks.ts').then(
      ({ clearAttributionCaches }) => clearAttributionCaches(),
    )
  }
  // Clear repository detection caches
  clearRepositoryCaches()
  // Clear bash command prefix caches (Haiku-extracted prefixes)
  clearCommandPrefixCaches()
  // Clear dump prompts state
  if (!hasPreserved) clearAllDumpState()
  // Clear invoked skills cache (each entry holds full skill file content)
  clearInvokedSkills(preservedAgentIds)
  // Clear git dir resolution cache
  clearResolveGitDirCache()
  // Clear dynamic skills (loaded from skill directories)
  clearDynamicSkills()
  // Clear LSP diagnostic tracking state
  resetAllLSPDiagnosticState()
  // Clear tracked magic docs
  clearTrackedMagicDocs()
  // Clear session environment variables
  clearSessionEnvVars()
  // Clear WebFetch URL cache (up to 50MB of cached page content)
  void import(
    '@claude-code-best/builtin-tools/tools/WebFetchTool/utils.ts'
  ).then(({ clearWebFetchCache }) => clearWebFetchCache())
  // Clear ToolSearch description cache (full tool prompts, ~500KB for 50 MCP tools)
  void import(
    '@claude-code-best/builtin-tools/tools/ToolSearchTool/ToolSearchTool.ts'
  ).then(({ clearToolSearchDescriptionCache }) =>
    clearToolSearchDescriptionCache(),
  )
  // Clear agent definitions cache (accumulates per-cwd via EnterWorktreeTool)
  void import(
    '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.ts'
  ).then(({ clearAgentDefinitionsCache }) => clearAgentDefinitionsCache())
  // Clear SkillTool prompt cache (accumulates per project root)
  void import('@claude-code-best/builtin-tools/tools/SkillTool/prompt.ts').then(
    ({ clearPromptCache }) => clearPromptCache(),
  )
}

