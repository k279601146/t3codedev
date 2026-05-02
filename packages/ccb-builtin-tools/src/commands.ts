// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import addDir from "./commands/add-dir/index.ts"
import autofixPr from "./commands/autofix-pr/index.ts"
import backfillSessions from "./commands/backfill-sessions/index.ts"
import btw from "./commands/btw/index.ts"
import goodClaude from "./commands/good-claude/index.ts"
import issue from "./commands/issue/index.ts"
import feedback from "./commands/feedback/index.ts"
import clear from "./commands/clear/index.ts"
import color from "./commands/color/index.ts"
import commit from "./commands/commit.ts"
import copy from "./commands/copy/index.ts"
import desktop from "./commands/desktop/index.ts"
import commitPushPr from "./commands/commit-push-pr.ts"
import compact from "./commands/compact/index.ts"
import config from "./commands/config/index.ts"
import { context, contextNonInteractive } from "./commands/context/index.ts"
import cost from "./commands/cost/index.ts"
import diff from "./commands/diff/index.ts"
import ctx_viz from "./commands/ctx_viz/index.ts"
import doctor from "./commands/doctor/index.ts"
import memory from "./commands/memory/index.ts"
import help from "./commands/help/index.ts"
import ide from "./commands/ide/index.ts"
import init from "./commands/init.ts"
import initVerifiers from "./commands/init-verifiers.ts"
import keybindings from "./commands/keybindings/index.ts"
import lang from "./commands/lang/index.ts"
import login from "./commands/login/index.ts"
import logout from "./commands/logout/index.ts"
import installGitHubApp from "./commands/install-github-app/index.ts"
import installSlackApp from "./commands/install-slack-app/index.ts"
import breakCache from "./commands/break-cache/index.ts"
import mcp from "./commands/mcp/index.ts"
import mobile from "./commands/mobile/index.ts"
import onboarding from "./commands/onboarding/index.ts"
import pr_comments from "./commands/pr_comments/index.ts"
import releaseNotes from "./commands/release-notes/index.ts"
import rename from "./commands/rename/index.ts"
import resume from "./commands/resume/index.ts"
import review, { ultrareview } from "./commands/review.ts"
import session from "./commands/session/index.ts"
import share from "./commands/share/index.ts"
import skills from "./commands/skills/index.ts"
import status from "./commands/status/index.ts"
import tasks from "./commands/tasks/index.ts"
import teleport from "./commands/teleport/index.ts"
/* eslint-disable @typescript-eslint/no-require-imports */
const agentsPlatform =
  process.env.USER_TYPE === 'ant'
    ? require('./commands/agents-platform/index.ts').default
    : null
/* eslint-enable @typescript-eslint/no-require-imports */
import securityReview from "./commands/security-review.ts"
import bughunter from "./commands/bughunter/index.ts"
import terminalSetup from "./commands/terminalSetup/index.ts"
import usage from "./commands/usage/index.ts"
import theme from "./commands/theme/index.ts"
import vim from "./commands/vim/index.ts"
import {  feature  } from "./featureFlags.ts";
// Dead code elimination: conditional imports
/* eslint-disable @typescript-eslint/no-require-imports */
const proactive =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('./commands/proactive.ts').default
    : null
const briefCommand =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? require('./commands/brief.ts').default
    : null
const assistantCommand = feature('KAIROS')
  ? require('./commands/assistant/index.ts').default
  : null
const bridge = feature('BRIDGE_MODE')
  ? require('./commands/bridge/index.ts').default
  : null
const remoteControlServerCommand = feature('BRIDGE_MODE')
  ? require('./commands/remoteControlServer/index.ts').default
  : null
const voiceCommand = feature('VOICE_MODE')
  ? require('./commands/voice/index.ts').default
  : null
const monitorCmd = feature('MONITOR_TOOL')
  ? require('./commands/monitor.ts').default
  : null
const coordinatorCmd = feature('COORDINATOR_MODE')
  ? require('./commands/coordinator.ts').default
  : null
const forceSnip = feature('HISTORY_SNIP')
  ? require('./commands/force-snip.ts').default
  : null
