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

import { CheckpointRef } from "@t3tools/contracts";
import {
  CheckpointStore,
  type DiffCheckpointsInput,
  type RestoreCheckpointInput,
  type CheckpointStoreShape,
  type CaptureCheckpointInput,
} from "../Services/CheckpointStore.ts";
import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import type { VcsCheckpointOps } from "../../vcs/VcsDriver.ts";
import { ShadowGitCheckpoints } from "./ShadowGitCheckpoints.ts";

const CHECKPOINT_TURN_REF_PATTERN = /^(refs\/t3\/checkpoints\/.+\/turn\/)(\d+)$/u;

function previousCheckpointRef(checkpointRef: CheckpointRef): CheckpointRef | null {
  const match = CHECKPOINT_TURN_REF_PATTERN.exec(checkpointRef);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  const turnCount = Number.parseInt(match[2] ?? "", 10);
  if (!prefix || !Number.isSafeInteger(turnCount) || turnCount <= 0) {
    return null;
  }

  return CheckpointRef.make(`${prefix}${turnCount - 1}`);
}

const makeCheckpointStore = Effect.gen(function* () {
  const vcsRegistry = yield* VcsDriverRegistry;
  const shadowGitCheckpoints = yield* ShadowGitCheckpoints;

  const resolveNativeCheckpoints = Effect.fn("CheckpointStore.resolveNativeCheckpoints")(function* (
    operation: string,
    cwd: string,
  ): Effect.fn.Return<VcsCheckpointOps | null> {
    const checkpointOps = yield* vcsRegistry.resolve({ cwd }).pipe(
      Effect.map((handle) => handle.driver.checkpoints ?? null),
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!checkpointOps) {
      yield* Effect.logDebug("checkpoint store using shadow git backend", { operation, cwd });
      return null;
    }
    return checkpointOps satisfies VcsCheckpointOps;
  });

  const resolveCheckpoints = Effect.fn("CheckpointStore.resolveCheckpoints")(function* (
    operation: string,
    cwd: string,
  ) {
    const checkpointOps = yield* resolveNativeCheckpoints(operation, cwd);
    if (checkpointOps) {
      return checkpointOps;
    }
    return yield* shadowGitCheckpoints.resolve(cwd);
  });

  const resolveCheckpointsForDiff = Effect.fn("CheckpointStore.resolveCheckpointsForDiff")(
    function* (operation: string, input: DiffCheckpointsInput) {
      const nativeCheckpoints = yield* resolveNativeCheckpoints(operation, input.cwd);
      const shadowFromExists = yield* shadowGitCheckpoints.hasCheckpointRef({
        cwd: input.cwd,
        checkpointRef: input.fromCheckpointRef,
      });
      const shadowToExists = yield* shadowGitCheckpoints.hasCheckpointRef({
        cwd: input.cwd,
        checkpointRef: input.toCheckpointRef,
      });
      if (shadowFromExists || shadowToExists) {
        return yield* shadowGitCheckpoints.resolve(input.cwd);
      }

      return nativeCheckpoints ?? (yield* shadowGitCheckpoints.resolve(input.cwd));
    },
  );

  const resolveCheckpointsForRestore = Effect.fn("CheckpointStore.resolveCheckpointsForRestore")(
    function* (operation: string, input: RestoreCheckpointInput) {
      const nativeCheckpoints = yield* resolveNativeCheckpoints(operation, input.cwd);
      const shadowRefExists = yield* shadowGitCheckpoints.hasCheckpointRef({
        cwd: input.cwd,
        checkpointRef: input.checkpointRef,
      });
      if (shadowRefExists) {
        return yield* shadowGitCheckpoints.resolve(input.cwd);
      }
      return nativeCheckpoints ?? (yield* shadowGitCheckpoints.resolve(input.cwd));
    },
  );

  const resolveCheckpointsForCapture = Effect.fn("CheckpointStore.resolveCheckpointsForCapture")(
    function* (operation: string, input: CaptureCheckpointInput) {
      const nativeCheckpoints = yield* resolveNativeCheckpoints(operation, input.cwd);
      const shadowTargetExists = yield* shadowGitCheckpoints.hasCheckpointRef({
        cwd: input.cwd,
        checkpointRef: input.checkpointRef,
      });
      if (shadowTargetExists) {
        return yield* shadowGitCheckpoints.resolve(input.cwd);
      }

      const previousRef = previousCheckpointRef(input.checkpointRef);
      if (previousRef) {
        const shadowPreviousExists = yield* shadowGitCheckpoints.hasCheckpointRef({
          cwd: input.cwd,
          checkpointRef: previousRef,
        });
        if (shadowPreviousExists) {
          return yield* shadowGitCheckpoints.resolve(input.cwd);
        }
      }

      return nativeCheckpoints ?? (yield* shadowGitCheckpoints.resolve(input.cwd));
    },
  );

  const isGitRepository: CheckpointStoreShape["isGitRepository"] = (cwd) =>
    vcsRegistry.resolve({ cwd, requestedKind: "git" }).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    );

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = Effect.fn(
    "captureCheckpoint",
  )(function* (input) {
    const checkpoints = yield* resolveCheckpointsForCapture(
      "CheckpointStore.captureCheckpoint",
      input,
    );
    return yield* checkpoints.captureCheckpoint(input);
  });

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = Effect.fn("hasCheckpointRef")(
    function* (input) {
      const nativeCheckpoints = yield* resolveNativeCheckpoints(
        "CheckpointStore.hasCheckpointRef",
        input.cwd,
      );
      if (nativeCheckpoints) {
        const nativeExists = yield* nativeCheckpoints.hasCheckpointRef(input);
        if (nativeExists) {
          return true;
        }
      }

      return yield* shadowGitCheckpoints.hasCheckpointRef(input);
    },
  );

  const restoreCheckpoint: CheckpointStoreShape["restoreCheckpoint"] = Effect.fn(
    "restoreCheckpoint",
  )(function* (input) {
    const checkpoints = yield* resolveCheckpointsForRestore(
      "CheckpointStore.restoreCheckpoint",
      input,
    );
    return yield* checkpoints.restoreCheckpoint(input);
  });

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = Effect.fn("diffCheckpoints")(
    function* (input) {
      const checkpoints = yield* resolveCheckpointsForDiff(
        "CheckpointStore.diffCheckpoints",
        input,
      );
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
