// @effect-diagnostics nodeBuiltinImport:off
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Types from "effect/Types";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Crypto from "node:crypto";
import { stat } from "node:fs/promises";
import nodePath from "node:path";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as CodexErrors from "effect-codex-app-server/errors";

import type {
  CodexSettings,
  ServerProvider,
  ServerProviderState,
  ServerProviderModel,
  ServerProviderSkill,
} from "@t3tools/contracts";
import { ServerSettingsError } from "@t3tools/contracts";

import { createModelCapabilities } from "@t3tools/shared/model";
import {
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeApiBaseUrlCandidates,
  resolveCommercialEngineIdeJwt,
} from "@t3tools/shared/commercialEngine";
import { parseCommercialGatewayModelListResponse } from "@t3tools/shared/commercialEngineModels";
import { buildCommercialUsageLimitSnapshot } from "@t3tools/shared/commercialUsage";
import { createTtlMemoryCache } from "@t3tools/shared/ttlMemoryCache";
import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import packageJson from "../../../package.json" with { type: "json" };
import {
  resolveBundledEngineConfig,
  buildBundledSpawnArgs,
  buildSystemSpawnArgs,
  buildCodexProcessEnv,
  PROVIDER_DISPLAY_NAME,
} from "../BundledEngineConfig.ts";
import { buildWindowsSandboxSnapshot } from "../windowsSandbox.ts";
const isCodexAppServerSpawnError = Schema.is(CodexErrors.CodexAppServerSpawnError);

const PROVIDER_PROBE_TIMEOUT_MS = 8_000;
const COMMERCIAL_MODEL_CATALOG_TIMEOUT_MS = 5_000;
const COMMERCIAL_ACCOUNT_BALANCE_TIMEOUT_MS = 5_000;
const COMMERCIAL_MODEL_CATALOG_CACHE_TTL_MS = 5 * 60_000;
const COMMERCIAL_ACCOUNT_USAGE_CACHE_TTL_MS = 15_000;
const COMMERCIAL_GATEWAY_CACHE_MAX_ENTRIES = 64;
const COMMERCIAL_CODEX_MODEL_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "推理",
      type: "select",
      options: [
        { id: "low", label: "低" },
        { id: "medium", label: "中" },
        { id: "high", label: "高", isDefault: true },
        { id: "xhigh", label: "超高" },
      ],
      currentValue: "high",
    },
  ],
});

