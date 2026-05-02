// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from "../featureFlags.ts";
import { SHELL_TOOL_NAMES } from "../utils/shell/shellToolUtils.ts";

// Tool names defined directly to break cyclic dependency with @claude-code-best/builtin-tools
export const TASK_OUTPUT_TOOL_NAME = 'TaskOutput';
export const EXIT_PLAN_MODE_V2_TOOL_NAME = 'ExitPlanMode';
export const ENTER_PLAN_MODE_TOOL_NAME = 'EnterPlanMode';
export const AGENT_TOOL_NAME = 'Agent';
export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion';
export const TASK_STOP_TOOL_NAME = 'TaskStop';
export const FILE_READ_TOOL_NAME = 'View';
export const WEB_SEARCH_TOOL_NAME = 'WebSearch';
export const TODO_WRITE_TOOL_NAME = 'TodoWrite';
export const GREP_TOOL_NAME = 'Grep';
export const WEB_FETCH_TOOL_NAME = 'WebFetch';
export const GLOB_TOOL_NAME = 'Glob';
export const FILE_EDIT_TOOL_NAME = 'Edit';
export const FILE_WRITE_TOOL_NAME = 'Write';
export const NOTEBOOK_EDIT_TOOL_NAME = 'NotebookEdit';
export const SKILL_TOOL_NAME = 'Skill';
export const SEND_MESSAGE_TOOL_NAME = 'SendMessage';
export const TASK_CREATE_TOOL_NAME = 'TaskCreate';
export const TASK_GET_TOOL_NAME = 'TaskGet';
export const TASK_LIST_TOOL_NAME = 'TaskList';
export const TASK_UPDATE_TOOL_NAME = 'TaskUpdate';
export const TOOL_SEARCH_TOOL_NAME = 'ToolSearch';
export const SYNTHETIC_OUTPUT_TOOL_NAME = 'SyntheticOutput';
export const ENTER_WORKTREE_TOOL_NAME = 'EnterWorktree';
export const EXIT_WORKTREE_TOOL_NAME = 'ExitWorktree';
export const WORKFLOW_TOOL_NAME = 'Workflow';
export const CRON_CREATE_TOOL_NAME = 'CronCreate';
export const CRON_DELETE_TOOL_NAME = 'CronDelete';
export const CRON_LIST_TOOL_NAME = 'CronList';

export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME,
  EXIT_PLAN_MODE_V2_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  // Allow Agent tool for agents when user is ant (enables nested agents)
  ...(process.env.USER_TYPE === 'ant' ? [] : [AGENT_TOOL_NAME]),
  ASK_USER_QUESTION_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  // Prevent recursive workflow execution inside subagents.
  ...(feature('WORKFLOW_SCRIPTS') ? [WORKFLOW_TOOL_NAME] : []),
])

export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
])

/*
 * Async Agent Tool Availability Status (Source of Truth)
 */
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  GREP_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  GLOB_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
  SKILL_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_NAME,
])
/**
 * Tools allowed only for in-process teammates (not general async agents).
 * These are injected by inProcessRunner.ts and allowed through filterToolsForAgent
 * via isInProcessTeammate() check.
 */
export const IN_PROCESS_TEAMMATE_ALLOWED_TOOLS = new Set([
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  // Teammate-created crons are tagged with the creating agentId and routed to
  // that teammate's pendingUserMessages queue (see useScheduledTasks.ts).
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  CRON_LIST_TOOL_NAME,
])

/*
 * BLOCKED FOR ASYNC AGENTS:
 * - AgentTool: Blocked to prevent recursion
 * - TaskOutputTool: Blocked to prevent recursion
 * - ExitPlanModeTool: Plan mode is a main thread abstraction.
 * - TaskStopTool: Requires access to main thread task state.
 * - TungstenTool: Uses singleton virtual terminal abstraction that conflicts between agents.
 *
 * ENABLE LATER (NEED WORK):
 * - MCPTool: TBD
 * - ListMcpResourcesTool: TBD
 * - ReadMcpResourceTool: TBD
 */

/**
 * Tools allowed in coordinator mode - only output and agent management tools for the coordinator
 */
export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  AGENT_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
])

