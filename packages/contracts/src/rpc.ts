import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import { AuthAccessStreamEvent } from "./auth.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsDiffWorkingTreeInput,
  VcsDiffWorkingTreeResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectListDirectoryError,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
  ProjectCreateBlankError,
  ProjectCreateBlankInput,
  ProjectCreateBlankResult,
} from "./project.ts";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
  ProviderWindowsSandboxReadinessInput,
  ProviderWindowsSandboxReadinessResult,
  ProviderWindowsSandboxSetupStartInput,
  ProviderWindowsSandboxSetupStartResult,
  ProviderWindowsSandboxError,
} from "./server.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import {
  SkillContentInput,
  SkillContentResult,
  SkillInstallInput,
  SkillInstallResult,
  SkillUninstallInput,
  SkillUninstallResult,
  SkillsCatalogResponse,
  SkillsListResponse,
  SkillsRefreshInput,
  SkillsServiceError,
} from "./skills.ts";
import {
  MarketplaceAddInput,
  MarketplaceAddResponse,
  MarketplaceUpgradeInput,
  MarketplaceUpgradeResponse,
  PluginInstallInput,
  PluginInstallResponse,
  PluginListResponse,
  PluginReadInput,
  PluginReadResponse,
  PluginServiceError,
  PluginUninstallInput,
  PluginUninstallResponse,
} from "./plugins.ts";
import {
  AutomationArchiveRunInput,
  AutomationDeleteInput,
  AutomationGetInput,
  AutomationGetResult,
  AutomationListInput,
  AutomationListResult,
  AutomationMarkRunReadInput,
  AutomationRunNowInput,
  AutomationServiceError,
  AutomationStreamEvent,
  AutomationUpsertInput,
  Automation,
} from "./automations.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsReadFile: "projects.readFile",
  projectsListDirectory: "projects.listDirectory",
  projectsWriteFile: "projects.writeFile",
  projectsCreateBlank: "projects.createBlank",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsDiffWorkingTree: "vcs.diffWorkingTree",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverSignalProcess: "server.signalProcess",
  providerWindowsSandboxReadiness: "provider.windowsSandbox.readiness",
  providerWindowsSandboxSetupStart: "provider.windowsSandbox.setupStart",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Skills methods
  skillsList: "skills.list",
  skillsCatalog: "skills.catalog",
  skillsRefresh: "skills.refresh",
  skillsInstall: "skills.install",
  skillsUninstall: "skills.uninstall",
  skillsContent: "skills.content",

  // Plugin and marketplace methods
  pluginsList: "plugins.list",
  pluginsRead: "plugins.read",
  pluginsInstall: "plugins.install",
  pluginsUninstall: "plugins.uninstall",
  marketplaceAdd: "marketplace.add",
  marketplaceUpgrade: "marketplace.upgrade",

  // Automations methods
  automationsList: "automations.list",
  automationsGet: "automations.get",
  automationsUpsert: "automations.upsert",
  automationsDelete: "automations.delete",
  automationsRunNow: "automations.runNow",
  automationsArchiveRun: "automations.archiveRun",
  automationsMarkRunRead: "automations.markRunRead",
  automationsSubscribe: "automations.subscribe",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
  }),
  success: ServerProviderUpdatedPayload,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: ServerProviderUpdateError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
});

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
  },
);

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
});

export const WsProviderWindowsSandboxReadinessRpc = Rpc.make(
  WS_METHODS.providerWindowsSandboxReadiness,
  {
    payload: ProviderWindowsSandboxReadinessInput,
    success: ProviderWindowsSandboxReadinessResult,
    error: ProviderWindowsSandboxError,
  },
);

export const WsProviderWindowsSandboxSetupStartRpc = Rpc.make(
  WS_METHODS.providerWindowsSandboxSetupStart,
  {
    payload: ProviderWindowsSandboxSetupStartInput,
    success: ProviderWindowsSandboxSetupStartResult,
    error: ProviderWindowsSandboxError,
  },
);

export const WsSourceControlLookupRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlLookupRepository,
  {
    payload: SourceControlRepositoryLookupInput,
    success: SourceControlRepositoryInfo,
    error: SourceControlRepositoryError,
  },
);

export const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: SourceControlRepositoryError,
});

export const WsSourceControlPublishRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlPublishRepository,
  {
    payload: SourceControlPublishRepositoryInput,
    success: SourceControlPublishRepositoryResult,
    error: SourceControlRepositoryError,
  },
);

export const WsSkillsListRpc = Rpc.make(WS_METHODS.skillsList, {
  payload: Schema.Struct({}),
  success: SkillsListResponse,
  error: SkillsServiceError,
});

export const WsSkillsCatalogRpc = Rpc.make(WS_METHODS.skillsCatalog, {
  payload: Schema.Struct({}),
  success: SkillsCatalogResponse,
  error: SkillsServiceError,
});

export const WsSkillsRefreshRpc = Rpc.make(WS_METHODS.skillsRefresh, {
  payload: SkillsRefreshInput,
  success: SkillsCatalogResponse,
  error: SkillsServiceError,
});

export const WsSkillsInstallRpc = Rpc.make(WS_METHODS.skillsInstall, {
  payload: SkillInstallInput,
  success: SkillInstallResult,
  error: SkillsServiceError,
});

export const WsSkillsUninstallRpc = Rpc.make(WS_METHODS.skillsUninstall, {
  payload: SkillUninstallInput,
  success: SkillUninstallResult,
  error: SkillsServiceError,
});

