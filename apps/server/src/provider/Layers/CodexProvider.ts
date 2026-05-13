import * as DateTime from "effect/DateTime";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Types from "effect/Types";
import { ChildProcessSpawner } from "effect/unstable/process";
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

import {
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeJwt,
} from "@t3tools/shared/commercialEngine";
import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import { scopedSafeTeardown } from "./scopedSafeTeardown.ts";
import packageJson from "../../../package.json" with { type: "json" };
import {
  resolveBundledEngineConfig,
  buildBundledSpawnArgs,
  buildSystemSpawnArgs,
  PROVIDER_DISPLAY_NAME,
} from "../BundledEngineConfig.ts";
const isCodexAppServerSpawnError = Schema.is(CodexErrors.CodexAppServerSpawnError);

const PROVIDER_PROBE_TIMEOUT_MS = 8_000;
const COMMERCIAL_MODEL_CATALOG_TIMEOUT_MS = 5_000;

class CommercialModelCatalogError extends Data.TaggedError("CommercialModelCatalogError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

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
  readonly skills: ReadonlyArray<ServerProviderSkill>;
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

const CommercialGatewayModel = Schema.Struct({
  id: Schema.String,
  display_name: Schema.optional(Schema.String),
});

const CommercialGatewayModelListResponse = Schema.Struct({
  data: Schema.Array(CommercialGatewayModel),
});

function commercialGatewayModelsUrl(environment: NodeJS.ProcessEnv): string {
  const baseUrl = resolveCommercialEngineGatewayBaseUrl(environment);
  return new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

const requestCommercialGatewayModels = Effect.fn("requestCommercialGatewayModels")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const token = resolveCommercialEngineIdeJwt(environment);
  const url = commercialGatewayModelsUrl(environment);
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        headers: {
          accept: "application/json",
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
  const decoded = yield* Schema.decodeUnknownEffect(CommercialGatewayModelListResponse)(
    payload,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new CommercialModelCatalogError({
          detail: `Model catalog returned invalid JSON: ${cause.message}`,
          cause,
        }),
    ),
  );
  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];
  for (const model of decoded.data) {
    const slug = model.id.trim();
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    const displayName = model.display_name?.trim();
    models.push({
      slug,
      name: displayName && displayName.length > 0 ? displayName : slug,
      isCustom: false,
      capabilities: null,
    });
  }
  return models;
});

const requestCommercialEngineModels = (environment: NodeJS.ProcessEnv) =>
  requestCommercialGatewayModels(environment).pipe(
    Effect.timeoutOption(Duration.millis(COMMERCIAL_MODEL_CATALOG_TIMEOUT_MS)),
    Effect.flatMap((models) =>
      Option.match(models, {
        onNone: () =>
          Effect.logWarning("commercial model catalog request timed out", {
            url: commercialGatewayModelsUrl(environment),
          }).pipe(Effect.as([] as ReadonlyArray<ServerProviderModel>)),
        onSome: (value) => Effect.succeed(value),
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("commercial model catalog request failed", {
        url: commercialGatewayModelsUrl(environment),
        detail: cause.detail,
      }).pipe(Effect.as([] as ReadonlyArray<ServerProviderModel>)),
    ),
  );

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

function parseCodexSkillsListResponse(
  response: CodexSchema.V2SkillsListResponse,
  cwd: string,
): ReadonlyArray<ServerProviderSkill> {
  const matchingEntry = response.data.find((entry) => entry.cwd === cwd);
  const skills = matchingEntry
    ? matchingEntry.skills
    : response.data.flatMap((entry) => entry.skills);

  return skills.map((skill) => {
    const shortDescription =
      skill.shortDescription ?? skill.interface?.shortDescription ?? undefined;

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

    return parsedSkill;
  });
}

export function buildCodexInitializeParams(): CodexSchema.V1InitializeParams {
  return {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}

// Wrapped with `scopedSafeTeardown("codex-probe")` rather than the usual
// `Effect.scoped` so that a defect from the `Layer.build` finalizer (e.g.
// `ChildProcess.kill` throwing because the `codex app-server` child exited
// early) cannot override a successful probe body. Without this guard the
// defect bubbles past `Effect.result` in `checkCodexProviderStatus`, dies
// `refreshOneSource`, and `providersRef` never receives the snapshot.
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

  // 检测捆绑引擎模式：使用内嵌的 codex-app-server 二进制 + 自定义配置
  const bundledConfig = resolveBundledEngineConfig(baseEnv);
  const effectiveBinaryPath = bundledConfig?.binaryPath ?? input.binaryPath;
  const spawnArgs = bundledConfig ? buildBundledSpawnArgs(bundledConfig) : buildSystemSpawnArgs();

  const clientContext = yield* Layer.build(
    CodexClient.layerCommand({
      command: effectiveBinaryPath,
      args: [...spawnArgs],
      cwd: input.cwd,
      env: {
        ...baseEnv,
        ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
        ...bundledConfig?.spawnEnvPatch,
      },
    }),
  );
  const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
    Effect.provide(clientContext),
  );

  const initialize = yield* client.request("initialize", {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  });
  yield* client.notify("initialized", undefined);

  // Extract the version string after the first '/' in userAgent, up to the next space or the end
  const versionMatch = initialize.userAgent.match(/\/([^\s]+)/);
  const version = versionMatch ? versionMatch[1] : undefined;

  const accountResponse = yield* client.request("account/read", {});
  if (!accountResponse.account && accountResponse.requiresOpenaiAuth) {
    return {
      account: accountResponse,
      rateLimits: null,
      version,
      models: appendCustomCodexModels([], input.customModels ?? []),
      skills: [],
    } satisfies CodexAppServerProviderSnapshot;
  }

  const [skillsResponse, models, rateLimits] = yield* Effect.all(
    [
      client.request("skills/list", {
        cwds: [input.cwd],
      }),
      requestCommercialEngineModels(baseEnv).pipe(
        Effect.map((models) => appendCustomCodexModels(models, input.customModels ?? [])),
      ),
      client.request("account/rateLimits/read", undefined).pipe(Effect.option),
    ],
    { concurrency: "unbounded" },
  );

  return {
    account: accountResponse,
    rateLimits: Option.getOrNull(rateLimits)?.rateLimits ?? null,
    version,
    models,
    skills: parseCodexSkillsListResponse(skillsResponse, input.cwd),
  } satisfies CodexAppServerProviderSnapshot;
}, scopedSafeTeardown("codex-probe"));

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
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Codex is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: getPresentation(environment),
      enabled: true,
      checkedAt,
      models,
      skills: [],
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
  },
): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProvider["auth"];
  readonly message?: string;
} {
  if (options?.bundledEngine) {
    if (options.hasCommercialToken) {
      return {
        status: "ready",
        auth: {
          status: "authenticated",
          label: "T3 Code account",
          ...(rateLimits ? { rateLimits } : {}),
        },
      };
    }
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "T3 Code is not signed in. Sign in to your account and try again.",
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
    ChildProcessSpawner.ChildProcessSpawner
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
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in T3 Code settings.",
      },
    });
  }

  const probeResult = yield* probe({
    binaryPath: codexSettings.binaryPath,
    homePath: codexSettings.homePath,
    cwd: process.cwd(),
    customModels: codexSettings.customModels,
    environment,
  }).pipe(Effect.timeoutOption(Duration.millis(PROVIDER_PROBE_TIMEOUT_MS)), Effect.result);

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
  });

  return buildServerProvider({
    presentation: getPresentation(environment),
    enabled: codexSettings.enabled,
    checkedAt,
    models: snapshot.models,
    skills: snapshot.skills,
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
