// @effect-diagnostics nodeBuiltinImport:off instanceOfSchema:off
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexSchema from "effect-codex-app-server/schema";

import {
  type MarketplaceAddInput,
  type MarketplaceAddResponse,
  type MarketplaceUpgradeInput,
  type MarketplaceUpgradeResponse,
  PluginServiceError,
  type PluginDetail,
  type PluginInstallInput,
  type PluginInstallResponse,
  type PluginListResponse,
  type PluginMarketplace,
  type PluginReadInput,
  type PluginReadResponse,
  type PluginSource,
  type PluginSummary,
  type PluginUninstallInput,
  type PluginUninstallResponse,
  ProviderDriverKind,
  type CodexSettings,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import { resolveBundledExtensionsRoot } from "../extensions/BundledExtensions.ts";
import { expandHomePath } from "../pathExpansion.ts";
import {
  buildBundledSpawnArgs,
  buildCodexProcessEnv,
  buildSystemSpawnArgs,
  resolveBundledEngineConfig,
} from "../provider/BundledEngineConfig.ts";
import { buildCodexInitializeParams } from "../provider/Layers/CodexProvider.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";

interface CodexPluginClientContext {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface PluginListCacheEntry {
  readonly expiresAtMs: number;
  readonly value: PluginListResponse;
}

export interface CodexPluginServiceShape {
  readonly list: () => Effect.Effect<PluginListResponse, PluginServiceError>;
  readonly read: (input: PluginReadInput) => Effect.Effect<PluginReadResponse, PluginServiceError>;
  readonly install: (
    input: PluginInstallInput,
  ) => Effect.Effect<PluginInstallResponse, PluginServiceError>;
  readonly uninstall: (
    input: PluginUninstallInput,
  ) => Effect.Effect<PluginUninstallResponse, PluginServiceError>;
  readonly addMarketplace: (
    input: MarketplaceAddInput,
  ) => Effect.Effect<MarketplaceAddResponse, PluginServiceError>;
  readonly upgradeMarketplace: (
    input: MarketplaceUpgradeInput,
  ) => Effect.Effect<MarketplaceUpgradeResponse, PluginServiceError>;
}

export class CodexPluginService extends Context.Service<
  CodexPluginService,
  CodexPluginServiceShape
>()("t3/plugins/CodexPluginService") {}

type PluginListSummary = CodexSchema.V2PluginListResponse__PluginSummary;
type PluginReadSummary = CodexSchema.V2PluginReadResponse__PluginSummary;
type PluginReadDetail = CodexSchema.V2PluginReadResponse__PluginDetail;
type PluginListSource = CodexSchema.V2PluginListResponse__PluginSource;
type PluginReadSource = CodexSchema.V2PluginReadResponse__PluginSource;

const BUILTIN_PLUGINS: readonly PluginSummary[] = [
  {
    id: "builtin:browser_use",
    name: "browser_use",
    displayName: "Browser Use",
    description: "内置浏览器、页面检查、点击、输入、截图和 DOM 读取。",
    installed: true,
    enabled: true,
    authPolicy: "ON_USE",
    installPolicy: "INSTALLED_BY_DEFAULT",
    availability: "AVAILABLE",
    source: { type: "builtin", builtinId: "browser_use" },
    keywords: ["browser_use", "in_app_browser", "t3_browser"],
    location: {
      pluginName: "browser_use",
      marketplaceName: "T3 Builtins",
      remoteMarketplaceName: null,
      marketplacePath: null,
    },
  },
  {
    id: "builtin:computer_use",
    name: "computer_use",
    displayName: "Computer Use",
    description: "Windows 桌面截图、鼠标、键盘和 App 级授权控制。",
    installed: true,
    enabled: true,
    authPolicy: "ON_USE",
    installPolicy: "INSTALLED_BY_DEFAULT",
    availability: "AVAILABLE",
    source: { type: "builtin", builtinId: "computer_use" },
    keywords: ["computer_use", "t3_computer", "desktop"],
    location: {
      pluginName: "computer_use",
      marketplaceName: "T3 Builtins",
      remoteMarketplaceName: null,
      marketplacePath: null,
    },
  },
  {
    id: "builtin:browser_use_external",
    name: "browser_use_external",
    displayName: "Browser Use External",
    description: "通过 Bahew Chrome Extension 控制用户 Chrome。",
    installed: true,
    enabled: true,
    authPolicy: "ON_USE",
    installPolicy: "INSTALLED_BY_DEFAULT",
    availability: "AVAILABLE",
    source: { type: "builtin", builtinId: "browser_use_external" },
    keywords: ["browser_use_external", "chrome", "t3_browser_external"],
    location: {
      pluginName: "browser_use_external",
      marketplaceName: "T3 Builtins",
      remoteMarketplaceName: null,
      marketplacePath: null,
    },
  },
] as const;

const BUILTIN_MARKETPLACE: PluginMarketplace = {
  name: "T3 Builtins",
  displayName: "T3 Builtins",
  path: null,
  plugins: [...BUILTIN_PLUGINS],
};
const PLUGIN_LIST_CACHE_TTL_MS = 30_000;

export function isPluginListCacheEntryFresh(
  entry: PluginListCacheEntry | null,
  nowMs: number,
): entry is PluginListCacheEntry {
  return entry !== null && entry.expiresAtMs > nowMs;
}

export function buildPluginListCwds(input: {
  readonly workspaceCwd: string;
  readonly bundledExtensionsRoot?: string | undefined;
}): ReadonlyArray<string> {
  return input.bundledExtensionsRoot
    ? [input.workspaceCwd, input.bundledExtensionsRoot]
    : [input.workspaceCwd];
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSource(source: PluginListSource | PluginReadSource): PluginSource {
  switch (source.type) {
    case "local":
      return { type: "codexLocal", path: source.path };
    case "git": {
      const path = normalizeOptionalString(source.path);
      const refName = normalizeOptionalString(source.refName);
      const sha = normalizeOptionalString(source.sha);
      return {
        type: "codexGit",
        url: source.url,
        ...(path ? { path } : {}),
        ...(refName ? { refName } : {}),
        ...(sha ? { sha } : {}),
      };
    }
    case "remote":
      return { type: "codexRemote" };
  }
}

function normalizeSummary(
  summary: PluginListSummary | PluginReadSummary,
  marketplace: {
    readonly name: string;
    readonly path?: string | null;
  },
): PluginSummary {
  const interfaceSummary = summary.interface ?? null;
  const displayName = normalizeOptionalString(interfaceSummary?.displayName) ?? summary.name;
  const description =
    normalizeOptionalString(interfaceSummary?.shortDescription) ??
    normalizeOptionalString(interfaceSummary?.longDescription);
  return {
    id: summary.id,
    name: summary.name,
    displayName,
    ...(description ? { description } : {}),
    installed: summary.installed,
    enabled: summary.enabled,
    authPolicy: summary.authPolicy,
    installPolicy: summary.installPolicy,
    availability: summary.availability ?? "AVAILABLE",
    source: normalizeSource(summary.source),
    keywords: [...(summary.keywords ?? [])],
    ...(summary.localVersion !== undefined ? { localVersion: summary.localVersion } : {}),
    location: {
      pluginName: summary.name,
      marketplaceName: marketplace.name,
      marketplacePath: marketplace.path ?? null,
      remoteMarketplaceName: marketplace.path ? null : marketplace.name,
    },
  };
}

function normalizeMarketplace(
  marketplace: CodexSchema.V2PluginListResponse__PluginMarketplaceEntry,
): PluginMarketplace {
  const displayName = normalizeOptionalString(marketplace.interface?.displayName);
  return {
    name: marketplace.name,
    ...(displayName ? { displayName } : {}),
    path: marketplace.path ?? null,
    plugins: marketplace.plugins.map((plugin) =>
      normalizeSummary(plugin, { name: marketplace.name, path: marketplace.path ?? null }),
    ),
  } satisfies PluginMarketplace;
}

function normalizeAppSummary(input: CodexSchema.V2PluginReadResponse__AppSummary) {
  const title = normalizeOptionalString(input.name);
  const description = normalizeOptionalString(input.description);
  return {
    id: input.id,
    name: input.name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}

function normalizeAppTemplate(input: CodexSchema.V2PluginReadResponse__AppTemplateSummary) {
  const title = normalizeOptionalString(input.name);
  const description = normalizeOptionalString(input.description);
  return {
    id: input.templateId,
    name: input.name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}

function normalizePluginDetail(detail: PluginReadDetail): PluginDetail {
  const summary = normalizeSummary(detail.summary, {
    name: detail.marketplaceName,
    path: detail.marketplacePath ?? null,
  });
  const description =
    normalizeOptionalString(detail.description) ??
    normalizeOptionalString(detail.summary.interface?.longDescription) ??
    normalizeOptionalString(detail.summary.interface?.shortDescription);
  return {
    summary,
    ...(description ? { description } : {}),
    marketplaceName: detail.marketplaceName,
    marketplacePath: detail.marketplacePath ?? null,
    skills: detail.skills.map((skill) => {
      const displayName = normalizeOptionalString(skill.interface?.displayName);
      const description = normalizeOptionalString(skill.shortDescription ?? skill.description);
      return {
        name: skill.name,
        ...(displayName ? { displayName } : {}),
        ...(description ? { description } : {}),
      };
    }),
    apps: detail.apps.map(normalizeAppSummary),
    appTemplates: detail.appTemplates.map(normalizeAppTemplate),
    mcpServers: [...detail.mcpServers],
    hooks: detail.hooks.map((hook) => ({
      name: hook.key,
      event: hook.eventName,
    })),
  };
}

function toPluginError(operation: string, cause: unknown): PluginServiceError {
  if (cause instanceof PluginServiceError) return cause;
  if (cause instanceof Error) {
    const message = cause.message;
    const lower = message.toLowerCase();
    return new PluginServiceError({
      detail: `${operation}: ${message}`,
      kind:
        lower.includes("method") && lower.includes("not found")
          ? "unsupported"
          : lower.includes("not found")
            ? "notFound"
            : "internal",
    });
  }
  return new PluginServiceError({
    detail: `${operation}: ${String(cause)}`,
    kind: "internal",
  });
}

const resolveClientContext = Effect.fn("CodexPluginService.resolveClientContext")(function* (
  config: typeof ServerConfig.Service,
  settings: typeof ServerSettingsService.Service,
) {
  const serverSettings = yield* settings.getSettings;
  const codexSettings = (serverSettings.providers.codex ?? {}) as CodexSettings;
  const baseEnv = process.env;
  const bundledConfig = resolveBundledEngineConfig(baseEnv);
  const binaryPath = bundledConfig?.binaryPath ?? (codexSettings.binaryPath ?? "").trim();

  if (binaryPath.length === 0) {
    return yield* new PluginServiceError({
      detail: "Codex provider is not configured.",
      kind: "providerUnavailable",
    });
  }

  const resolvedHomePath = codexSettings.homePath
    ? expandHomePath(codexSettings.homePath)
    : undefined;
  return {
    binaryPath,
    args: bundledConfig ? buildBundledSpawnArgs(bundledConfig) : buildSystemSpawnArgs(),
    cwd: config.cwd,
    env: buildCodexProcessEnv({
      baseEnv,
      resolvedHomePath,
      bundledConfig,
    }),
  } satisfies CodexPluginClientContext;
});

const withClient = <A>(
  operation: string,
  input: {
    readonly config: typeof ServerConfig.Service;
    readonly settings: typeof ServerSettingsService.Service;
    readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  },
  run: (
    client: CodexClient.CodexAppServerClientShape,
  ) => Effect.Effect<A, PluginServiceError | CodexErrors.CodexAppServerError>,
) =>
  Effect.gen(function* () {
    const ctx = yield* resolveClientContext(input.config, input.settings);
    const clientLayer = CodexClient.layerCommand({
      command: ctx.binaryPath,
      args: ctx.args,
      cwd: ctx.cwd,
      env: ctx.env,
    });
    const clientContext = yield* Layer.build(clientLayer).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
    );
    const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
      Effect.provide(clientContext),
    );
    yield* client.request("initialize", buildCodexInitializeParams());
    yield* client.notify("initialized", undefined);
    yield* client
      .request("experimentalFeature/enablement/set", {
        enablement: {
          plugins: true,
          apps: true,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new PluginServiceError({
              detail: `Codex plugin feature is not supported by this engine: ${cause.message}`,
              kind: "unsupported",
            }),
        ),
      );
    return yield* run(client);
  }).pipe(
    Effect.scoped,
    Effect.mapError((cause) => toPluginError(operation, cause)),
  );

const make = Effect.fn("makeCodexPluginService")(function* () {
  const config = yield* ServerConfig;
  const settings = yield* ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clientServices = { config, settings, spawner } as const;
  const pluginListCacheRef = yield* Ref.make<PluginListCacheEntry | null>(null);
  const resolveBundledRoot = () =>
    resolveBundledExtensionsRoot().pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const refreshCodexProvider = (reason: string) =>
    providerRegistry.refresh(ProviderDriverKind.make("codex")).pipe(
      Effect.tap(() => Effect.logInfo("codex plugin provider refresh finished", { reason })),
      Effect.ignoreCause({ log: true }),
      Effect.forkDetach,
      Effect.asVoid,
    );

  const readCachedPluginList = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const cached = yield* Ref.get(pluginListCacheRef);
    return isPluginListCacheEntryFresh(cached, nowMs) ? cached.value : null;
  });

  const writeCachedPluginList = (value: PluginListResponse) =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      yield* Ref.set(pluginListCacheRef, {
        expiresAtMs: nowMs + PLUGIN_LIST_CACHE_TTL_MS,
        value,
      });
    });

  const invalidatePluginListCache = Ref.set(pluginListCacheRef, null);

  const loadPluginList = Effect.gen(function* () {
    const bundledExtensionsRoot = yield* resolveBundledRoot().pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const cwds = buildPluginListCwds({
      workspaceCwd: config.cwd,
      bundledExtensionsRoot,
    });
    return yield* withClient("plugins.list", clientServices, (client) =>
      client
        .request("plugin/list", {
          cwds,
        })
        .pipe(
          Effect.map((response) => ({
            marketplaces: [BUILTIN_MARKETPLACE, ...response.marketplaces.map(normalizeMarketplace)],
            builtinPlugins: [...BUILTIN_PLUGINS],
            featuredPluginIds: [...(response.featuredPluginIds ?? [])],
            marketplaceLoadErrors: (response.marketplaceLoadErrors ?? []).map((error) => ({
              marketplacePath: error.marketplacePath,
              message: error.message,
            })),
          })),
        ),
    );
  });

  const list: CodexPluginServiceShape["list"] = () =>
    Effect.gen(function* () {
      const cached = yield* readCachedPluginList;
      if (cached) {
        return cached;
      }
      const response = yield* loadPluginList;
      yield* writeCachedPluginList(response);
      return response;
    }).pipe(
      Effect.catch((error: PluginServiceError) =>
        Effect.succeed({
          marketplaces: [BUILTIN_MARKETPLACE],
          builtinPlugins: [...BUILTIN_PLUGINS],
          featuredPluginIds: [],
          marketplaceLoadErrors: [
            {
              message: error.detail,
            },
          ],
        }),
      ),
    );

  const read: CodexPluginServiceShape["read"] = (input) => {
    const builtin = BUILTIN_PLUGINS.find((plugin) => plugin.name === input.pluginName);
    if (builtin) {
      return Effect.succeed({
        plugin: {
          summary: builtin,
          ...(builtin.description ? { description: builtin.description } : {}),
          marketplaceName: "T3 Builtins",
          marketplacePath: null,
          skills: [],
          apps: [],
          appTemplates: [],
          mcpServers: [],
          hooks: [],
        },
      });
    }
    return withClient("plugins.read", clientServices, (client) =>
      client
        .request("plugin/read", {
          pluginName: input.pluginName,
          marketplacePath: input.marketplacePath ?? null,
          remoteMarketplaceName: input.remoteMarketplaceName ?? null,
        })
        .pipe(Effect.map((response) => ({ plugin: normalizePluginDetail(response.plugin) }))),
    );
  };

  const install: CodexPluginServiceShape["install"] = (input) =>
    withClient("plugins.install", clientServices, (client) =>
      client
        .request("plugin/install", {
          pluginName: input.pluginName,
          marketplacePath: input.marketplacePath ?? null,
          remoteMarketplaceName: input.remoteMarketplaceName ?? null,
        })
        .pipe(
          Effect.tap(() => invalidatePluginListCache),
          Effect.tap(() => refreshCodexProvider("install")),
          Effect.map((response) => ({
            appsNeedingAuth: response.appsNeedingAuth.map(normalizeAppSummary),
            authPolicy: response.authPolicy,
          })),
        ),
    );

  const uninstall: CodexPluginServiceShape["uninstall"] = (input) =>
    withClient("plugins.uninstall", clientServices, (client) =>
      client
        .request("plugin/uninstall", {
          pluginId: input.pluginId,
        })
        .pipe(
          Effect.tap(() => invalidatePluginListCache),
          Effect.tap(() => refreshCodexProvider("uninstall")),
          Effect.as({ uninstalled: true }),
        ),
    );

  const addMarketplace: CodexPluginServiceShape["addMarketplace"] = (input) =>
    withClient("marketplace.add", clientServices, (client) =>
      client
        .request("marketplace/add", {
          source: input.source,
          refName: input.refName ?? null,
          sparsePaths: input.sparsePaths ?? null,
        })
        .pipe(
          Effect.tap(() => invalidatePluginListCache),
          Effect.tap(() => refreshCodexProvider("marketplace.add")),
          Effect.map(
            (response): MarketplaceAddResponse => ({
              alreadyAdded: response.alreadyAdded,
              installedRoot: response.installedRoot,
              marketplaceName: response.marketplaceName,
            }),
          ),
        ),
    );

  const upgradeMarketplace: CodexPluginServiceShape["upgradeMarketplace"] = (input) =>
    withClient("marketplace.upgrade", clientServices, (client) =>
      client
        .request("marketplace/upgrade", {
          marketplaceName: input.marketplaceName ?? null,
        })
        .pipe(
          Effect.tap(() => invalidatePluginListCache),
          Effect.tap(() => refreshCodexProvider("marketplace.upgrade")),
          Effect.map(
            (response): MarketplaceUpgradeResponse => ({
              selectedMarketplaces: [...response.selectedMarketplaces],
              errors: response.errors.map((error) => ({
                ...(error.marketplaceName ? { marketplaceName: error.marketplaceName } : {}),
                message: error.message,
              })),
            }),
          ),
        ),
    );

  return CodexPluginService.of({
    list,
    read,
    install,
    uninstall,
    addMarketplace,
    upgradeMarketplace,
  });
});

export const CodexPluginServiceLive = Layer.effect(CodexPluginService, make());