export const WsSkillsContentRpc = Rpc.make(WS_METHODS.skillsContent, {
  payload: SkillContentInput,
  success: SkillContentResult,
  error: SkillsServiceError,
});

export const WsPluginsListRpc = Rpc.make(WS_METHODS.pluginsList, {
  payload: Schema.Struct({}),
  success: PluginListResponse,
  error: PluginServiceError,
});

export const WsPluginsReadRpc = Rpc.make(WS_METHODS.pluginsRead, {
  payload: PluginReadInput,
  success: PluginReadResponse,
  error: PluginServiceError,
});

export const WsPluginsInstallRpc = Rpc.make(WS_METHODS.pluginsInstall, {
  payload: PluginInstallInput,
  success: PluginInstallResponse,
  error: PluginServiceError,
});

export const WsPluginsUninstallRpc = Rpc.make(WS_METHODS.pluginsUninstall, {
  payload: PluginUninstallInput,
  success: PluginUninstallResponse,
  error: PluginServiceError,
});

export const WsMarketplaceAddRpc = Rpc.make(WS_METHODS.marketplaceAdd, {
  payload: MarketplaceAddInput,
  success: MarketplaceAddResponse,
  error: PluginServiceError,
});

export const WsMarketplaceUpgradeRpc = Rpc.make(WS_METHODS.marketplaceUpgrade, {
  payload: MarketplaceUpgradeInput,
  success: MarketplaceUpgradeResponse,
  error: PluginServiceError,
});

export const WsAutomationsListRpc = Rpc.make(WS_METHODS.automationsList, {
  payload: AutomationListInput,
  success: AutomationListResult,
  error: AutomationServiceError,
});

export const WsAutomationsGetRpc = Rpc.make(WS_METHODS.automationsGet, {
  payload: AutomationGetInput,
  success: AutomationGetResult,
  error: AutomationServiceError,
});

export const WsAutomationsUpsertRpc = Rpc.make(WS_METHODS.automationsUpsert, {
  payload: AutomationUpsertInput,
  success: Automation,
  error: AutomationServiceError,
});

export const WsAutomationsDeleteRpc = Rpc.make(WS_METHODS.automationsDelete, {
  payload: AutomationDeleteInput,
  error: AutomationServiceError,
});

export const WsAutomationsRunNowRpc = Rpc.make(WS_METHODS.automationsRunNow, {
  payload: AutomationRunNowInput,
  success: AutomationListResult,
  error: AutomationServiceError,
});

export const WsAutomationsArchiveRunRpc = Rpc.make(WS_METHODS.automationsArchiveRun, {
  payload: AutomationArchiveRunInput,
  success: AutomationListResult,
  error: AutomationServiceError,
});

export const WsAutomationsMarkRunReadRpc = Rpc.make(WS_METHODS.automationsMarkRunRead, {
  payload: AutomationMarkRunReadInput,
  success: AutomationListResult,
  error: AutomationServiceError,
});

export const WsAutomationsSubscribeRpc = Rpc.make(WS_METHODS.automationsSubscribe, {
  payload: Schema.Struct({}),
  success: AutomationStreamEvent,
  error: AutomationServiceError,
  stream: true,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: ProjectReadFileError,
});

export const WsProjectsListDirectoryRpc = Rpc.make(WS_METHODS.projectsListDirectory, {
  payload: ProjectListDirectoryInput,
  success: ProjectListDirectoryResult,
  error: ProjectListDirectoryError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsProjectsCreateBlankRpc = Rpc.make(WS_METHODS.projectsCreateBlank, {
  payload: ProjectCreateBlankInput,
  success: ProjectCreateBlankResult,
  error: ProjectCreateBlankError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: ExternalLauncherError,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});

export const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: GitCommandError,
});

export const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: GitManagerServiceError,
});

export const WsVcsDiffWorkingTreeRpc = Rpc.make(WS_METHODS.vcsDiffWorkingTree, {
  payload: VcsDiffWorkingTreeInput,
  success: VcsDiffWorkingTreeResult,
  error: GitCommandError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: GitCommandError,
});

export const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: GitCommandError,
});

export const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: GitCommandError,
});

export const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: GitCommandError,
});

export const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: VcsError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: OrchestrationGetSnapshotError,
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: OrchestrationGetSnapshotError,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerSignalProcessRpc,
  WsProviderWindowsSandboxReadinessRpc,
  WsProviderWindowsSandboxSetupStartRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsSkillsListRpc,
  WsSkillsCatalogRpc,
  WsSkillsRefreshRpc,
  WsSkillsInstallRpc,
  WsSkillsUninstallRpc,
  WsSkillsContentRpc,
  WsPluginsListRpc,
  WsPluginsReadRpc,
  WsPluginsInstallRpc,
  WsPluginsUninstallRpc,
  WsMarketplaceAddRpc,
  WsMarketplaceUpgradeRpc,
  WsAutomationsListRpc,
  WsAutomationsGetRpc,
  WsAutomationsUpsertRpc,
  WsAutomationsDeleteRpc,
  WsAutomationsRunNowRpc,
  WsAutomationsArchiveRunRpc,
  WsAutomationsMarkRunReadRpc,
  WsAutomationsSubscribeRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsListDirectoryRpc,
  WsProjectsWriteFileRpc,
  WsProjectsCreateBlankRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsVcsDiffWorkingTreeRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
);
