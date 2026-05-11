// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { describe, expect } from "vitest";

import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointStoreLive } from "./CheckpointStore.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import type { VcsError } from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import { ThreadId } from "@t3tools/contracts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-store-test-",
});
const VcsProcessTestLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const VcsDriverTestLayer = VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcessTestLayer));
const CheckpointStoreTestLayer = CheckpointStoreLive.pipe(
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(NodeServices.layer),
);
const TestLayer = CheckpointStoreTestLayer.pipe(
  Layer.provideMerge(VcsProcessTestLayer),
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

function makeTmpDir(
  prefix = "checkpoint-store-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function readTextFile(
  filePath: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFileString(filePath);
  });
}

function removePath(
  filePath: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.remove(filePath, { recursive: true });
  });
}

function makeDirectory(
  dirPath: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(dirPath, { recursive: true });
  });
}

function pathExists(
  filePath: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.exists(filePath);
  });
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, VcsError, VcsProcess.VcsProcess> {
  return Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "CheckpointStore.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  void,
  VcsError | PlatformError.PlatformError,
  VcsProcess.VcsProcess | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    yield* git(cwd, ["init"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(path.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
  });
}

function buildLargeText(lineCount = 5_000): string {
  return Array.from({ length: lineCount }, (_, index) => `line ${String(index).padStart(5, "0")}`)
    .join("\n")
    .concat("\n");
}

it.layer(TestLayer)("CheckpointStoreLive", (it) => {
  describe("restoreCheckpoint", () => {
    it.effect("restores HEAD, staged state, worktree state, and untracked files", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-restore");
        const checkpointRef = checkpointRefForThreadTurn(threadId, 0);

        yield* writeTextFile(path.join(tmp, "remove-me.txt"), "remove me\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "add removable file"]);
        const checkpointHead = yield* git(tmp, ["rev-parse", "HEAD"]);

        yield* writeTextFile(path.join(tmp, "README.md"), "staged readme\n");
        yield* writeTextFile(path.join(tmp, "staged-only.txt"), "staged only\n");
        yield* git(tmp, ["add", "README.md", "staged-only.txt"]);
        yield* writeTextFile(path.join(tmp, "README.md"), "worktree readme\n");
        yield* writeTextFile(path.join(tmp, "notes.txt"), "untracked note\n");
        yield* removePath(path.join(tmp, "remove-me.txt"));

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef,
        });

        yield* git(tmp, ["add", "-A"]);
        yield* git(tmp, ["commit", "-m", "later commit"]);
        yield* writeTextFile(path.join(tmp, "README.md"), "after checkpoint\n");
        yield* writeTextFile(path.join(tmp, "notes.txt"), "changed note\n");
        yield* writeTextFile(path.join(tmp, "extra.txt"), "extra\n");
        yield* writeTextFile(path.join(tmp, "staged-only.txt"), "changed staged only\n");

        const restored = yield* checkpointStore.restoreCheckpoint({
          cwd: tmp,
          checkpointRef,
        });

        expect(restored).toBe(true);
        expect(yield* git(tmp, ["rev-parse", "HEAD"])).toBe(checkpointHead);
        expect(yield* readTextFile(path.join(tmp, "README.md"))).toBe("worktree readme\n");
        expect(yield* git(tmp, ["show", ":README.md"])).toBe("staged readme");
        expect(yield* readTextFile(path.join(tmp, "notes.txt"))).toBe("untracked note\n");
        expect(yield* readTextFile(path.join(tmp, "staged-only.txt"))).toBe("staged only\n");
        expect(yield* pathExists(path.join(tmp, "remove-me.txt"))).toBe(false);
        expect(yield* pathExists(path.join(tmp, "extra.txt"))).toBe(false);

        const status = yield* git(tmp, ["status", "--short"]);
        expect(status.split("\n").filter(Boolean).toSorted()).toEqual([
          " D remove-me.txt",
          "?? notes.txt",
          "A  staged-only.txt",
          "MM README.md",
        ]);
      }),
    );

    it.effect("captures and restores a non-git folder with shadow git", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir("checkpoint-store-shadow-test-");
        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-shadow");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* writeTextFile(path.join(tmp, "index.php"), "<?php echo 'before';\n");
        yield* writeTextFile(path.join(tmp, "notes.txt"), "notes before\n");

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });

        expect(yield* pathExists(path.join(tmp, ".git"))).toBe(false);

        yield* writeTextFile(path.join(tmp, "index.php"), "<?php echo 'after';\n");
        yield* writeTextFile(path.join(tmp, "created.txt"), "created after\n");

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });
        expect(diff).toContain("diff --git");
        expect(diff).toContain("created.txt");

        yield* removePath(path.join(tmp, "index.php"));
        yield* writeTextFile(path.join(tmp, "created.txt"), "mutated\n");
        yield* writeTextFile(path.join(tmp, "extra.txt"), "extra\n");

        const restored = yield* checkpointStore.restoreCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });

        expect(restored).toBe(true);
        expect(yield* readTextFile(path.join(tmp, "index.php"))).toBe("<?php echo 'before';\n");
        expect(yield* readTextFile(path.join(tmp, "notes.txt"))).toBe("notes before\n");
        expect(yield* pathExists(path.join(tmp, "created.txt"))).toBe(false);
        expect(yield* pathExists(path.join(tmp, "extra.txt"))).toBe(false);
        expect(yield* pathExists(path.join(tmp, ".git"))).toBe(false);
      }),
    );

    it.effect("restores nested git directories after shadow checkpoint capture", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir("checkpoint-store-shadow-nested-git-test-");
        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-shadow-nested");
        const checkpointRef = checkpointRefForThreadTurn(threadId, 0);
        const nestedGitDir = path.join(tmp, "vendor", "pkg", ".git");

        yield* makeDirectory(nestedGitDir);
        yield* writeTextFile(path.join(tmp, "vendor", "pkg", "file.txt"), "nested file\n");
        yield* writeTextFile(path.join(nestedGitDir, "HEAD"), "ref: refs/heads/main\n");

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef,
        });

        expect(yield* pathExists(nestedGitDir)).toBe(true);
        expect(yield* pathExists(`${nestedGitDir}_disabled`)).toBe(false);
      }),
    );
  });

  describe("diffCheckpoints", () => {
    it.effect("returns full oversized checkpoint diffs without truncation", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(path.join(tmp, "README.md"), buildLargeText());
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(diff).toContain("diff --git");
        expect(diff).not.toContain("[truncated]");
        expect(diff).toContain("+line 04999");
      }),
    );

    it.effect("can hide indentation churn when changes wrap existing lines", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-whitespace");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        const componentPath = path.join(tmp, "Component.tsx");
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      <h1>Title</h1>",
            "      <p>Body</p>",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      {isReady ? (",
            "        <div>",
            "          <h1>Title</h1>",
            "          <p>Body</p>",
            "        </div>",
            "      ) : null}",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const normalDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });
        const whitespaceIgnoredDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(normalDiff).toContain("diff --git");
        expect(normalDiff).toContain("-      <h1>Title</h1>");
        expect(normalDiff).toContain("+          <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).toContain("diff --git");
        expect(whitespaceIgnoredDiff).toContain("+      {isReady ? (");
        expect(whitespaceIgnoredDiff).toContain("+        <div>");
        expect(whitespaceIgnoredDiff).not.toContain("-      <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).not.toContain("+          <h1>Title</h1>");
      }),
    );
  });
});