const workflowsCmd = feature('WORKFLOW_SCRIPTS')
  ? (
      require('./commands/workflows/index.ts') as typeof import('./commands/workflows/index.ts')
    ).default
  : null
const webCmd = feature('CCR_REMOTE_SETUP')
  ? (
      require('./commands/remote-setup/index.ts') as typeof import('./commands/remote-setup/index.ts')
    ).default
  : null
const clearSkillIndexCache = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (
      require('./services/skillSearch/localSearch.ts') as typeof import('./services/skillSearch/localSearch.ts')
    ).clearSkillIndexCache
  : null
const subscribePr = feature('KAIROS_GITHUB_WEBHOOKS')
  ? require('./commands/subscribe-pr.ts').default
  : null
const ultraplan = feature('ULTRAPLAN')
  ? require('./commands/ultraplan.tsx').default
  : null
const torch = feature('TORCH') ? require('./commands/torch.ts').default : null
const daemonCmd =
  feature('DAEMON') || feature('BG_SESSIONS')
    ? require('./commands/daemon/index.ts').default
    : null
const jobCmd = feature('TEMPLATES')
  ? require('./commands/job/index.ts').default
  : null
const peersCmd = feature('UDS_INBOX')
  ? (
      require('./commands/peers/index.ts') as typeof import('./commands/peers/index.ts')
    ).default
  : null
const attachCmd = feature('UDS_INBOX')
  ? require('./commands/attach/index.ts').default
  : null
const detachCmd = feature('UDS_INBOX')
  ? require('./commands/detach/index.ts').default
  : null
const sendCmd = feature('UDS_INBOX')
  ? require('./commands/send/index.ts').default
  : null
const pipesCmd = feature('UDS_INBOX')
  ? require('./commands/pipes/index.ts').default
  : null
const pipeStatusCmd = feature('UDS_INBOX')
  ? require('./commands/pipe-status/index.ts').default
  : null
const historyCmd = feature('UDS_INBOX')
  ? require('./commands/history/index.ts').default
  : null
const claimMainCmd = feature('UDS_INBOX')
  ? require('./commands/claim-main/index.ts').default
  : null
const forkCmd = feature('FORK_SUBAGENT')
  ? (
      require('./commands/fork/index.ts') as typeof import('./commands/fork/index.ts')
    ).default
  : null
const buddy = feature('BUDDY')
  ? (
      require('./commands/buddy/index.ts') as typeof import('./commands/buddy/index.ts')
    ).default
  : null