class CommercialModelCatalogError extends Data.TaggedError("CommercialModelCatalogError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

function getPresentation(environment: NodeJS.ProcessEnv = process.env) {
  const isBundled = resolveBundledEngineConfig(environment) !== undefined;
  return {
    displayName: isBundled ? PROVIDER_DISPLAY_NAME : "Codex",
    showInteractionModeToggle: true,
  } as const;
}

export interface CodexAppServerProviderSnapshot {
  readonly account: CodexSchema.V2GetAccountResponse;
  readonly rateLimits: CodexSchema.V2GetAccountRateLimitsResponse["rateLimits"] | null;
  readonly version: string | undefined;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly modelCatalogError?: string | undefined;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly permissionProfiles?: NonNullable<ServerProvider["permissionProfiles"]>;
  readonly windowsSandboxReadiness?: CodexSchema.V2WindowsSandboxReadinessResponse["status"];
  readonly windowsSandboxError?: string | null;
}

function codexAccountAuthLabel(account: CodexSchema.V2GetAccountResponse["account"]) {
  if (!account) return undefined;
  if (account.type === "apiKey") return "OpenAI API Key";
  if (account.type === "amazonBedrock") return "Amazon Bedrock";
  if (account.type !== "chatgpt") return undefined;

  switch (account.planType) {
    case "free":
      return "ChatGPT Free Subscription";
    case "go":
      return "ChatGPT Go Subscription";
    case "plus":
      return "ChatGPT Plus Subscription";
    case "pro":
      return "ChatGPT Pro 20x Subscription";
    case "prolite":
      return "ChatGPT Pro 5x Subscription";
    case "team":
      return "ChatGPT Team Subscription";
    case "self_serve_business_usage_based":
    case "business":
      return "ChatGPT Business Subscription";
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "ChatGPT Enterprise Subscription";
    case "edu":
      return "ChatGPT Edu Subscription";
    case "unknown":
      return "ChatGPT Subscription";
    default:
      account.planType satisfies never;
      return undefined;
  }
}

function codexAccountEmail(account: CodexSchema.V2GetAccountResponse["account"]) {
  if (!account || account.type !== "chatgpt") return undefined;
  return account.email;
}

const CommercialGatewayAccountResponse = Schema.Struct({
  data: Schema.Struct({
    user: Schema.optional(
      Schema.Struct({
        balance: Schema.Number,
      }),
    ),
    balance: Schema.optional(Schema.Number),
  }),
});

const CommercialGatewayUsageResponse = Schema.Struct({
  data: Schema.Struct({
    total_tokens: Schema.optional(Schema.Number),
    today_tokens: Schema.optional(Schema.Number),
    total_actual_cost: Schema.optional(Schema.Number),
    today_actual_cost: Schema.optional(Schema.Number),
    plan: Schema.optional(Schema.String),
    plan_type: Schema.optional(Schema.String),
    current_window: Schema.optional(Schema.Unknown),
    current_window_units: Schema.optional(Schema.Number),
    current_window_limit: Schema.optional(Schema.Number),
    current_window_resets_at: Schema.optional(Schema.String),
    weekly_window: Schema.optional(Schema.Unknown),
    weekly_units: Schema.optional(Schema.Number),
    weekly_limit: Schema.optional(Schema.Number),
    weekly_resets_at: Schema.optional(Schema.String),
  }),
});

function commercialGatewayModelsUrl(environment: NodeJS.ProcessEnv): string {
  const baseUrl = resolveCommercialEngineGatewayBaseUrl(environment);
  return new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function commercialGatewayAccountUrl(environment: NodeJS.ProcessEnv): string {
  const baseUrl = resolveCommercialEngineGatewayBaseUrl(environment);
  return new URL(
    "/api/v1/auth/me",
    resolveCommercialEngineIdeApiBaseUrlCandidates(baseUrl)[0],
  ).toString();
}

function commercialGatewayUsageUrl(environment: NodeJS.ProcessEnv): string {
  const baseUrl = resolveCommercialEngineGatewayBaseUrl(environment);
  return new URL(
    "/ide/api/usage",
    resolveCommercialEngineIdeApiBaseUrlCandidates(baseUrl)[0],
  ).toString();
}

function formatCommercialCreditBalance(balance: number): string {
  const normalized = Number.isFinite(balance) ? balance : 0;
  return `$${normalized.toFixed(8).replace(/\.?0+$/, "")}`;
}

type CommercialUsageSnapshot = NonNullable<
  NonNullable<ServerProvider["auth"]["rateLimits"]>["usage"]
>;

function mergeCommercialBalanceIntoRateLimits(
  rateLimits: CodexAppServerProviderSnapshot["rateLimits"],
  balance: number | null,
  usage: CommercialUsageSnapshot | null,
): CodexAppServerProviderSnapshot["rateLimits"] {
  if (balance === null && usage === null) {
    return rateLimits;
  }

  const credits = rateLimits?.credits ?? {};
  return {
    ...(rateLimits ?? {}),
    ...(balance !== null
      ? {
          credits: {
            ...credits,
            balance: formatCommercialCreditBalance(balance),
            hasCredits: balance > 0,
            unlimited: false,
          },
        }
      : {}),
    ...(usage ? { usage } : {}),
  };
}

type CommercialGatewayCacheKind = "models" | "balance" | "usage";

const commercialGatewayResponseCache = createTtlMemoryCache({
  maxEntries: COMMERCIAL_GATEWAY_CACHE_MAX_ENTRIES,
});

function commercialGatewayTokenFingerprint(token: string | undefined): string {
  if (!token) return "anonymous";
  return Crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function commercialGatewayCacheKey(input: {
  readonly kind: CommercialGatewayCacheKind;
  readonly url: string;
  readonly token: string | undefined;
}): string {
  return [
    input.kind,
    input.url,
    commercialGatewayTokenFingerprint(input.token),
  ].join("\u0000");
}

function cacheCommercialGatewayRequest<A>(input: {
  readonly kind: CommercialGatewayCacheKind;
  readonly url: string;
  readonly token: string | undefined;
  readonly ttlMs: number;
  readonly request: Effect.Effect<A, CommercialModelCatalogError>;
}): Effect.Effect<A, CommercialModelCatalogError> {
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const key = commercialGatewayCacheKey(input);
    const cached = commercialGatewayResponseCache.read<A>(key, nowMs);

    if (cached !== undefined) {
      return cached;
    }

    const value = yield* input.request;
    commercialGatewayResponseCache.write(key, value, input.ttlMs, nowMs);
    return value;
  });
}

function requestCommercialGatewayModels(
  environment: NodeJS.ProcessEnv,
): Effect.Effect<ReadonlyArray<ServerProviderModel>, CommercialModelCatalogError> {
  return Effect.gen(function* () {
    const token = resolveCommercialEngineIdeJwt(environment);
    const url = commercialGatewayModelsUrl(environment);
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          headers: {
            accept: "application/json",
            "cache-control": "no-cache",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal,
        }),
      catch: (cause) =>
        new CommercialModelCatalogError({
          detail: "Failed to request model catalog.",
          cause,
        }),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "",
      }).pipe(Effect.orElseSucceed(() => ""));
      return yield* new CommercialModelCatalogError({
        detail:
          body.trim().length > 0
            ? `Model catalog returned HTTP ${response.status}: ${body.trim()}`
            : `Model catalog returned HTTP ${response.status}.`,
      });
    }

    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new CommercialModelCatalogError({
          detail: "Model catalog returned invalid JSON.",
          cause,
        }),
    });
    const decoded = parseCommercialGatewayModelListResponse(payload);
    if (!decoded) {
      return yield* new CommercialModelCatalogError({
        detail: "Model catalog returned invalid JSON: data must be an array.",
      });
    }

    const models: ServerProviderModel[] = [];
    for (const model of decoded) {
      models.push({
        slug: model.id,
        name: model.name,
        ...(model.provider !== "unknown" ? { subProvider: model.provider } : {}),
        isCustom: false,
        capabilities: COMMERCIAL_CODEX_MODEL_CAPABILITIES,
      });
    }
    return models;
  });
}

