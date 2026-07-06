/**
 * Bundled engine configuration and detection.
 *
 * When `MYIDE_ENGINE_PATH` points to a packaged engine binary, the server uses
 * that binary instead of a `codex` CLI discovered on PATH. Commercial model
 * routing is injected through process environment and generated config, while
 * real provider keys stay outside the desktop client.
 *
 * @module provider/BundledEngineConfig
 */

import {
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME,
  COMMERCIAL_ENGINE_PROVIDER_ID,
  COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY,
  COMMERCIAL_ENGINE_WIRE_API,
  COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV,
  buildCommercialEngineProcessEnv,
  generateCommercialEngineTomlConfig,
  getCommercialEngineEnvVar,
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeJwt,
  resolveCommercialEngineOpenAiBaseUrl,
} from "@t3tools/shared/commercialEngine";

/** Absolute packaged engine binary path injected by the Electron main process. */
const ENV_ENGINE_PATH = "MYIDE_ENGINE_PATH";

/** Isolated CODEX_HOME injected by the Electron main process. */
const ENV_ENGINE_HOME = "MYIDE_ENGINE_HOME";

/** IDE JWT issued by the commercial login flow and used as a gateway bearer token. */
const ENV_IDE_JWT = COMMERCIAL_ENGINE_IDE_JWT_ENV;

export const PROVIDER_DISPLAY_NAME = COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME;

export interface BundledEngineResolvedConfig {
  /** Absolute packaged engine binary path. */
  readonly binaryPath: string;

  /** Spawn arguments for the packaged binary. */
  readonly spawnArgs: ReadonlyArray<string>;

  /** Environment patch for the packaged engine process. */
  readonly spawnEnvPatch: Readonly<Record<string, string>>;

  /** Isolated CODEX_HOME path. */
  readonly engineHome: string;
}

/**
 * Resolve packaged engine configuration.
 *
 * This intentionally does not touch the filesystem. Executability is validated
 * by the child process spawner at launch time.
 */
export function resolveBundledEngineConfig(
  env: NodeJS.ProcessEnv = process.env,
): BundledEngineResolvedConfig | undefined {
  const binaryPath = getCommercialEngineEnvVar(env, ENV_ENGINE_PATH);
  if (!binaryPath || binaryPath.trim().length === 0) {
    return undefined;
  }

  // A bare command name still means "discover codex from PATH", not packaged mode.
  if (!binaryPath.includes("/") && !binaryPath.includes("\\")) {
    return undefined;
  }

  const gatewayBaseUrl = resolveCommercialEngineGatewayBaseUrl(env);
  const openAiBaseUrl = resolveCommercialEngineOpenAiBaseUrl(gatewayBaseUrl);
  const ideJwt = resolveCommercialEngineIdeJwt(env);
  const engineHome = getCommercialEngineEnvVar(env, ENV_ENGINE_HOME) || "";
  const configFlags: string[] = [];
  const spawnEnvPatch: Record<string, string> = {
    CODEX_MODEL_PROVIDER: COMMERCIAL_ENGINE_PROVIDER_ID,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_NAME`]:
      PROVIDER_DISPLAY_NAME,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_BASE_URL`]:
      openAiBaseUrl,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_WIRE_API`]:
      COMMERCIAL_ENGINE_WIRE_API,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_ENV_KEY`]: ENV_IDE_JWT,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_REQUIRES_OPENAI_AUTH`]:
      "false",
    CODEX_SHELL_ENVIRONMENT_POLICY_INCLUDE_ONLY: JSON.stringify([
      ...COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY,
    ]),
    CODEX_DISABLE_TELEMETRY: "true",
    CODEX_FEATURES_IMAGEGENEXT: "true",
    // Route built-in OpenAI provider traffic through the commercial gateway.
    CODEX_OPENAI_BASE_URL: openAiBaseUrl,
    CODEX_CHATGPT_BASE_URL: openAiBaseUrl,
    CODEX_MODEL_PROVIDERS_OPENAI_BASE_URL: openAiBaseUrl,
    CODEX_MODEL_PROVIDERS_OPENAI_REQUIRES_OPENAI_AUTH: "false",
    CODEX_MODEL_PROVIDERS_OPENAI_ENV_KEY: ENV_IDE_JWT,
    OPENAI_BASE_URL: openAiBaseUrl,
  };

  if (ideJwt) {
    spawnEnvPatch[ENV_IDE_JWT] = ideJwt;
  }
  if (engineHome) {
    spawnEnvPatch.CODEX_HOME = engineHome;
  }
  const windowsSandboxMode = getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV);
  if (windowsSandboxMode) {
    spawnEnvPatch[COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV] = windowsSandboxMode;
  }

  return {
    binaryPath,
    spawnArgs: configFlags,
    spawnEnvPatch,
    engineHome,
  };
}

/**
 * Generate TOML config for settings that should not be represented only as
 * underscored environment variables.
 */
export function generateBundledTomlConfig(env: NodeJS.ProcessEnv = process.env): string {
  return generateCommercialEngineTomlConfig(env);
}

/** Build spawn arguments for the packaged app-server binary. */
export function buildBundledSpawnArgs(config: BundledEngineResolvedConfig): ReadonlyArray<string> {
  return config.spawnArgs;
}

/** Build spawn arguments for a system `codex` CLI. */
export function buildSystemSpawnArgs(): ReadonlyArray<string> {
  return ["app-server"];
}

/** Build the Codex process environment with CODEX_HOME and packaged-engine patches. */
export function buildCodexProcessEnv(input: {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly resolvedHomePath: string | undefined;
  readonly bundledConfig: BundledEngineResolvedConfig | undefined;
}): Record<string, string> {
  const dirname = (value: string): string | undefined => {
    const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
    return index > 0 ? value.slice(0, index) : undefined;
  };
  const engineBinDir =
    input.bundledConfig?.binaryPath &&
    (input.bundledConfig.binaryPath.includes("/") || input.bundledConfig.binaryPath.includes("\\"))
      ? dirname(input.bundledConfig.binaryPath)
      : undefined;
  const basePathValue =
    getCommercialEngineEnvVar(input.baseEnv, "PATH") ??
    getCommercialEngineEnvVar(input.baseEnv, "Path");
  const patchedPath =
    engineBinDir && basePathValue
      ? `${engineBinDir}${process.platform === "win32" ? ";" : ":"}${basePathValue}`
      : engineBinDir
        ? engineBinDir
        : undefined;
  const patch = {
    ...(input.resolvedHomePath ? { CODEX_HOME: input.resolvedHomePath } : {}),
    ...(patchedPath ? { PATH: patchedPath, Path: patchedPath } : {}),
    ...(input.bundledConfig?.spawnEnvPatch ?? {}),
  };

  const rawEnv = input.bundledConfig
    ? buildCommercialEngineProcessEnv(input.baseEnv, patch)
    : {
        ...input.baseEnv,
        ...patch,
      };

  return Object.fromEntries(
    Object.entries(rawEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
