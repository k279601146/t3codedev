// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isGitRepository } from "./Utils.ts";

describe("git Utils", () => {
  it("recognizes repository subdirectories as git repositories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-git-utils-"));
    try {
      fs.mkdirSync(path.join(root, ".git"));
      const nested = path.join(root, "packages", "app");
      fs.mkdirSync(nested, { recursive: true });

      expect(isGitRepository(nested)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("recognizes worktree-style .git files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-git-utils-"));
    try {
      fs.writeFileSync(path.join(root, ".git"), "gitdir: ../main/.git/worktrees/root\n");

      expect(isGitRepository(root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns false outside a git repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-git-utils-"));
    try {
      expect(isGitRepository(path.join(root, "nested"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
