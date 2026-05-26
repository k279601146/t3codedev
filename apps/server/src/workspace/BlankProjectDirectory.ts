// @effect-diagnostics nodeBuiltinImport:off
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function sanitizeBlankProjectDirectoryName(name: string): string {
  const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim();
  if (!sanitized || reservedWindowsNames.test(sanitized)) {
    return "未命名项目";
  }
  return sanitized;
}

export async function createBlankProjectDirectory(name: string): Promise<string> {
  const documentsRoot = path.join(os.homedir(), "Documents");
  const baseName = sanitizeBlankProjectDirectoryName(name);

  await fsPromises.mkdir(documentsRoot, { recursive: true });

  for (let index = 0; index < 100; index += 1) {
    const candidateName = index === 0 ? baseName : `${baseName} ${index + 1}`;
    const candidatePath = path.join(documentsRoot, candidateName);
    try {
      await fsPromises.mkdir(candidatePath);
      return candidatePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`无法为“${baseName}”创建唯一的项目文件夹。`);
}
