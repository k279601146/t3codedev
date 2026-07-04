import commercialEngineFeaturePolicy from "./commercialEngineFeaturePolicy.json" with { type: "json" };

export const COMMERCIAL_ENGINE_PROVIDER_ID = "myservice";
export const COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME = "MyService";
export const COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV = "MYIDE_WEB_AUTH_BASE_URL";
export const COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV = "MYIDE_GATEWAY_BASE_URL";
export const COMMERCIAL_ENGINE_LEGACY_GATEWAY_BASE_URL_ENV = "MYIDE_API_URL";
export const COMMERCIAL_ENGINE_IDE_JWT_ENV = "MYIDE_IDE_JWT";
export const COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV = "MYIDE_WINDOWS_SANDBOX_MODE";

export const DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL = "https://sub.bahew.com/v1";
export const DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL = "https://www.bahew.com";
export const COMMERCIAL_ENGINE_WIRE_API = "responses";
export const COMMERCIAL_ENGINE_WINDOWS_SANDBOX_MODES = ["unelevated", "elevated"] as const;
export type CommercialEngineWindowsSandboxMode =
  (typeof COMMERCIAL_ENGINE_WINDOWS_SANDBOX_MODES)[number];

export const COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY = [
  "PATH",
  "HOME",
  "LANG",
  "TERM",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SystemDrive",
  "HOMEDRIVE",
  "HOMEPATH",
] as const;

export const COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS = [
  ...commercialEngineFeaturePolicy.enabledFeatureKeys,
] as const;

export const COMMERCIAL_ENGINE_EXCLUDED_FEATURE_KEYS = [
  ...commercialEngineFeaturePolicy.excludedFeatureKeys,
] as const;

const COMMERCIAL_ENGINE_PROCESS_ENV_INCLUDE_ONLY = [
  "PATH",
  "HOME",
  "LANG",
  "TERM",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SystemDrive",
  "HOMEDRIVE",
  "HOMEPATH",
  "Path",
  "ComSpec",
  "PATHEXT",
  "WINDIR",
] as const;

type CommercialEngineEnv = Readonly<Record<string, string | undefined>>;

function getProcessEnv(): CommercialEngineEnv {
  return (
    (globalThis as { process?: { env?: CommercialEngineEnv } }).process?.env ??
    {}
  );
}

function getProcessPlatform(): NodeJS.Platform | undefined {
  return (globalThis as { process?: { platform?: NodeJS.Platform } }).process?.platform;
}

function getBundlerCommercialEngineEnv(): CommercialEngineEnv {
  const env = (import.meta as unknown as {
    env?: {
      MYIDE_WEB_AUTH_BASE_URL?: string;
      MYIDE_GATEWAY_BASE_URL?: string;
      MYIDE_API_URL?: string;
      MYIDE_WINDOWS_SANDBOX_MODE?: string;
    };
  }).env;

  return {
    [COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV]: env?.MYIDE_WEB_AUTH_BASE_URL,
    [COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV]: env?.MYIDE_GATEWAY_BASE_URL,
    [COMMERCIAL_ENGINE_LEGACY_GATEWAY_BASE_URL_ENV]: env?.MYIDE_API_URL,
    [COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV]: env?.MYIDE_WINDOWS_SANDBOX_MODE,
  };
}

function getDefaultCommercialEngineEnv(): CommercialEngineEnv {
  return {
    ...getBundlerCommercialEngineEnv(),
    ...getProcessEnv(),
  };
}

export function getCommercialEngineEnvVar(env: CommercialEngineEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key];
  const upperKey = key.toUpperCase();
  for (const envKey in env) {
    if (envKey.toUpperCase() === upperKey) return env[envKey];
  }
  return undefined;
}

export function buildCommercialEngineProcessEnv(
  baseEnv: CommercialEngineEnv,
  patch: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of COMMERCIAL_ENGINE_PROCESS_ENV_INCLUDE_ONLY) {
    const value = getCommercialEngineEnvVar(baseEnv, name);
    if (value !== undefined) {
      env[name] = value;
    }
  }
  for (const [name, value] of Object.entries(patch)) {
    env[name] = value;
  }
  return env;
}

export function resolveCommercialEngineGatewayBaseUrl(
  env: CommercialEngineEnv = getDefaultCommercialEngineEnv(),
): string {
  return (
    getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV) ||
    getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_LEGACY_GATEWAY_BASE_URL_ENV) ||
    DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL
  );
}

export function resolveCommercialEngineWebAuthBaseUrl(
  env: CommercialEngineEnv = getDefaultCommercialEngineEnv(),
): string {
  return (
    getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV) ||
    DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL
  );
}

export function resolveCommercialEngineIdeApiBaseUrl(gatewayBaseUrl: string): string {
  const url = new URL(gatewayBaseUrl);
  url.hash = "";
  url.search = "";
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

export function resolveCommercialEngineIdeApiBaseUrlCandidates(gatewayBaseUrl: string): string[] {
  const primary = resolveCommercialEngineIdeApiBaseUrl(gatewayBaseUrl);
  return [primary];
}

export function resolveCommercialEngineIdeJwt(
  env: CommercialEngineEnv = getDefaultCommercialEngineEnv(),
): string | undefined {
  const token = getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_IDE_JWT_ENV)?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function resolveCommercialEngineWindowsSandboxMode(
  env: CommercialEngineEnv = getDefaultCommercialEngineEnv(),
): CommercialEngineWindowsSandboxMode {
  const raw = getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV)
    ?.trim()
    .toLowerCase();
  return raw === "unelevated" ? "unelevated" : "elevated";
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: ReadonlyArray<string>): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlBooleanAssignments(keys: ReadonlyArray<string>, value: boolean): string {
  return keys.map((key) => `${key} = ${value ? "true" : "false"}`).join("\n");
}

export function generateCommercialEngineTomlConfig(
  env: CommercialEngineEnv = getDefaultCommercialEngineEnv(),
): string {
  const windowsConfig =
    getProcessPlatform() === "win32"
      ? `[windows]\nsandbox = ${tomlString(resolveCommercialEngineWindowsSandboxMode(env))}`
      : "";

  return `
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "user"
disable_telemetry = true

[sandbox_workspace_write]
network_access = false

[features]
${tomlBooleanAssignments(COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS, true)}

[shell_environment_policy]
include_only = ${tomlStringArray(COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY)}

${windowsConfig}
  `.trim();
}