const poor = feature('POOR')
  ? (
      require('./commands/poor/index.ts') as typeof import('./commands/poor/index.ts')
    ).default
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
import thinkback from "./commands/thinkback/index.ts"
import thinkbackPlay from "./commands/thinkback-play/index.ts"
import permissions from "./commands/permissions/index.ts"
import plan from "./commands/plan/index.ts"
import fast from "./commands/fast/index.ts"
import passes from "./commands/passes/index.ts"
import privacySettings from "./commands/privacy-settings/index.ts"
import hooks from "./commands/hooks/index.ts"
import files from "./commands/files/index.ts"
import branch from "./commands/branch/index.ts"
import agents from "./commands/agents/index.ts"
import plugin from "./commands/plugin/index.tsx"
import reloadPlugins from "./commands/reload-plugins/index.ts"
import rewind from "./commands/rewind/index.ts"
import heapDump from "./commands/heapdump/index.ts"
import mockLimits from "./commands/mock-limits/index.ts"
import bridgeKick from "./commands/bridge-kick.ts"
import version from "./commands/version.ts"
import summary from "./commands/summary/index.ts"
import skillLearning from "./commands/skill-learning/index.ts"
import skillSearch from "./commands/skill-search/index.ts"
import {
  resetLimits,
  resetLimitsNonInteractive,
} from "./commands/reset-limits/index.ts"
import antTrace from "./commands/ant-trace/index.ts"
import perfIssue from "./commands/perf-issue/index.ts"
import sandboxToggle from "./commands/sandbox-toggle/index.ts"
import chrome from "./commands/chrome/index.ts"
import stickers from "./commands/stickers/index.ts"
import advisor from "./commands/advisor.ts"
import autonomy from "./commands/autonomy.ts"
import provider from "./commands/provider.ts"
import { logError } from "./utils/log.ts"
import { toError } from "./utils/errors.ts"
import { logForDebugging } from "./utils/debug.ts"
import {
  getSkillDirCommands,
  clearSkillCaches,
  getDynamicSkills,
} from "./skills/loadSkillsDir.ts"
import { getBundledSkills } from "./skills/bundledSkills.ts"
import { getBuiltinPluginSkillCommands } from "./plugins/builtinPlugins.ts"
import {
  getPluginCommands,
  clearPluginCommandCache,
  getPluginSkills,
  clearPluginSkillsCache,
} from "./utils/plugins/loadPluginCommands.ts"
import memoize from "lodash-es/memoize.js"
import { isUsing3PServices, isClaudeAISubscriber } from "./utils/auth.ts"
import { isFirstPartyAnthropicBaseUrl } from "./utils/model/providers.ts"
import env from "./commands/env/index.ts"
import exit from "./commands/exit/index.ts"
import exportCommand from "./commands/export/index.ts"
import model from "./commands/model/index.ts"
import tag from "./commands/tag/index.ts"
import outputStyle from "./commands/output-style/index.ts"
import remoteEnv from "./commands/remote-env/index.ts"
import upgrade from "./commands/upgrade/index.ts"
import {
  extraUsage,
  extraUsageNonInteractive,
} from "./commands/extra-usage/index.ts"
import rateLimitOptions from "./commands/rate-limit-options/index.ts"
import statusline from "./commands/statusline.tsx"
import effort from "./commands/effort/index.ts"
import stats from "./commands/stats/index.ts"
// insights.ts is 113KB (3200 lines, includes diffLines/html rendering). Lazy
// shim defers the heavy module until /insights is actually invoked.
const usageReport: Command = {
  type: 'prompt',
  name: 'insights',
  description: 'Generate a report analyzing your Claude Code sessions',
  contentLength: 0,
  progressMessage: 'analyzing your sessions',
  source: 'builtin',
  async getPromptForCommand(args, context) {
    const real = (await import('./commands/insights.ts')).default
    if (real.type !== 'prompt') throw new Error('unreachable')
    return real.getPromptForCommand(args, context)
  },
}
import oauthRefresh from "./commands/oauth-refresh/index.ts"
import debugToolCall from "./commands/debug-tool-call/index.ts"
import { getSettingSourceName } from "./utils/settings/constants.ts"
import {
  type Command,
  getCommandName,
  isCommandEnabled,
} from "./types/command.ts"

// Re-export types from the centralized location
export type {
  Command,
  CommandBase,
  CommandResultDisplay,
  LocalCommandResult,
  LocalJSXCommandContext,
  PromptCommand,
  ResumeEntrypoint,
} from "./types/command.ts"
export { getCommandName, isCommandEnabled } from "./types/command.ts"

// Commands that get eliminated from the external build
export const INTERNAL_ONLY_COMMANDS = [
  backfillSessions,
  breakCache,
  bughunter,
  commit,
  commitPushPr,
  ctx_viz,
  goodClaude,
  issue,
  initVerifiers,
  mockLimits,
  bridgeKick,
  version,
  ...(subscribePr ? [subscribePr] : []),
  resetLimits,
  resetLimitsNonInteractive,
  onboarding,
  share,
  teleport,
  antTrace,
  perfIssue,
  env,
  oauthRefresh,
  debugToolCall,
  agentsPlatform,
  autofixPr,
].filter(Boolean)

