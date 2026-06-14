import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  readCodexGlobalGuidance,
  resolveCodexGlobalGuidancePaths,
  updateCodexGlobalGuidance,
} from "./CodexGlobalGuidance.ts";

const makeTempDir = Effect.fn("CodexGlobalGuidance.test.makeTempDir")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-codex-guidance-" });
});

function withCommercialHomeEnv<A, E, R>(
  env: Record<string, string | undefined>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  const snapshotKeys = ["BAHEW_HOME", "MYIDE_ENGINE_HOME", "MYIDE_ENGINE_PATH"] as const;
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(snapshotKeys.map((key) => [key, process.env[key]]));
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }),
  );
}

function withCodexHome(homePath: string): ServerSettings {
  return {
    ...DEFAULT_SERVER_SETTINGS,
    providers: {
      ...DEFAULT_SERVER_SETTINGS.providers,
      codex: {
        ...DEFAULT_SERVER_SETTINGS.providers.codex,
        homePath,
      },
    },
  };
}

it.layer(NodeServices.layer)("CodexGlobalGuidance", (it) => {
  describe("resolveCodexGlobalGuidancePaths", () => {
    it.effect("resolves AGENTS.md and AGENTS.override.md inside the shared Codex home", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const codexHome = yield* makeTempDir();

        const paths = yield* withCommercialHomeEnv(
          { BAHEW_HOME: undefined, MYIDE_ENGINE_HOME: undefined, MYIDE_ENGINE_PATH: undefined },
          resolveCodexGlobalGuidancePaths(withCodexHome(codexHome)),
        );

        expect(paths.filePath).toBe(path.join(codexHome, "AGENTS.md"));
        expect(paths.overrideFilePath).toBe(path.join(codexHome, "AGENTS.override.md"));
      }),
    );

    it.effect("uses BAHEW_HOME agent-data before the official Codex default home", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const bahewHome = yield* makeTempDir();

        const paths = yield* withCommercialHomeEnv(
          { BAHEW_HOME: bahewHome, MYIDE_ENGINE_HOME: undefined, MYIDE_ENGINE_PATH: undefined },
          resolveCodexGlobalGuidancePaths(DEFAULT_SERVER_SETTINGS),
        );

        expect(paths.filePath).toBe(path.join(bahewHome, "agent-data", "AGENTS.md"));
      }),
    );
  });

  describe("readCodexGlobalGuidance 和 updateCodexGlobalGuidance", () => {
    it.effect("writes, reads, and removes global guidance", () =>
      Effect.gen(function* () {
        const settings = withCodexHome(yield* makeTempDir());

        const saved = yield* withCommercialHomeEnv(
          { BAHEW_HOME: undefined, MYIDE_ENGINE_HOME: undefined, MYIDE_ENGINE_PATH: undefined },
          updateCodexGlobalGuidance({
            settings,
            content: "始终使用中文回复。\n",
          }),
        );
        expect(saved.content).toBe("始终使用中文回复。\n");

        const readBack = yield* withCommercialHomeEnv(
          { BAHEW_HOME: undefined, MYIDE_ENGINE_HOME: undefined, MYIDE_ENGINE_PATH: undefined },
          readCodexGlobalGuidance(settings),
        );
        expect(readBack.content).toBe("始终使用中文回复。\n");

        const removed = yield* withCommercialHomeEnv(
          { BAHEW_HOME: undefined, MYIDE_ENGINE_HOME: undefined, MYIDE_ENGINE_PATH: undefined },
          updateCodexGlobalGuidance({ settings, content: "   " }),
        );
        expect(removed.content).toBe("");
      }),
    );

    it.effect("reports when AGENTS.override.md is present", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = withCodexHome(yield* makeTempDir());
        const paths = yield* withCommercialHomeEnv(
          { BAHEW_HOME: undefined, MYIDE_ENGINE_HOME: undefined, MYIDE_ENGINE_PATH: undefined },
          resolveCodexGlobalGuidancePaths(settings),
        );

        yield* fileSystem.writeFileString(paths.overrideFilePath, "override\n");

        const guidance = yield* withCommercialHomeEnv(
          { BAHEW_HOME: undefined, MYIDE_ENGINE_HOME: undefined, MYIDE_ENGINE_PATH: undefined },
          readCodexGlobalGuidance(settings),
        );
        expect(guidance.overrideActive).toBe(true);
        expect(guidance.overrideFilePath).toBe(paths.overrideFilePath);
      }),
    );
  });
});