function requestCommercialGatewayBalance(
  environment: NodeJS.ProcessEnv,
): Effect.Effect<number | null, CommercialModelCatalogError> {
  return Effect.gen(function* () {
    const token = resolveCommercialEngineIdeJwt(environment);
    if (!token) {
      return null;
    }

    const url = commercialGatewayAccountUrl(environment);
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "cache-control": "no-cache",
          },
          signal,
        }),
      catch: (cause) =>
        new CommercialModelCatalogError({
          detail: "Failed to request account balance.",
          cause,
        }),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "",
      }).pipe(Effect.orElseSucceed(() => ""));
      return yield* new CommercialModelCatalogError({
        detail:
          body.trim().length > 0
            ? `Account balance returned HTTP ${response.status}: ${body.trim()}`
            : `Account balance returned HTTP ${response.status}.`,
      });
    }

    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new CommercialModelCatalogError({
          detail: "Account balance returned invalid JSON.",
          cause,
        }),
    });
    const decoded = yield* Schema.decodeUnknownEffect(
      CommercialGatewayAccountResponse,
    )(payload).pipe(
      Effect.mapError(
        (cause) =>
          new CommercialModelCatalogError({
            detail: `Account balance returned invalid JSON: ${cause.message}`,
            cause,
          }),
      ),
    );
    return decoded.data.user?.balance ?? decoded.data.balance ?? null;
  });
}

