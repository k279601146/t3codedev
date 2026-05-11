// @effect-diagnostics nodeBuiltinImport:off
import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export function isGitRepository(cwd: string): boolean {
  let current = resolve(cwd);
  const root = parse(current).root;

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return true;
    }
    if (current === root) {
      return false;
    }
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}