// Declared as a function so that we don't run this until getCommands is called,
// since underlying functions read from config, which can't be read at module initialization time
const COMMANDS = memoize((): Command[] => [
  addDir,
  advisor,
  autonomy,
  provider,
  agents,
  branch,
  btw,
  chrome,
  clear,
  color,
  compact,
  config,
  copy,
  desktop,
  context,
  contextNonInteractive,
  cost,
  diff,
  doctor,
  effort,
  exit,
  fast,
  files,
  heapDump,
  help,
  ide,
  init,
  keybindings,
  lang,
  installGitHubApp,
  installSlackApp,
  mcp,
  memory,
  mobile,
  model,
  outputStyle,
  remoteEnv,
  plugin,
  pr_comments,
  releaseNotes,
  reloadPlugins,
  rename,
  resume,
  session,
  skills,
  stats,
  status,
  statusline,
  stickers,
  tag,
  theme,
  feedback,
  review,
  ultrareview,
  rewind,
  securityReview,
  terminalSetup,
  upgrade,
  extraUsage,
  extraUsageNonInteractive,
  rateLimitOptions,
  usage,
  usageReport,
  vim,
  ...(webCmd ? [webCmd] : []),
  ...(forkCmd ? [forkCmd] : []),
  ...(buddy ? [buddy] : []),
  ...(poor ? [poor] : []),
  ...(proactive ? [proactive] : []),
  ...(monitorCmd ? [monitorCmd] : []),
  ...(coordinatorCmd ? [coordinatorCmd] : []),
  ...(briefCommand ? [briefCommand] : []),
  ...(assistantCommand ? [assistantCommand] : []),
  ...(bridge ? [bridge] : []),
  ...(remoteControlServerCommand ? [remoteControlServerCommand] : []),
  ...(voiceCommand ? [voiceCommand] : []),
  thinkback,
  thinkbackPlay,
  permissions,
  plan,
  privacySettings,
  hooks,
  exportCommand,
  sandboxToggle,
  ...(!isUsing3PServices() ? [logout, login()] : []),
  passes,
  ...(peersCmd ? [peersCmd] : []),
  ...(attachCmd ? [attachCmd] : []),
  ...(detachCmd ? [detachCmd] : []),
  ...(sendCmd ? [sendCmd] : []),
  ...(pipesCmd ? [pipesCmd] : []),
  ...(pipeStatusCmd ? [pipeStatusCmd] : []),
  ...(historyCmd ? [historyCmd] : []),
  ...(claimMainCmd ? [claimMainCmd] : []),
  tasks,
  ...(workflowsCmd ? [workflowsCmd] : []),
  ...(ultraplan ? [ultraplan] : []),
  ...(torch ? [torch] : []),
  ...(daemonCmd ? [daemonCmd] : []),
  ...(jobCmd ? [jobCmd] : []),
  ...(forceSnip ? [forceSnip] : []),
  summary,
  skillLearning,
  skillSearch,
  ...(process.env.USER_TYPE === 'ant' && !process.env.IS_DEMO
    ? INTERNAL_ONLY_COMMANDS
    : []),
])

export const builtInCommandNames = memoize(
  (): Set<string> =>
    new Set(COMMANDS().flatMap(_ => [_.name, ...(_.aliases ?? [])])),
)