function requestCommercialGatewayUsage(
  environment: NodeJS.ProcessEnv,
): Effect.Effect<CommercialUsageSnapshot | null, CommercialModelCatalogError> {
  return Effect.gen(function* () {
    const token = resolveCommercialEngineIdeJwt(environment);
    if (!token) {
      return null;
    }

    const url = commercialGatewayUsageUrl(environment);
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "cache-control": "no-cache",
          },
          signal,
        }),
      catch: (cause) =>
        new CommercialModelCatalogError({
          detail: "Failed to request account usage.",
          cause,
        }),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "",
      }).pipe(Effect.orElseSucceed(() => ""));
      return yield* new CommercialModelCatalogError({
        detail:
          body.trim().length > 0
            ? `Account usage returned HTTP ${response.status}: ${body.trim()}`
            : `Account usage returned HTTP ${response.status}.`,
      });
    }

    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new CommercialModelCatalogError({
          detail: "Account usage returned invalid JSON.",
          cause,
        }),
    });
    const decoded = yield* Schema.decodeUnknownEffect(CommercialGatewayUsageResponse)(payload).pipe(
      Effect.mapError(
        (cause) =>
          new CommercialModelCatalogError({
            detail: `Account usage returned invalid JSON: ${cause.message}`,
            cause,
          }),
      ),
    );
    return {
      ...buildCommercialUsageLimitSnapshot(payload),
      totalTokens: decoded.data.total_tokens ?? 0,
      ...(decoded.data.today_tokens !== undefined
        ? { todayTokens: decoded.data.today_tokens }
        : {}),
      ...(decoded.data.total_actual_cost !== undefined
        ? { totalActualCost: decoded.data.total_actual_cost }
        : {}),
      ...(decoded.data.today_actual_cost !== undefined
        ? { todayActualCost: decoded.data.today_actual_cost }
        : {}),
    } satisfies CommercialUsageSnapshot;
  });
}

const requestCommercialEngineModelCatalog = (environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const token = resolveCommercialEngineIdeJwt(environment);
    const url = commercialGatewayModelsUrl(environment);
    if (!token) {
      return {
        models: [] as ReadonlyArray<ServerProviderModel>,
        error: "Model gateway credentials are missing.",
      };
    }

    const result = yield* Effect.result(
      cacheCommercialGatewayRequest({
        kind: "models",
        url,
        token,
        ttlMs: COMMERCIAL_MODEL_CATALOG_CACHE_TTL_MS,
        request: requestCommercialGatewayModels(environment),
      }).pipe(Effect.timeoutOption(Duration.millis(COMMERCIAL_MODEL_CATALOG_TIMEOUT_MS))),
    );

    if (Result.isFailure(result)) {
      const detail = result.failure.detail;
      yield* Effect.logWarning("commercial model catalog request failed", { url, detail });
      return {
        models: [] as ReadonlyArray<ServerProviderModel>,
        error: detail,
      };
    }

    if (Option.isNone(result.success)) {
      yield* Effect.logWarning("commercial model catalog request timed out", { url });
      return {
        models: [] as ReadonlyArray<ServerProviderModel>,
        error: "Model catalog request timed out.",
      };
    }

    return {
      models: result.success.value,
      error: undefined,
    };
  });

