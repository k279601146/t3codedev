export const COMMERCIAL_ENGINE_PROVIDER_ID = "myservice";
export const COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME = "MyService";
export const COMMERCIAL_ENGINE_GATEWAY_BASE_URL_ENV = "MYIDE_GATEWAY_BASE_URL";
export const COMMERCIAL_ENGINE_LEGACY_GATEWAY_BASE_URL_ENV = "MYIDE_API_URL";
export const COMMERCIAL_ENGINE_IDE_JWT_ENV = "MYIDE_IDE_JWT";

export const DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL = "https://api.yourservice.com/v1";
export const COMMERCIAL_ENGINE_WIRE_API = "chat";

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
  "HOMEDRIVE",
  "HOMEPATH",
] as const;

export function getCommercialEngineEnvVar(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key];
  const upperKey = key.toUpperCase();
  for (const envKey in env) {
    if (envKey.toUpperCase() === upperKey) return env[envKey];
  }
  return undefined;
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

export function resolveCommercialEngineIdeJwt(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_IDE_JWT_ENV)?.trim();
  return token && token.length > 0 ? token : undefined;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: ReadonlyArray<string>): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

export function generateCommercialEngineTomlConfig(env: NodeJS.ProcessEnv = process.env): string {
  const gatewayBaseUrl = resolveCommercialEngineGatewayBaseUrl(env);
  const windowsConfig = process.platform === "win32" ? '[windows]\nsandbox = "unelevated"' : "";

  return `
model_provider = ${tomlString(COMMERCIAL_ENGINE_PROVIDER_ID)}
disable_telemetry = true

[model_providers.${COMMERCIAL_ENGINE_PROVIDER_ID}]
name = ${tomlString(COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME)}
base_url = ${tomlString(gatewayBaseUrl)}
wire_api = ${tomlString(COMMERCIAL_ENGINE_WIRE_API)}
env_key = ${tomlString(COMMERCIAL_ENGINE_IDE_JWT_ENV)}
requires_openai_auth = false

[shell_environment_policy]
include_only = ${tomlStringArray(COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY)}

${windowsConfig}
  `.trim();
}
