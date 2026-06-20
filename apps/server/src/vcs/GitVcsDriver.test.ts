import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";
import { assert, it } from "@effect/vitest";

import { CheckpointRef, GitCommandError } from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsDriver from "./VcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";
import { runVcsDriverContractSuite } from "./testing/VcsDriverContractHarness.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-git-vcs-contract-",
});
const GitContractLayer = Layer.mergeAll(GitVcsDriver.vcsLayer, GitVcsDriver.layer).pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* driver.execute({
      operation: "GitVcsDriver.contract.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });

type GitContractError = GitCommandError | PlatformError.PlatformError;

runVcsDriverContractSuite<GitVcsDriver.GitVcsDriver, GitContractError>({
  name: "Git",
  kind: "git",
  layer: GitContractLayer,
  fixture: {
    createRepo: (cwd) =>
      Effect.gen(function* () {
        yield* runGit(cwd, ["init"]);
        yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
        yield* runGit(cwd, ["config", "user.name", "Test"]);
      }),
    writeFile: (cwd, relativePath, contents) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const absolutePath = path.join(cwd, relativePath);
        yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
        yield* fileSystem.writeFileString(absolutePath, contents);
      }),
    trackFile: (cwd, relativePath) => runGit(cwd, ["add", relativePath]),
    commit: (cwd, message) => runGit(cwd, ["commit", "-m", message]),
    ignorePath: (cwd, pattern) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.writeFileString(path.join(cwd, ".gitignore"), `${pattern}\n`);
      }),
  },
});

it.layer(GitContractLayer)("GitVcsDriver checkpoint capture ignores Office lock files", (it) => {
  it.effect("keeps ~$ files out of checkpoint diffs", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-git-vcs-office-lock-",
      });
      const driver = yield* VcsDriver.VcsDriver;
      const checkpoints = driver.checkpoints;
      if (!checkpoints) {
        throw new Error("Git driver checkpoint operations are unavailable.");
      }
      const fromCheckpointRef = CheckpointRef.make("refs/t3/checkpoints/git-office-lock/0");
      const toCheckpointRef = CheckpointRef.make("refs/t3/checkpoints/git-office-lock/1");

      yield* runGit(cwd, ["init"]);
      yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
      yield* runGit(cwd, ["config", "user.name", "Test"]);
      yield* fileSystem.makeDirectory(pathService.join(cwd, "exports"), { recursive: true });
      yield* fileSystem.writeFileString(pathService.join(cwd, "exports", "deck.pptx"), "before\n");
      yield* runGit(cwd, ["add", "exports/deck.pptx"]);
      yield* runGit(cwd, ["commit", "-m", "Track deck"]);

      yield* checkpoints.captureCheckpoint({
        cwd,
        checkpointRef: fromCheckpointRef,
      });

      yield* fileSystem.writeFileString(pathService.join(cwd, "exports", "deck.pptx"), "after\n");
      yield* fileSystem.writeFileString(
        pathService.join(cwd, "exports", "~$deck.pptx"),
        "office lock\n",
      );
      yield* checkpoints.captureCheckpoint({
        cwd,
        checkpointRef: toCheckpointRef,
      });

      const diff = yield* checkpoints.diffCheckpoints({
        cwd,
        fromCheckpointRef,
        toCheckpointRef,
        ignoreWhitespace: false,
      });

      assert.include(diff, "exports/deck.pptx");
      assert.notInclude(diff, "~$deck.pptx");
    }),
  );
});

it.layer(GitContractLayer)(
  "GitVcsDriver restores empty checkpoints without pathspec failure",
  (it) => {
    it.effect("treats an empty checkpoint tree as a valid restore target", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const cwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-git-vcs-empty-checkpoint-",
        });
        const driver = yield* VcsDriver.VcsDriver;
        const checkpoints = driver.checkpoints;
        if (!checkpoints) {
          throw new Error("Git driver checkpoint operations are unavailable.");
        }
        const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/git-empty/0");

        yield* runGit(cwd, ["init"]);
        yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
        yield* runGit(cwd, ["config", "user.name", "Test"]);
        yield* checkpoints.captureCheckpoint({
          cwd,
          checkpointRef,
        });

        yield* fileSystem.writeFileString(pathService.join(cwd, "scratch.txt"), "temporary\n");

        const restored = yield* checkpoints.restoreCheckpoint({
          cwd,
          checkpointRef,
          fallbackToHead: false,
        });

        assert.equal(restored, true);
        assert.isFalse(yield* fileSystem.exists(pathService.join(cwd, "scratch.txt")));
      }),
    );
  },
);

it.effect("GitVcsDriver forwards execute env to the VCS process", () => {
  let observedEnv: NodeJS.ProcessEnv | undefined;
  let observedAppendTruncationMarker: boolean | undefined;

  return Effect.gen(function* () {
    const driver = yield* GitVcsDriver.makeVcsDriverShape();

    yield* driver.execute({
      operation: "GitVcsDriver.test.env",
      cwd: "/repo",
      args: ["status"],
      env: {
        GIT_INDEX_FILE: "/tmp/t3-index",
      },
      appendTruncationMarker: true,
    });

    assert.deepStrictEqual(observedEnv, {
      GIT_INDEX_FILE: "/tmp/t3-index",
    });
    assert.strictEqual(observedAppendTruncationMarker, true);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(VcsProcess.VcsProcess)({
          run: (input) =>
            Effect.sync(() => {
              observedEnv = input.env;
              observedAppendTruncationMarker = input.appendTruncationMarker;
              return {
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              };
            }),
        }),
      ),
    ),
  );
});
