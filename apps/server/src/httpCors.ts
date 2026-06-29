export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
] as const;

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const BROWSER_API_CORS_ALLOWED_ORIGINS_ENV = "T3CODE_BROWSER_API_ALLOWED_ORIGINS";

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function configuredAllowedOrigins(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const raw = env[BROWSER_API_CORS_ALLOWED_ORIGINS_ENV];
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((value) => normalizeOrigin(value.trim()))
      .filter((value): value is string => value !== null),
  );
}

export function isBrowserApiCorsAllowedOrigin(origin: string): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }
  const url = new URL(normalizedOrigin);
  return isLoopbackHostname(url.hostname) || configuredAllowedOrigins().has(normalizedOrigin);
}

export const browserApiCorsHeaders = {
  "access-control-allow-methods": browserApiCorsAllowedMethods.join(", "),
  "access-control-allow-headers": browserApiCorsAllowedHeaders.join(", "),
} as const;
