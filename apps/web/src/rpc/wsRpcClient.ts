import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
  type LocalApi,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcInputStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: RpcInput<TTag>,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly isHeartbeatFresh: () => boolean;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly readFile: RpcUnaryMethod<typeof WS_METHODS.projectsReadFile>;
    readonly listDirectory: RpcUnaryMethod<typeof WS_METHODS.projectsListDirectory>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
    readonly createBlank: RpcUnaryMethod<typeof WS_METHODS.projectsCreateBlank>;
    readonly ensureDirectory: RpcUnaryMethod<typeof WS_METHODS.projectsEnsureDirectory>;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly sourceControl: {
    readonly lookupRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlLookupRepository>;
    readonly cloneRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlCloneRepository>;
    readonly publishRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlPublishRepository>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly vcs: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.vcsPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.vcsRefreshStatus>;
    readonly diffWorkingTree: RpcUnaryMethod<typeof WS_METHODS.vcsDiffWorkingTree>;
    readonly diffCommit: RpcUnaryMethod<typeof WS_METHODS.vcsDiffCommit>;
    readonly stageFile: RpcUnaryMethod<typeof WS_METHODS.vcsStageFile>;
    readonly unstageFile: RpcUnaryMethod<typeof WS_METHODS.vcsUnstageFile>;
    readonly restoreFile: RpcUnaryMethod<typeof WS_METHODS.vcsRestoreFile>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeVcsStatus>,
      listener: (status: VcsStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly listRefs: RpcUnaryMethod<typeof WS_METHODS.vcsListRefs>;
    readonly listCommits: RpcUnaryMethod<typeof WS_METHODS.vcsListCommits>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsRemoveWorktree>;
    readonly createRef: RpcUnaryMethod<typeof WS_METHODS.vcsCreateRef>;
    readonly switchRef: RpcUnaryMethod<typeof WS_METHODS.vcsSwitchRef>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.vcsInit>;
  };
  /**
   * Git-specific workflows. Local repository mechanics live under `vcs`.
   */
  readonly git: {
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    /**
     * Refresh provider snapshots. Pass `{ instanceId }` to refresh a single
     * configured instance; pass no argument (or `{}`) to refresh all.
     */
    readonly refreshProviders: (
      input?: RpcInput<typeof WS_METHODS.serverRefreshProviders>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverRefreshProviders>>;
    readonly updateProvider: RpcUnaryMethod<typeof WS_METHODS.serverUpdateProvider>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly removeKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverRemoveKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly getCodexGlobalGuidance: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverGetCodexGlobalGuidance
    >;
    readonly updateCodexGlobalGuidance: RpcUnaryMethod<
      typeof WS_METHODS.serverUpdateCodexGlobalGuidance
    >;
    readonly discoverSourceControl: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverDiscoverSourceControl
    >;
    readonly getTraceDiagnostics: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetTraceDiagnostics>;
    readonly getProcessDiagnostics: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverGetProcessDiagnostics
    >;
    readonly getProcessResourceHistory: RpcUnaryMethod<
      typeof WS_METHODS.serverGetProcessResourceHistory
    >;
    readonly signalProcess: RpcUnaryMethod<typeof WS_METHODS.serverSignalProcess>;
    readonly resolveAttachmentPath: RpcUnaryMethod<typeof WS_METHODS.serverResolveAttachmentPath>;
    readonly windowsSandboxReadiness: RpcUnaryMethod<
      typeof WS_METHODS.providerWindowsSandboxReadiness
    >;
    readonly windowsSandboxSetupStart: RpcUnaryMethod<
      typeof WS_METHODS.providerWindowsSandboxSetupStart
    >;
    readonly updateThreadSettings: RpcUnaryMethod<typeof WS_METHODS.providerThreadSettingsUpdate>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly orchestration: {
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly getThreadHistoryPage: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.getThreadHistoryPage
    >;
    readonly listThreadTurns: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.listThreadTurns>;
    readonly listThreadTurnItems: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.listThreadTurnItems
    >;
    readonly getArchivedShellSnapshot: RpcUnaryNoArgMethod<
      typeof ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot
    >;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeThread: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeThread>;
  };
  readonly skills: {
    readonly list: RpcUnaryNoArgMethod<typeof WS_METHODS.skillsList>;
    readonly catalog: (
      input?: RpcInput<typeof WS_METHODS.skillsCatalog>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.skillsCatalog>>;
    readonly refresh: RpcUnaryMethod<typeof WS_METHODS.skillsRefresh>;
    readonly install: RpcUnaryMethod<typeof WS_METHODS.skillsInstall>;
    readonly uninstall: RpcUnaryMethod<typeof WS_METHODS.skillsUninstall>;
    readonly content: RpcUnaryMethod<typeof WS_METHODS.skillsContent>;
  };
  readonly plugins: {
    readonly list: RpcUnaryNoArgMethod<typeof WS_METHODS.pluginsList>;
    readonly read: RpcUnaryMethod<typeof WS_METHODS.pluginsRead>;
    readonly install: RpcUnaryMethod<typeof WS_METHODS.pluginsInstall>;
    readonly uninstall: RpcUnaryMethod<typeof WS_METHODS.pluginsUninstall>;
  };
  readonly marketplace: {
    readonly add: RpcUnaryMethod<typeof WS_METHODS.marketplaceAdd>;
    readonly upgrade: RpcUnaryMethod<typeof WS_METHODS.marketplaceUpgrade>;
  };
  readonly automations: {
    readonly list: RpcUnaryMethod<typeof WS_METHODS.automationsList>;
    readonly get: RpcUnaryMethod<typeof WS_METHODS.automationsGet>;
    readonly upsert: RpcUnaryMethod<typeof WS_METHODS.automationsUpsert>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.automationsDelete>;
    readonly runNow: RpcUnaryMethod<typeof WS_METHODS.automationsRunNow>;
    readonly archiveRun: RpcUnaryMethod<typeof WS_METHODS.automationsArchiveRun>;
    readonly markRunRead: RpcUnaryMethod<typeof WS_METHODS.automationsMarkRunRead>;
    readonly subscribe: RpcStreamMethod<typeof WS_METHODS.automationsSubscribe>;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    isHeartbeatFresh: () => transport.isHeartbeatFresh(),
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeTerminalEvents]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeTerminalEvents,
        }),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      readFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsReadFile](input)),
      listDirectory: (input) =>
        transport.request((client) => client[WS_METHODS.projectsListDirectory](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
      createBlank: (input) =>
        transport.request((client) => client[WS_METHODS.projectsCreateBlank](input)),
      ensureDirectory: (input) =>
        transport.request((client) => client[WS_METHODS.projectsEnsureDirectory](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    sourceControl: {
      lookupRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlLookupRepository](input)),
      cloneRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlCloneRepository](input)),
      publishRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlPublishRepository](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    vcs: {
      pull: (input) => transport.request((client) => client[WS_METHODS.vcsPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRefreshStatus](input)),
      diffWorkingTree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsDiffWorkingTree](input)),
      diffCommit: (input) => transport.request((client) => client[WS_METHODS.vcsDiffCommit](input)),
      stageFile: (input) => transport.request((client) => client[WS_METHODS.vcsStageFile](input)),
      unstageFile: (input) =>
        transport.request((client) => client[WS_METHODS.vcsUnstageFile](input)),
      restoreFile: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRestoreFile](input)),
      onStatus: (input, listener, options) => {
        let current: VcsStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeVcsStatus](input),
          (event: VcsStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          { ...options, tag: WS_METHODS.subscribeVcsStatus },
        );
      },
      listRefs: (input) => transport.request((client) => client[WS_METHODS.vcsListRefs](input)),
      listCommits: (input) =>
        transport.request((client) => client[WS_METHODS.vcsListCommits](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRemoveWorktree](input)),
      createRef: (input) => transport.request((client) => client[WS_METHODS.vcsCreateRef](input)),
      switchRef: (input) => transport.request((client) => client[WS_METHODS.vcsSwitchRef](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.vcsInit](input)),
    },
    git: {
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: (input) =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders](input ?? {})),
      updateProvider: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpdateProvider](input)),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      removeKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverRemoveKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      getCodexGlobalGuidance: () =>
        transport.request((client) => client[WS_METHODS.serverGetCodexGlobalGuidance]({})),
      updateCodexGlobalGuidance: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpdateCodexGlobalGuidance](input)),
      discoverSourceControl: () =>
        transport.request((client) => client[WS_METHODS.serverDiscoverSourceControl]({})),
      getTraceDiagnostics: () =>
        transport.request((client) =>
          client[WS_METHODS.serverGetTraceDiagnostics]({}).pipe(Effect.withTracerEnabled(false)),
        ),
      getProcessDiagnostics: () =>
        transport.request((client) =>
          client[WS_METHODS.serverGetProcessDiagnostics]({}).pipe(Effect.withTracerEnabled(false)),
        ),
      getProcessResourceHistory: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverGetProcessResourceHistory](input).pipe(
            Effect.withTracerEnabled(false),
          ),
        ),
      signalProcess: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverSignalProcess](input).pipe(Effect.withTracerEnabled(false)),
        ),
      resolveAttachmentPath: (input) =>
        transport.request((client) => client[WS_METHODS.serverResolveAttachmentPath](input)),
      windowsSandboxReadiness: (input) =>
        transport.request((client) => client[WS_METHODS.providerWindowsSandboxReadiness](input)),
      windowsSandboxSetupStart: (input) =>
        transport.request((client) => client[WS_METHODS.providerWindowsSandboxSetupStart](input)),
      updateThreadSettings: (input) =>
        transport.request((client) => client[WS_METHODS.providerThreadSettingsUpdate](input)),
      subscribeConfig: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerConfig]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerConfig,
        }),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerLifecycle]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerLifecycle,
        }),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeAuthAccess]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeAuthAccess,
        }),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      getThreadHistoryPage: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getThreadHistoryPage](input),
        ),
      listThreadTurns: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.listThreadTurns](input)),
      listThreadTurnItems: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.listThreadTurnItems](input)),
      getArchivedShellSnapshot: () =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({}),
        ),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeShell },
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeThread },
        ),
    },
    skills: {
      list: () => transport.request((client) => client[WS_METHODS.skillsList]({})),
      catalog: (input) =>
        transport.request((client) => client[WS_METHODS.skillsCatalog](input ?? {})),
      refresh: (input) => transport.request((client) => client[WS_METHODS.skillsRefresh](input)),
      install: (input) => transport.request((client) => client[WS_METHODS.skillsInstall](input)),
      uninstall: (input) =>
        transport.request((client) => client[WS_METHODS.skillsUninstall](input)),
      content: (input) => transport.request((client) => client[WS_METHODS.skillsContent](input)),
    },
    plugins: {
      list: () => transport.request((client) => client[WS_METHODS.pluginsList]({})),
      read: (input) => transport.request((client) => client[WS_METHODS.pluginsRead](input)),
      install: (input) => transport.request((client) => client[WS_METHODS.pluginsInstall](input)),
      uninstall: (input) =>
        transport.request((client) => client[WS_METHODS.pluginsUninstall](input)),
    },
    marketplace: {
      add: (input) => transport.request((client) => client[WS_METHODS.marketplaceAdd](input)),
      upgrade: (input) =>
        transport.request((client) => client[WS_METHODS.marketplaceUpgrade](input)),
    },
    automations: {
      list: (input) => transport.request((client) => client[WS_METHODS.automationsList](input)),
      get: (input) => transport.request((client) => client[WS_METHODS.automationsGet](input)),
      upsert: (input) => transport.request((client) => client[WS_METHODS.automationsUpsert](input)),
      delete: (input) => transport.request((client) => client[WS_METHODS.automationsDelete](input)),
      runNow: (input) => transport.request((client) => client[WS_METHODS.automationsRunNow](input)),
      archiveRun: (input) =>
        transport.request((client) => client[WS_METHODS.automationsArchiveRun](input)),
      markRunRead: (input) =>
        transport.request((client) => client[WS_METHODS.automationsMarkRunRead](input)),
      subscribe: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.automationsSubscribe]({}), listener, {
          ...options,
          tag: WS_METHODS.automationsSubscribe,
        }),
    },
  };
}
