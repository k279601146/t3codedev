const WINDOWS_SANDBOX_ARTIFACT_ROOT_NAMES = new Set(["%SystemDrive%"]);

export const WINDOWS_SANDBOX_SYSTEM_CACHE_RELATIVE_PATH =
  "%SystemDrive%/ProgramData/Microsoft/Windows/Caches";

export function normalizeWorkspaceRelativePath(input: string): string {
  return input.replaceAll("\\", "/").replace(/^\/+/u, "").replace(/\/+/gu, "/");
}

export function isWindowsSandboxWorkspaceArtifactRootName(name: string): boolean {
  return WINDOWS_SANDBOX_ARTIFACT_ROOT_NAMES.has(name);
}

export function isWindowsSandboxWorkspaceArtifactPath(relativePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  const firstSegment = normalized.split("/")[0];
  return firstSegment !== undefined && isWindowsSandboxWorkspaceArtifactRootName(firstSegment);
}

export function isWindowsSandboxSystemCachePath(relativePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  return (
    normalized === WINDOWS_SANDBOX_SYSTEM_CACHE_RELATIVE_PATH ||
    normalized.startsWith(`${WINDOWS_SANDBOX_SYSTEM_CACHE_RELATIVE_PATH}/`)
  );
}
