/**
 * CheckpointStoreLive - Filesystem checkpoint store adapter layer.
 *
 * Resolves the active VCS driver once per checkpoint operation and delegates
 * checkpoint-specific behavior to the driver's optional checkpoint capability.
 * Falls back to a shadow git repository for non-git workspaces.
 *
 * @module CheckpointStoreLive
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import type { VcsCheckpointOps } from "../../vcs/VcsDriver.ts";
import { ShadowGitCheckpoints } from "./ShadowGitCheckpoints.ts";

const makeCheckpointStore = Effect.gen(function* () {
  const vcsRegistry = yield* VcsDriverRegistry;
  const shadowGitCheckpoints = yield* ShadowGitCheckpoints;

  const resolveCheckpoints = Effect.fn("CheckpointStore.resolveCheckpoints")(function* (
    operation: string,
    cwd: string,
  ) {
    const checkpointOps = yield* vcsRegistry.resolve({ cwd }).pipe(
      Effect.map((handle) => handle.driver.checkpoints ?? null),
      Effect.catch(() => Effect.succeed(null)),
    );

    if (checkpointOps) {
      return checkpointOps satisfies VcsCheckpointOps;
    }

    return yield* shadowGitCheckpoints.resolve(cwd);
  });

  const isGitRepository: CheckpointStoreShape["isGitRepository"] = (cwd) =>
    vcsRegistry.resolve({ cwd, requestedKind: "git" }).pipe(
      Effect.map(() => true),
      Effect.orElseSucceed(() => false),
    );

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = Effect.fn(
    "captureCheckpoint",
  )(function* (input) {
    const checkpoints = yield* resolveCheckpoints("CheckpointStore.captureCheckpoint", input.cwd);
    return yield* checkpoints.captureCheckpoint(input);
  });

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = Effect.fn("hasCheckpointRef")(
    function* (input) {
      const checkpoints = yield* resolveCheckpoints("CheckpointStore.hasCheckpointRef", input.cwd);
      return yield* checkpoints.hasCheckpointRef(input);
    },
  );

  const restoreCheckpoint: CheckpointStoreShape["restoreCheckpoint"] = Effect.fn(
    "restoreCheckpoint",
  )(function* (input) {
    const checkpoints = yield* resolveCheckpoints("CheckpointStore.restoreCheckpoint", input.cwd);
    return yield* checkpoints.restoreCheckpoint(input);
  });

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = Effect.fn("diffCheckpoints")(
    function* (input) {
      const checkpoints = yield* resolveCheckpoints("CheckpointStore.diffCheckpoints", input.cwd);
      return yield* checkpoints.diffCheckpoints(input);
    },
  );

  const deleteCheckpointRefs: CheckpointStoreShape["deleteCheckpointRefs"] = Effect.fn(
    "deleteCheckpointRefs",
  )(function* (input) {
    const checkpoints = yield* resolveCheckpoints(
      "CheckpointStore.deleteCheckpointRefs",
      input.cwd,
    );
    return yield* checkpoints.deleteCheckpointRefs(input);
  });

  return {
    isGitRepository,
    captureCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    deleteCheckpointRefs,
  } satisfies CheckpointStoreShape;
});

export const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore);
