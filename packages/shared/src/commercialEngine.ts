export const COMMERCIAL_ENGINE_PROVIDER_ID = "myservice";
export const COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME = "MyService";
export const COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV = "MYIDE_WEB_AUTH_BASE_URL";
export const COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV = "MYIDE_GATEWAY_BASE_URL";
export const COMMERCIAL_ENGINE_LEGACY_GATEWAY_BASE_URL_ENV = "MYIDE_API_URL";
export const COMMERCIAL_ENGINE_IDE_JWT_ENV = "MYIDE_IDE_JWT";
export const COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV = "MYIDE_WINDOWS_SANDBOX_MODE";

export const DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL = "http://localhost:3000/v1";
export const DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL = "http://localhost:3001";
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

export function getCommercialEngineEnvVar(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key];
  const upperKey = key.toUpperCase();
  for (const envKey in env) {
    if (envKey.toUpperCase() === upperKey) return env[envKey];
  }
  return undefined;
}

export function buildCommercialEngineProcessEnv(
  baseEnv: NodeJS.ProcessEnv,
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
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV) ||
    getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_LEGACY_GATEWAY_BASE_URL_ENV) ||
    DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL
  );
}

export function resolveCommercialEngineWebAuthBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
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
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_IDE_JWT_ENV)?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function resolveCommercialEngineWindowsSandboxMode(
  env: NodeJS.ProcessEnv = process.env,
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

export function generateCommercialEngineTomlConfig(env: NodeJS.ProcessEnv = process.env): string {
  const gatewayBaseUrl = resolveCommercialEngineGatewayBaseUrl(env);
  const windowsConfig =
    process.platform === "win32"
      ? `[windows]\nsandbox = ${tomlString(resolveCommercialEngineWindowsSandboxMode(env))}`
      : "";

  return `
model_provider = ${tomlString(COMMERCIAL_ENGINE_PROVIDER_ID)}
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "user"
disable_telemetry = true

[sandbox_workspace_write]
network_access = false

[model_providers.${COMMERCIAL_ENGINE_PROVIDER_ID}]
name = ${tomlString(COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME)}
base_url = ${tomlString(gatewayBaseUrl)}
wire_api = ${tomlString(COMMERCIAL_ENGINE_WIRE_API)}
env_key = ${tomlString(COMMERCIAL_ENGINE_IDE_JWT_ENV)}
requires_openai_auth = false

[model_providers.${COMMERCIAL_ENGINE_PROVIDER_ID}.capabilities]
image_generation = true

[features]
image_generation = true
plugins = true
apps = true
browser_use = true
in_app_browser = true
computer_use = true

[shell_environment_policy]
include_only = ${tomlStringArray(COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY)}

${windowsConfig}
  `.trim();
}
