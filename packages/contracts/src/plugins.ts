import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PluginAuthPolicy = Schema.Literals(["ON_INSTALL", "ON_USE"]);
export type PluginAuthPolicy = typeof PluginAuthPolicy.Type;

export const PluginInstallPolicy = Schema.Literals([
  "NOT_AVAILABLE",
  "AVAILABLE",
  "INSTALLED_BY_DEFAULT",
]);
export type PluginInstallPolicy = typeof PluginInstallPolicy.Type;

export const PluginAvailability = Schema.Literals(["AVAILABLE", "DISABLED_BY_ADMIN"]);
export type PluginAvailability = typeof PluginAvailability.Type;

export const PluginSource = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("codexLocal"),
    path: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("codexGit"),
    url: TrimmedNonEmptyString,
    path: Schema.optionalKey(TrimmedNonEmptyString),
    refName: Schema.optionalKey(TrimmedNonEmptyString),
    sha: Schema.optionalKey(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("codexRemote"),
  }),
  Schema.Struct({
    type: Schema.Literal("builtin"),
    builtinId: TrimmedNonEmptyString,
  }),
]);
export type PluginSource = typeof PluginSource.Type;

export const PluginLocation = Schema.Struct({
  pluginName: TrimmedNonEmptyString,
  marketplaceName: Schema.optionalKey(TrimmedNonEmptyString),
  marketplacePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  remoteMarketplaceName: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type PluginLocation = typeof PluginLocation.Type;

export const PluginSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
  authPolicy: PluginAuthPolicy,
  installPolicy: PluginInstallPolicy,
  availability: PluginAvailability,
  source: PluginSource,
  keywords: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  localVersion: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  location: PluginLocation,
});
export type PluginSummary = typeof PluginSummary.Type;

export const PluginMarketplace = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  path: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  plugins: Schema.Array(PluginSummary),
});
export type PluginMarketplace = typeof PluginMarketplace.Type;

export const PluginListResponse = Schema.Struct({
  marketplaces: Schema.Array(PluginMarketplace),
  builtinPlugins: Schema.Array(PluginSummary),
  featuredPluginIds: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  marketplaceLoadErrors: Schema.Array(
    Schema.Struct({
      marketplacePath: Schema.optionalKey(TrimmedNonEmptyString),
      message: Schema.String,
    }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type PluginListResponse = typeof PluginListResponse.Type;

export const PluginSkillSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  description: Schema.optionalKey(Schema.String),
});
export type PluginSkillSummary = typeof PluginSkillSummary.Type;

export const PluginAppSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  description: Schema.optionalKey(Schema.String),
});
export type PluginAppSummary = typeof PluginAppSummary.Type;

export const PluginHookSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  event: Schema.optionalKey(TrimmedNonEmptyString),
});
export type PluginHookSummary = typeof PluginHookSummary.Type;

export const PluginDetail = Schema.Struct({
  summary: PluginSummary,
  description: Schema.optionalKey(Schema.String),
  marketplaceName: TrimmedNonEmptyString,
  marketplacePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  skills: Schema.Array(PluginSkillSummary),
  apps: Schema.Array(PluginAppSummary),
  appTemplates: Schema.Array(PluginAppSummary),
  mcpServers: Schema.Array(Schema.String),
  hooks: Schema.Array(PluginHookSummary),
});
export type PluginDetail = typeof PluginDetail.Type;

export const PluginReadInput = Schema.Struct({
  pluginName: TrimmedNonEmptyString,
  marketplacePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  remoteMarketplaceName: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type PluginReadInput = typeof PluginReadInput.Type;

export const PluginReadResponse = Schema.Struct({
  plugin: PluginDetail,
});
export type PluginReadResponse = typeof PluginReadResponse.Type;

export const PluginInstallInput = PluginReadInput;
export type PluginInstallInput = typeof PluginInstallInput.Type;

export const PluginInstallResponse = Schema.Struct({
  appsNeedingAuth: Schema.Array(PluginAppSummary),
  authPolicy: PluginAuthPolicy,
});
export type PluginInstallResponse = typeof PluginInstallResponse.Type;

export const PluginUninstallInput = Schema.Struct({
  pluginId: TrimmedNonEmptyString,
});
export type PluginUninstallInput = typeof PluginUninstallInput.Type;

export const PluginUninstallResponse = Schema.Struct({
  uninstalled: Schema.Boolean,
});
export type PluginUninstallResponse = typeof PluginUninstallResponse.Type;

export const MarketplaceAddInput = Schema.Struct({
  source: TrimmedNonEmptyString,
  refName: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  sparsePaths: Schema.optionalKey(Schema.NullOr(Schema.Array(TrimmedNonEmptyString))),
});
export type MarketplaceAddInput = typeof MarketplaceAddInput.Type;

export const MarketplaceAddResponse = Schema.Struct({
  alreadyAdded: Schema.Boolean,
  installedRoot: TrimmedNonEmptyString,
  marketplaceName: TrimmedNonEmptyString,
});
export type MarketplaceAddResponse = typeof MarketplaceAddResponse.Type;

export const MarketplaceUpgradeInput = Schema.Struct({
  marketplaceName: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type MarketplaceUpgradeInput = typeof MarketplaceUpgradeInput.Type;

export const MarketplaceUpgradeResponse = Schema.Struct({
  selectedMarketplaces: Schema.Array(Schema.String),
  errors: Schema.Array(
    Schema.Struct({
      marketplaceName: Schema.optionalKey(Schema.String),
      message: Schema.String,
    }),
  ),
});
export type MarketplaceUpgradeResponse = typeof MarketplaceUpgradeResponse.Type;

export class PluginServiceError extends Schema.TaggedErrorClass<PluginServiceError>()(
  "PluginServiceError",
  {
    detail: Schema.String,
    kind: Schema.optionalKey(
      Schema.Literals(["providerUnavailable", "unsupported", "notFound", "internal"]),
    ),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
