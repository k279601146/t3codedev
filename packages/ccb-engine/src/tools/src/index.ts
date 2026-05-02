// @ts-nocheck
// builtin-tools — All tool implementations for Claude Code
// This barrel file re-exports the main tool constants and utilities.
// For specific submodules, use deep imports: 'builtin-tools/tools/XTool/XTool.js'

// =============================================================================
// Main tool exports (used by src/tools.ts)
// =============================================================================

// Core tools
export { AgentTool } from "./tools/AgentTool/AgentTool.ts"
export { AskUserQuestionTool } from "./tools/AskUserQuestionTool/AskUserQuestionTool.ts"
export { BashTool } from "./tools/BashTool/BashTool.ts"
export { BriefTool } from "./tools/BriefTool/BriefTool.ts"
export { ConfigTool } from "./tools/ConfigTool/ConfigTool.ts"
export { EnterPlanModeTool } from "./tools/EnterPlanModeTool/EnterPlanModeTool.ts"
export { EnterWorktreeTool } from "./tools/EnterWorktreeTool/EnterWorktreeTool.ts"
export { ExitPlanModeV2Tool } from "./tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts"
export { ExitWorktreeTool } from "./tools/ExitWorktreeTool/ExitWorktreeTool.ts"
export { FileEditTool } from "./tools/FileEditTool/FileEditTool.ts"
export { FileReadTool } from "./tools/FileReadTool/FileReadTool.ts"
export { FileWriteTool } from "./tools/FileWriteTool/FileWriteTool.ts"
export { GlobTool } from "./tools/GlobTool/GlobTool.ts"
export { GrepTool } from "./tools/GrepTool/GrepTool.ts"
export { LSPTool } from "./tools/LSPTool/LSPTool.ts"
export { ListMcpResourcesTool } from "./tools/ListMcpResourcesTool/ListMcpResourcesTool.ts"
export { ReadMcpResourceTool } from "./tools/ReadMcpResourceTool/ReadMcpResourceTool.ts"
export { NotebookEditTool } from "./tools/NotebookEditTool/NotebookEditTool.ts"
export { SkillTool } from "./tools/SkillTool/SkillTool.ts"
export { TaskOutputTool } from "./tools/TaskOutputTool/TaskOutputTool.ts"
export { TaskStopTool } from "./tools/TaskStopTool/TaskStopTool.ts"
export { TodoWriteTool } from "./tools/TodoWriteTool/TodoWriteTool.ts"
export { ToolSearchTool } from "./tools/ToolSearchTool/ToolSearchTool.ts"
export { TungstenTool } from "./tools/TungstenTool/TungstenTool.ts"
export { WebFetchTool } from "./tools/WebFetchTool/WebFetchTool.ts"
export { WebSearchTool } from "./tools/WebSearchTool/WebSearchTool.ts"
export { TestingPermissionTool } from "./tools/testing/TestingPermissionTool.ts"

// Feature-gated tools
export { OVERFLOW_TEST_TOOL_NAME } from "./tools/OverflowTestTool/OverflowTestTool.ts"
export { CtxInspectTool } from "./tools/CtxInspectTool/CtxInspectTool.ts"
export { ListPeersTool } from "./tools/ListPeersTool/ListPeersTool.ts"
export { MonitorTool } from "./tools/MonitorTool/MonitorTool.ts"
export { PowerShellTool } from "./tools/PowerShellTool/PowerShellTool.ts"
export { PushNotificationTool } from "./tools/PushNotificationTool/PushNotificationTool.ts"
export { REPLTool } from "./tools/REPLTool/REPLTool.ts"
export { RemoteTriggerTool } from "./tools/RemoteTriggerTool/RemoteTriggerTool.ts"
export { ReviewArtifactTool } from "./tools/ReviewArtifactTool/ReviewArtifactTool.ts"
export { CronCreateTool } from "./tools/ScheduleCronTool/CronCreateTool.ts"
export { CronDeleteTool } from "./tools/ScheduleCronTool/CronDeleteTool.ts"
export { CronListTool } from "./tools/ScheduleCronTool/CronListTool.ts"
export { SendMessageTool } from "./tools/SendMessageTool/SendMessageTool.ts"
export { SendUserFileTool } from "./tools/SendUserFileTool/SendUserFileTool.ts"
export { SleepTool } from "./tools/SleepTool/SleepTool.ts"
export { SnipTool } from "./tools/SnipTool/SnipTool.ts"
export { SubscribePRTool } from "./tools/SubscribePRTool/SubscribePRTool.ts"
export { SuggestBackgroundPRTool } from "./tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts"
export { TeamCreateTool } from "./tools/TeamCreateTool/TeamCreateTool.ts"
export { TeamDeleteTool } from "./tools/TeamDeleteTool/TeamDeleteTool.ts"
export { TerminalCaptureTool } from "./tools/TerminalCaptureTool/TerminalCaptureTool.ts"
export { VerifyPlanExecutionTool } from "./tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts"
export { WebBrowserTool } from "./tools/WebBrowserTool/WebBrowserTool.ts"
export { WorkflowTool } from "./tools/WorkflowTool/WorkflowTool.ts"
export { initBundledWorkflows } from "./tools/WorkflowTool/bundled/index.ts"
export { getWorkflowCommands } from "./tools/WorkflowTool/createWorkflowCommand.ts"

// Constants
export {
  SYNTHETIC_OUTPUT_TOOL_NAME,
  createSyntheticOutputTool,
} from "./tools/SyntheticOutputTool/SyntheticOutputTool.ts"

// Shared utilities
export {
  tagMessagesWithToolUseID,
  getToolUseIDFromParentMessage,
} from "./tools/utils.ts"