async function getSkills(cwd: string): Promise<{
  skillDirCommands: Command[]
  pluginSkills: Command[]
  bundledSkills: Command[]
  builtinPluginSkills: Command[]
}> {
  try {
    const [skillDirCommands, pluginSkills] = await Promise.all([
      getSkillDirCommands(cwd).catch(err => {
        logError(toError(err))
        logForDebugging(
          'Skill directory commands failed to load, continuing without them',
        )
        return []
      }),
      getPluginSkills().catch(err => {
        logError(toError(err))
        logForDebugging('Plugin skills failed to load, continuing without them')
        return []
      }),
    ])
    // Bundled skills are registered synchronously at startup
    const bundledSkills = getBundledSkills()
    // Built-in plugin skills come from enabled built-in plugins
    const builtinPluginSkills = getBuiltinPluginSkillCommands()
    logForDebugging(
      `getSkills returning: ${skillDirCommands.length} skill dir commands, ${pluginSkills.length} plugin skills, ${bundledSkills.length} bundled skills, ${builtinPluginSkills.length} builtin plugin skills`,
    )
    return {
      skillDirCommands,
      pluginSkills,
      bundledSkills,
      builtinPluginSkills,
    }
  } catch (err) {
    // This should never happen since we catch at the Promise level, but defensive
    logError(toError(err))
    logForDebugging('Unexpected error in getSkills, returning empty')
    return {
      skillDirCommands: [],
      pluginSkills: [],
      bundledSkills: [],
      builtinPluginSkills: [],
    }
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
const getWorkflowCommands = feature('WORKFLOW_SCRIPTS')
  ? (
      require('@claude-code-best/builtin-tools/tools/WorkflowTool/createWorkflowCommand.ts') as typeof import('@claude-code-best/builtin-tools/tools/WorkflowTool/createWorkflowCommand.ts')
    ).getWorkflowCommands
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Filters commands by their declared `availability` (auth/provider requirement).
 * Commands without `availability` are treated as universal.
 * This runs before `isEnabled()` so that provider-gated commands are hidden
 * regardless of feature-flag state.
 *
 * Not memoized ï¿?auth state can change mid-session (e.g. after /login),
 * so this must be re-evaluated on every getCommands() call.
 */
export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability || cmd.availability.length === 0) return true
  for (const a of cmd.availability) {
    switch (a) {
      case 'claude-ai':
        if (isClaudeAISubscriber()) return true
        break
      case 'console':
        // Console API key user = direct 1P API customer (not 3P, not claude.ai).
        // Excludes 3P (Bedrock/Vertex/Foundry) who don't set ANTHROPIC_BASE_URL
        // and gateway users who proxy through a custom base URL.
        if (
          !isClaudeAISubscriber() &&
          !isUsing3PServices() &&
          isFirstPartyAnthropicBaseUrl()
        )
          return true
        break
      default: {
        const _exhaustive: never = a
        void _exhaustive
        break
      }
    }
  }
  return false
}

/**
 * Loads all command sources (skills, plugins, workflows). Memoized by cwd
 * because loading is expensive (disk I/O, dynamic imports).
 */
const loadAllCommands = memoize(async (cwd: string): Promise<Command[]> => {
  const [
    { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
    pluginCommands,
    workflowCommands,
  ] = await Promise.all([
    getSkills(cwd),
    getPluginCommands(),
    getWorkflowCommands ? getWorkflowCommands(cwd) : Promise.resolve([]),
  ])

  return [
    ...bundledSkills,
    ...builtinPluginSkills,
    ...skillDirCommands,
    ...(workflowCommands as Command[]),
    ...(pluginCommands as Command[]),
    ...pluginSkills,
    ...COMMANDS(),
  ]
})

/**
 * Returns commands available to the current user. The expensive loading is
 * memoized, but availability and isEnabled checks run fresh every call so
 * auth changes (e.g. /login) take effect immediately.
 */
export async function getCommands(cwd: string): Promise<Command[]> {
  const allCommands = await loadAllCommands(cwd)

  // Get dynamic skills discovered during file operations
  const dynamicSkills = getDynamicSkills()

  // Build base commands without dynamic skills
  const baseCommands = allCommands.filter(
    _ => meetsAvailabilityRequirement(_) && isCommandEnabled(_),
  )

  if (dynamicSkills.length === 0) {
    return baseCommands
  }

  // Dedupe dynamic skills - only add if not already present
  const baseCommandNames = new Set(baseCommands.map(c => c.name))
  const uniqueDynamicSkills = dynamicSkills.filter(
    s =>
      !baseCommandNames.has(s.name) &&
      meetsAvailabilityRequirement(s) &&
      isCommandEnabled(s),
  )

  if (uniqueDynamicSkills.length === 0) {
    return baseCommands
  }

  // Insert dynamic skills after plugin skills but before built-in commands
  const builtInNames = new Set(COMMANDS().map(c => c.name))
  const insertIndex = baseCommands.findIndex(c => builtInNames.has(c.name))

  if (insertIndex === -1) {
    return [...baseCommands, ...uniqueDynamicSkills]
  }

  return [
    ...baseCommands.slice(0, insertIndex),
    ...uniqueDynamicSkills,
    ...baseCommands.slice(insertIndex),
  ]
}

/**
 * Clears only the memoization caches for commands, WITHOUT clearing skill caches.
 * Use this when dynamic skills are added to invalidate cached command lists.
 */
export function clearCommandMemoizationCaches(): void {
  loadAllCommands.cache?.clear?.()
  getSkillToolCommands.cache?.clear?.()
  getSlashCommandToolSkills.cache?.clear?.()
  // getSkillIndex in skillSearch/localSearch.ts is a separate memoization layer
  // built ON TOP of getSkillToolCommands/getCommands. Clearing only the inner
  // caches is a no-op for the outer ï¿?lodash memoize returns the cached result
  // without ever reaching the cleared inners. Must clear it explicitly.
  clearSkillIndexCache?.()
}

export function clearCommandsCache(): void {
  clearCommandMemoizationCaches()
  clearPluginCommandCache()
  clearPluginSkillsCache()
  clearSkillCaches()
}

/**
 * Filter AppState.mcp.commands to MCP-provided skills (prompt-type,
 * model-invocable, loaded from MCP). These live outside getCommands() so
 * callers that need MCP skills in their skill index thread them through
 * separately.
 */
export function getMcpSkillCommands(
  mcpCommands: readonly Command[],
): readonly Command[] {
  if (feature('MCP_SKILLS')) {
    return mcpCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        cmd.loadedFrom === 'mcp' &&
        !cmd.disableModelInvocation,
    )
  }
  return []
}

