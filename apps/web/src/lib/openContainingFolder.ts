import type { LocalApi } from "@t3tools/contracts";

export function containingFolderPath(filePath: string): string | null {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) return null;

  const lastSlashIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );
  if (lastSlashIndex === 0) {
    return normalizedPath.startsWith("/") ? "/" : null;
  }
  if (lastSlashIndex < 0) {
    return null;
  }
  if (lastSlashIndex === 2 && /^[A-Za-z]:[\\/]/u.test(normalizedPath)) {
    return normalizedPath.slice(0, 3);
  }

  return normalizedPath.slice(0, lastSlashIndex);
}

export async function openContainingFolder(api: LocalApi, filePath: string): Promise<void> {
  const directoryPath = containingFolderPath(filePath);
  if (!directoryPath) {
    throw new Error("无法定位该文件所在文件夹。");
  }
  await api.shell.openPath(directoryPath);
}

export async function revealFileInFolder(api: LocalApi, filePath: string): Promise<void> {
  try {
    await api.shell.revealPath(filePath);
    return;
  } catch {
    await openContainingFolder(api, filePath);
  }
}