const requestCommercialEngineBalance = (environment: NodeJS.ProcessEnv) => {
  const token = resolveCommercialEngineIdeJwt(environment);
  return token
    ? cacheCommercialGatewayRequest({
        kind: "balance",
        url: commercialGatewayAccountUrl(environment),
        token,
        ttlMs: COMMERCIAL_ACCOUNT_USAGE_CACHE_TTL_MS,
        request: requestCommercialGatewayBalance(environment),
      }).pipe(
        Effect.timeoutOption(Duration.millis(COMMERCIAL_ACCOUNT_BALANCE_TIMEOUT_MS)),
        Effect.flatMap((balance) =>
          Option.match(balance, {
            onNone: () =>
              Effect.logWarning("commercial account balance request timed out", {
                url: commercialGatewayAccountUrl(environment),
              }).pipe(Effect.as(null)),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.catch((cause) =>
          Effect.logWarning("commercial account balance request failed", {
            url: commercialGatewayAccountUrl(environment),
            detail: cause.detail,
          }).pipe(Effect.as(null)),
        ),
      )
    : Effect.succeed(null);
};

const requestCommercialEngineUsage = (environment: NodeJS.ProcessEnv) => {
  const token = resolveCommercialEngineIdeJwt(environment);
  return token
    ? cacheCommercialGatewayRequest({
        kind: "usage",
        url: commercialGatewayUsageUrl(environment),
        token,
        ttlMs: COMMERCIAL_ACCOUNT_USAGE_CACHE_TTL_MS,
        request: requestCommercialGatewayUsage(environment),
      }).pipe(
        Effect.timeoutOption(Duration.millis(COMMERCIAL_ACCOUNT_BALANCE_TIMEOUT_MS)),
        Effect.flatMap((usage) =>
          Option.match(usage, {
            onNone: () =>
              Effect.logWarning("commercial account usage request timed out", {
                url: commercialGatewayUsageUrl(environment),
              }).pipe(Effect.as(null)),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.catch((cause) =>
          Effect.logWarning("commercial account usage request failed", {
            url: commercialGatewayUsageUrl(environment),
            detail: cause.detail,
          }).pipe(Effect.as(null)),
        ),
      )
    : Effect.succeed(null);
};

function appendCustomCodexModels(
  models: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  if (customModels.length === 0) {
    return models;
  }

  const seen = new Set(models.map((model) => model.slug));
  const fallbackCapabilities = models.find((model) => model.capabilities)?.capabilities ?? null;
  const customEntries: ServerProviderModel[] = [];
  for (const rawModel of customModels) {
    const slug = rawModel.trim();
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    customEntries.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: fallbackCapabilities,
    });
  }
  return customEntries.length === 0 ? models : [...models, ...customEntries];
}

function resolveSkillInstallTimestampMs(
  skillPath: string,
): Effect.Effect<number | undefined> {
  return Effect.gen(function* () {
    const statPath = nodePath.basename(skillPath).toLowerCase() === "skill.md"
      ? nodePath.dirname(skillPath)
      : skillPath;
    const entryStat = yield* Effect.tryPromise({
      try: () => stat(statPath),
      catch: () => undefined,
    });
    return entryStat.birthtime?.getTime() ?? entryStat.mtime?.getTime();
  }).pipe(Effect.orElseSucceed(() => undefined));
}

function compareCodexSkillsByInstallTime(
  a: ServerProviderSkill,
  b: ServerProviderSkill,
): number {
  const aTime = a.installedAtMs ?? Number.NEGATIVE_INFINITY;
  const bTime = b.installedAtMs ?? Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) {
    return bTime - aTime;
  }
  const aName = (a.displayName ?? a.name).toLowerCase();
  const bName = (b.displayName ?? b.name).toLowerCase();
  return aName.localeCompare(bName);
}

function parseCodexSkillsListResponse(
  response: CodexSchema.V2SkillsListResponse,
  cwd: string,
): Effect.Effect<ReadonlyArray<ServerProviderSkill>> {
  const matchingEntry = response.data.find((entry) => entry.cwd === cwd);
  const skills = matchingEntry
    ? matchingEntry.skills
    : response.data.flatMap((entry) => entry.skills);

  return Effect.forEach(
    skills,
    (skill) =>
      Effect.gen(function* () {
        const shortDescription =
          skill.shortDescription ?? skill.interface?.shortDescription ?? undefined;
        const installedAtMs = yield* resolveSkillInstallTimestampMs(skill.path);

        const parsedSkill: Types.Mutable<ServerProviderSkill> = {
          name: skill.name,
          path: skill.path,
          enabled: skill.enabled,
        };

        if (skill.description) {
          parsedSkill.description = skill.description;
        }
        if (skill.scope) {
          parsedSkill.scope = skill.scope;
        }
        if (skill.interface?.displayName) {
          parsedSkill.displayName = skill.interface.displayName;
        }
        if (shortDescription) {
          parsedSkill.shortDescription = shortDescription;
        }
        if (installedAtMs !== undefined) {
          parsedSkill.installedAtMs = installedAtMs;
        }

        return parsedSkill;
      }),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((parsedSkills) => [...parsedSkills].sort(compareCodexSkillsByInstallTime)));
}

export function buildCodexInitializeParams(): CodexSchema.V1InitializeParams {
  return {
    clientInfo: {
      name: "Bahew_desktop",
      title: "Bahew Desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}

export function enableCodexPluginExperimentalFeatures(
  client: CodexClient.CodexAppServerClientShape,
  context: { readonly operation: string },
): Effect.Effect<void, never> {
  return client
    .request("experimentalFeature/enablement/set", {
      enablement: {
        plugins: true,
        apps: true,
      },
    })
    .pipe(
      Effect.asVoid,
      Effect.catch((cause: unknown) =>
        Effect.logWarning("codex plugin experimental features unavailable", {
          operation: context.operation,
          cause: String(cause),
        }),
      ),
    );
}

const probeCodexAppServerProvider = Effect.fn("probeCodexAppServerProvider")(function* (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly cwd: string;
  readonly customModels?: ReadonlyArray<string>;
  readonly environment?: NodeJS.ProcessEnv;
}) {
  // `~` is not shell-expanded when env vars are set via `child_process.spawn`,
  // so `CODEX_HOME=~/.codex_work` would reach codex verbatim and trip
  // "CODEX_HOME points to '~/.codex_work', but that path does not exist".
  // Expand here for parity with `CodexTextGeneration`/`CodexSessionRuntime`.
  const resolvedHomePath = input.homePath ? expandHomePath(input.homePath) : undefined;
  const baseEnv = input.environment ?? process.env;

  // Detect bundled engine mode and use the embedded codex-app-server binary with custom config.
  const bundledConfig = resolveBundledEngineConfig(baseEnv);
  const effectiveBinaryPath = bundledConfig?.binaryPath ?? input.binaryPath;
  const spawnArgs = bundledConfig ? buildBundledSpawnArgs(bundledConfig) : buildSystemSpawnArgs();

  const clientContext = yield* Layer.build(
    CodexClient.layerCommand({
      command: effectiveBinaryPath,
      args: [...spawnArgs],
      cwd: input.cwd,
      env: buildCodexProcessEnv({
        baseEnv,
        resolvedHomePath,
        bundledConfig,
      }),
    }),
  );
  const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
    Effect.provide(clientContext),
  );

  const initialize = yield* client.request("initialize", buildCodexInitializeParams());
  yield* client.notify("initialized", undefined);
  yield* enableCodexPluginExperimentalFeatures(client, { operation: "provider.probe" });
  const windowsSandboxReadiness = yield* client
    .request("windowsSandbox/readiness", undefined)
    .pipe(
      Effect.map((response) => ({
        status: response.status,
        error: null as string | null,
      })),
      Effect.catch((cause) =>
        Effect.succeed({
          status: undefined,
          error: cause.message ?? String(cause),
        }),
      ),
    );

  // Extract the version string after the first '/' in userAgent, up to the next space or the end
  const versionMatch = initialize.userAgent.match(/\/([^\s]+)/);
  const version = versionMatch ? versionMatch[1] : undefined;

  const accountResponse = yield* client.request("account/read", {});
  const permissionProfilesResponse = yield* client
    .request("permissionProfile/list", { cwd: input.cwd })
    .pipe(Effect.option);
  const permissionProfiles = parsePermissionProfiles(Option.getOrNull(permissionProfilesResponse));
  if (!accountResponse.account && accountResponse.requiresOpenaiAuth) {
    return {
      account: accountResponse,
      rateLimits: null,
      version,
      models: appendCustomCodexModels([], input.customModels ?? []),
      skills: [],
      permissionProfiles,
      ...(windowsSandboxReadiness.status !== undefined
        ? { windowsSandboxReadiness: windowsSandboxReadiness.status }
        : {}),
      windowsSandboxError: windowsSandboxReadiness.error,
    } satisfies CodexAppServerProviderSnapshot;
  }

  const [skillsResponse, models, rateLimits, commercialBalance, commercialUsage] =
    yield* Effect.all(
      [
        client.request("skills/list", {
          cwds: [input.cwd],
        }),
        requestCommercialEngineModelCatalog(baseEnv).pipe(
          Effect.map((catalog) => ({
            models: appendCustomCodexModels(catalog.models, input.customModels ?? []),
            error: catalog.error,
          })),
        ),
        client.request("account/rateLimits/read", undefined).pipe(Effect.option),
        requestCommercialEngineBalance(baseEnv),
        requestCommercialEngineUsage(baseEnv),
      ],
      { concurrency: "unbounded" },
    );
  const resolvedRateLimits = mergeCommercialBalanceIntoRateLimits(
    Option.getOrNull(rateLimits)?.rateLimits ?? null,
    commercialBalance,
    commercialUsage,
  );

  const skills = yield* parseCodexSkillsListResponse(skillsResponse, input.cwd);

  return {
    account: accountResponse,
    rateLimits: resolvedRateLimits,
    version,
    models: models.models,
    ...(models.error ? { modelCatalogError: models.error } : {}),
    skills,
    permissionProfiles,
    ...(windowsSandboxReadiness.status !== undefined
      ? { windowsSandboxReadiness: windowsSandboxReadiness.status }
      : {}),
    windowsSandboxError: windowsSandboxReadiness.error,
  } satisfies CodexAppServerProviderSnapshot;
});

const emptyCodexModelsFromSettings = (codexSettings: CodexSettings): ServerProvider["models"] =>
  codexSettings.customModels
    .map((model) => model.trim())
    .filter((model, index, models) => model.length > 0 && models.indexOf(model) === index)
    .map((model) => ({
      slug: model,
      name: model,
      isCustom: true,
      capabilities: null,
    }));

const parsePermissionProfiles = (
  response: CodexSchema.V2PermissionProfileListResponse | null,
): NonNullable<ServerProvider["permissionProfiles"]> =>
  (response?.data ?? [])
    .map((profile) => ({
      id: profile.id.trim(),
      description: profile.description?.trim() || null,
    }))
    .filter((profile) => profile.id.length > 0);

const makePendingCodexProvider = (
  codexSettings: CodexSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = emptyCodexModelsFromSettings(codexSettings);

    if (!codexSettings.enabled) {
      return buildServerProvider({
        presentation: getPresentation(environment),
        enabled: false,
        checkedAt,
        models,
        skills: [],
        permissionProfiles: [],
        windowsSandbox: buildWindowsSandboxSnapshot({
          binaryPath: codexSettings.binaryPath,
          environment,
          updatedAt: checkedAt,
        }),
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Codex is disabled in Bahew settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: getPresentation(environment),
      enabled: true,
      checkedAt,
      models,
      skills: [],
      permissionProfiles: [],
      windowsSandbox: buildWindowsSandboxSnapshot({
        binaryPath: codexSettings.binaryPath,
        environment,
        updatedAt: checkedAt,
      }),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex provider status has not been checked in this session yet.",
      },
    });
  });

function accountProbeStatus(
  account: CodexAppServerProviderSnapshot["account"],
  rateLimits: CodexAppServerProviderSnapshot["rateLimits"],
  options?: {
    readonly bundledEngine: boolean;
    readonly hasCommercialToken: boolean;
    readonly modelCatalogError?: string | undefined;
  },
): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProvider["auth"];
  readonly message?: string;
} {
  if (options?.bundledEngine) {
    if (options.hasCommercialToken) {
      if (options.modelCatalogError) {
        return {
          status: "warning",
          auth: {
            status: "authenticated",
            label: "Bahew account",
            ...(rateLimits ? { rateLimits } : {}),
          },
          message: `Model gateway catalog unavailable: ${options.modelCatalogError}`,
        };
      }
      return {
        status: "ready",
        auth: {
          status: "authenticated",
          label: "Bahew account",
          ...(rateLimits ? { rateLimits } : {}),
        },
      };
    }
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Bahew is not signed in. Sign in to your account and try again.",
    };
  }

  const authLabel = codexAccountAuthLabel(account.account);
  const authEmail = codexAccountEmail(account.account);
  const auth = {
    status: account.account ? ("authenticated" as const) : ("unknown" as const),
    ...(account.account?.type ? { type: account.account?.type } : {}),
    ...(authLabel ? { label: authLabel } : {}),
    ...(authEmail ? { email: authEmail } : {}),
    ...(rateLimits ? { rateLimits } : {}),
  } satisfies ServerProvider["auth"];

  if (account.account) {
    return { status: "ready", auth };
  }

  if (account.requiresOpenaiAuth) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  return { status: "ready", auth };
}

export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  codexSettings: CodexSettings,
  probe: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
    readonly cwd: string;
    readonly customModels: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<
    CodexAppServerProviderSnapshot,
    CodexErrors.CodexAppServerError,
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  > = probeCodexAppServerProvider,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const emptyModels = emptyCodexModelsFromSettings(codexSettings);

  if (!codexSettings.enabled) {
    return buildServerProvider({
      presentation: getPresentation(environment),
      enabled: false,
      checkedAt,
      models: emptyModels,
      skills: [],
      permissionProfiles: [],
      windowsSandbox: buildWindowsSandboxSnapshot({
        binaryPath: codexSettings.binaryPath,
        environment,
        updatedAt: checkedAt,
      }),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in Bahew settings.",
      },
    });
  }

  const probeResult = yield* probe({
    binaryPath: codexSettings.binaryPath,
    homePath: codexSettings.homePath,
    cwd: process.cwd(),
    customModels: codexSettings.customModels,
    environment,
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(Duration.millis(AUTH_PROBE_TIMEOUT_MS)),
    Effect.result,
  );

  if (Result.isFailure(probeResult)) {
    const error = probeResult.failure;
    const installed = !isCodexAppServerSpawnError(error);
    const isBundled = resolveBundledEngineConfig(environment) !== undefined;
    return buildServerProvider({
      presentation: getPresentation(environment),
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      permissionProfiles: [],
      windowsSandbox: buildWindowsSandboxSnapshot({
        binaryPath: codexSettings.binaryPath,
        environment,
        updatedAt: checkedAt,
        lastError: error.message,
      }),
      probe: {
        installed,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: installed
          ? `Codex app-server provider probe failed: ${error.message}.`
          : isBundled
            ? "Bundled AI engine binary is missing or inaccessible."
            : "Codex CLI (`codex`) is not installed or not on PATH.",
      },
    });
  }

  if (Option.isNone(probeResult.success)) {
    return buildServerProvider({
      presentation: getPresentation(environment),
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      permissionProfiles: [],
      windowsSandbox: buildWindowsSandboxSnapshot({
        binaryPath: codexSettings.binaryPath,
        environment,
        updatedAt: checkedAt,
        lastError: "Timed out while checking Codex app-server provider status.",
      }),
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Timed out while checking Codex app-server provider status.",
      },
    });
  }

  const snapshot = probeResult.success.value;
  const bundledEngine = resolveBundledEngineConfig(environment) !== undefined;
  const accountStatus = accountProbeStatus(snapshot.account, snapshot.rateLimits, {
    bundledEngine,
    hasCommercialToken: Boolean(resolveCommercialEngineIdeJwt(environment)),
    modelCatalogError: snapshot.modelCatalogError,
  });

  return buildServerProvider({
    presentation: getPresentation(environment),
    enabled: codexSettings.enabled,
    checkedAt,
    models: snapshot.models,
    skills: snapshot.skills,
    ...(snapshot.permissionProfiles ? { permissionProfiles: snapshot.permissionProfiles } : {}),
    windowsSandbox: buildWindowsSandboxSnapshot({
      binaryPath: codexSettings.binaryPath,
      environment,
      updatedAt: checkedAt,
      ...(snapshot.windowsSandboxReadiness !== undefined
        ? { readiness: snapshot.windowsSandboxReadiness }
        : {}),
      ...(snapshot.windowsSandboxError !== undefined
        ? { lastError: snapshot.windowsSandboxError }
        : {}),
    }),
    probe: {
      installed: true,
      version: snapshot.version ?? null,
      status: accountStatus.status,
      auth: accountStatus.auth,
      ...(accountStatus.message ? { message: accountStatus.message } : {}),
    },
  });
});

// NOTE: the singleton `CodexProviderLive` Layer has been removed as part of
// the per-instance-driver refactor. `CodexDriver.create()` builds a managed
// snapshot per instance (each with its own `CodexSettings`) and hands the
// resulting `ServerProviderShape` back as `ProviderInstance.snapshot`.
//
// The `makePendingCodexProvider` and `checkCodexProviderStatus` helpers are
// re-exported for use by `CodexDriver`.
export { makePendingCodexProvider };