// SkillTool shows ALL prompt-based commands that the model can invoke
// This includes both skills (from /skills/) and commands (from /commands/)
export const getSkillToolCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const allCommands = await getCommands(cwd)
    return allCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        !cmd.disableModelInvocation &&
        cmd.source !== 'builtin' &&
        // Always include skills from /skills/ dirs, bundled skills, and legacy /commands/ entries
        // (they all get an auto-derived description from the first line if frontmatter is missing).
        // Plugin/MCP commands still require an explicit description to appear in the listing.
        (cmd.loadedFrom === 'bundled' ||
          cmd.loadedFrom === 'skills' ||
          cmd.loadedFrom === 'commands_DEPRECATED' ||
          cmd.hasUserSpecifiedDescription ||
          cmd.whenToUse),
    )
  },
)

// Filters commands to include only skills. Skills are commands that provide
// specialized capabilities for the model to use. They are identified by
// loadedFrom being 'skills', 'plugin', or 'bundled', or having disableModelInvocation set.
export const getSlashCommandToolSkills = memoize(
  async (cwd: string): Promise<Command[]> => {
    try {
      const allCommands = await getCommands(cwd)
      return allCommands.filter(
        cmd =>
          cmd.type === 'prompt' &&
          cmd.source !== 'builtin' &&
          (cmd.hasUserSpecifiedDescription || cmd.whenToUse) &&
          (cmd.loadedFrom === 'skills' ||
            cmd.loadedFrom === 'plugin' ||
            cmd.loadedFrom === 'bundled' ||
            cmd.disableModelInvocation),
      )
    } catch (error) {
      logError(toError(error))
      // Return empty array rather than throwing - skills are non-critical
      // This prevents skill loading failures from breaking the entire system
      logForDebugging('Returning empty skills array due to load failure')
      return []
    }
  },
)

/**
 * Commands that are safe to use in remote mode (--remote).
 * These only affect local TUI state and don't depend on local filesystem,
 * git, shell, IDE, MCP, or other local execution context.
 *
 * Used in two places:
 * 1. Pre-filtering commands in main.tsx before REPL renders (prevents race with CCR init)
 * 2. Preserving local-only commands in REPL's handleRemoteInit after CCR filters
 */
export const REMOTE_SAFE_COMMANDS: Set<Command> = new Set([
  session, // Shows QR code / URL for remote session
  exit, // Exit the TUI
  clear, // Clear screen
  help, // Show help
  theme, // Change terminal theme
  color, // Change agent color
  vim, // Toggle vim mode
  cost, // Show session cost (local cost tracking)
  usage, // Show usage info
  copy, // Copy last message
  btw, // Quick note
  feedback, // Send feedback
  plan, // Plan mode toggle
  proactive, // Toggle proactive mode
  keybindings, // Keybinding management
  statusline, // Status line toggle
  stickers, // Stickers
  mobile, // Mobile QR code
])

