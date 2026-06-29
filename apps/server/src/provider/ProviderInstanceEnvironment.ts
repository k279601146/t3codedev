import type { ProviderInstanceEnvironment } from "@t3tools/contracts";

const PROVIDER_BASE_ENV_KEYS = new Set([
  "APPDATA",
  "BAHEW_HOME",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "LOGNAME",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "Path",
  "PROCESSOR_ARCHITECTURE",
  "REQUESTS_CA_BUNDLE",
  "SHELL",
  "SSH_AUTH_SOCK",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "windir",
]);

const PROVIDER_BASE_ENV_PREFIXES = ["MYIDE_", "T3CODE_"] as const;

function shouldInheritProviderEnvironmentVariable(name: string): boolean {
  return (
    PROVIDER_BASE_ENV_KEYS.has(name) ||
    PROVIDER_BASE_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export function buildProviderBaseEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value !== undefined && shouldInheritProviderEnvironmentVariable(name)) {
      next[name] = value;
    }
  }
  return next;
}

export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next = buildProviderBaseEnvironment(baseEnv);
  if (!environment || environment.length === 0) {
    return next;
  }

  for (const variable of environment) {
    next[variable.name] = variable.value;
  }
  return next;
}
