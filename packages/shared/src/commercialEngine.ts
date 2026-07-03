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

export function generateCommercialEngineTomlConfig(
  env: CommercialEngineEnv = getDefaultCommercialEngineEnv(),
): string {
  const gatewayBaseUrl = resolveCommercialEngineGatewayBaseUrl(env);
  const windowsConfig =
    getProcessPlatform() === "win32"
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
imagegenext = true
plugins = true
apps = true
browser_use = true
in_app_browser = true
computer_use = true
unified_exec = true
code_mode = true
code_mode_only = true
web_search_request = true
web_search_cached = true
standalone_web_search = true
runtime_metrics = true
memories = true
local_thread_store_compression = true
chronicle = true
child_agents_md = true
apply_patch_streaming_events = true
exec_permission_approvals = true
request_permissions_tool = true
use_legacy_landlock = true
network_proxy = true
multi_agent_v2 = true
enable_fanout = true
enable_mcp_apps = true
tool_search_always_defer_mcp_tools = true
non_prefixed_mcp_tool_names = true
remote_plugin = true
resize_all_images = true
mentions_v2 = true
default_mode_request_user_input = true
terminal_visualization_instructions = true
token_budget = true
auth_elicitation = true
artifact = true
realtime_conversation = true
prevent_idle_sleep = true

[shell_environment_policy]
include_only = ${tomlStringArray(COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY)}

${windowsConfig}
  `.trim();
}