/**
 * Builtin commands of type 'local' that ARE safe to execute when received
 * over the Remote Control bridge. These produce text output that streams
 * back to the mobile/web client and have no terminal-only side effects.
 *
 * 'local-jsx' commands are blocked by type (they render Ink UI) and
 * 'prompt' commands are allowed by type (they expand to text sent to the
 * model) ï¿?this set only gates 'local' commands.
 *
 * When adding a new 'local' command that should work from mobile, add it
 * here. Default is blocked.
 */
export const BRIDGE_SAFE_COMMANDS: Set<Command> = new Set(
  [
    compact, // Shrink context ï¿?useful mid-session from a phone
    clear, // Wipe transcript
    cost, // Show session cost
    summary, // Summarize conversation
    releaseNotes, // Show changelog
    files, // List tracked files
  ].filter((c): c is Command => c !== null),
)

/**
 * Whether a slash command is safe to execute when its input arrived over the
 * Remote Control bridge (mobile/web client).
 *
 * PR #19134 blanket-blocked all slash commands from bridge inbound because
 * `/model` from iOS was popping the local Ink picker. This predicate relaxes
 * that with an explicit allowlist: 'prompt' commands (skills) expand to text
 * and are safe by construction; 'local' commands need an explicit opt-in via
 * BRIDGE_SAFE_COMMANDS; 'local-jsx' commands render Ink UI and stay blocked.
 */
export function isBridgeSafeCommand(cmd: Command): boolean {
  if (cmd.type === 'local-jsx') return cmd.bridgeSafe === true
  if (cmd.type === 'prompt') return true
  return cmd.bridgeSafe === true || BRIDGE_SAFE_COMMANDS.has(cmd)
}

export function getBridgeCommandSafety(
  cmd: Command,
  args: string,
): { ok: true } | { ok: false; reason?: string } {
  if (!isBridgeSafeCommand(cmd)) return { ok: false }
  const reason = cmd.getBridgeInvocationError?.(args)
  return reason ? { ok: false, reason } : { ok: true }
}

/**
 * Filter commands to only include those safe for remote mode.
 * Used to pre-filter commands when rendering the REPL in --remote mode,
 * preventing local-only commands from being briefly available before
 * the CCR init message arrives.
 */
export function filterCommandsForRemoteMode(commands: Command[]): Command[] {
  return commands.filter(cmd => REMOTE_SAFE_COMMANDS.has(cmd))
}

export function findCommand(
  commandName: string,
  commands: Command[],
): Command | undefined {
  return commands.find(
    _ =>
      _.name === commandName ||
      getCommandName(_) === commandName ||
      _.aliases?.includes(commandName),
  )
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return findCommand(commandName, commands) !== undefined
}

export function getCommand(commandName: string, commands: Command[]): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = getCommandName(_)
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .sort((a, b) => a.localeCompare(b))
        .join(', ')}`,
    )
  }

  return command
}

/**
 * Formats a command's description with its source annotation for user-facing UI.
 * Use this in typeahead, help screens, and other places where users need to see
 * where a command comes from.
 *
 * For model-facing prompts (like SkillTool), use cmd.description directly.
 */
export function formatDescriptionWithSource(cmd: Command): string {
  if (cmd.type !== 'prompt') {
    return cmd.description
  }

  if (cmd.kind === 'workflow') {
    return `${cmd.description} (workflow)`
  }

  if (cmd.source === 'plugin') {
    const pluginName = cmd.pluginInfo?.pluginManifest.name
    if (pluginName) {
      return `(${pluginName}) ${cmd.description}`
    }
    return `${cmd.description} (plugin)`
  }

  if (cmd.source === 'builtin' || cmd.source === 'mcp') {
    return cmd.description
  }

  if (cmd.source === 'bundled') {
    return `${cmd.description} (bundled)`
  }

  return `${cmd.description} (${getSettingSourceName(cmd.source)})`
}

