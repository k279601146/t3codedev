import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { desktopDir } from "./electron-launcher.mjs";

function parseDotenvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) return undefined;

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;

  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

export function loadRootDotenv() {
  const envPath = resolve(desktopDir, "..", "..", ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const entry = parseDotenvLine(line);
    if (!entry) continue;
    const [key, value] = entry;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
