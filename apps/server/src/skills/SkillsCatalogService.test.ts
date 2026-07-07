import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { FetchHttpClient } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import {
  BUNDLED_EXTENSIONS_PATH_ENV,
  BUNDLED_SKILL_SOURCE_ID,
} from "../extensions/BundledExtensions.ts";
import { ProcessRunner } from "../processRunner.ts";

import { SkillsCatalogService, SkillsCatalogServiceLive } from "./SkillsCatalogService.ts";

const processRunnerLayer = Layer.succeed(
  ProcessRunner,
  ProcessRunner.of({
    run: () => Effect.die("bundled skill catalog test should not run git"),
  }),
);

const withProcessEnv = <A, E, R>(
  patch: Record<string, string | undefined>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
      for (const [key, value] of Object.entries(patch)) {
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

describe("SkillsCatalogService bundled skills", () => {
  it.effect("扫描 extensions/skills 中的内置技能", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-skills-catalog-test-",
      });
      const extensionsRoot = path.join(tempRoot, "extensions");
      const skillDir = path.join(extensionsRoot, "skills", "slide-helper");
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "displayName: Slide Helper",
          "description: 生成演示文稿",
          "shortDescription: 制作幻灯片",
          "---",
          "# Slide Helper",
          "",
        ].join("\n"),
      );

      const item = yield* withProcessEnv(
        { [BUNDLED_EXTENSIONS_PATH_ENV]: extensionsRoot },
        Effect.gen(function* () {
          const service = yield* SkillsCatalogService;
          return yield* service.findCatalogItem(`${BUNDLED_SKILL_SOURCE_ID}:slide-helper`);
        }).pipe(
          Effect.provide(
            SkillsCatalogServiceLive.pipe(
              Layer.provideMerge(processRunnerLayer),
              Layer.provideMerge(ServerConfig.layerTest(path.join(tempRoot, "workspace"), {
                prefix: "t3-skills-catalog-home-",
              })),
              Layer.provideMerge(FetchHttpClient.layer),
            ),
          ),
        ),
      );

      assert.equal(item?.id, `${BUNDLED_SKILL_SOURCE_ID}:slide-helper`);
      assert.equal(item?.displayName, "Slide Helper");
      assert.equal(item?.description, "生成演示文稿");
      assert.equal(item?.repoPath, "skills/slide-helper");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("caches catalog results and lets force refresh rescan bundled skills", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-skills-catalog-cache-test-",
      });
      const extensionsRoot = path.join(tempRoot, "extensions");
      const firstSkillDir = path.join(extensionsRoot, "skills", "alpha-helper");
      const secondSkillDir = path.join(extensionsRoot, "skills", "beta-helper");
      yield* fs.makeDirectory(firstSkillDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(firstSkillDir, "SKILL.md"),
        [
          "---",
          "displayName: Alpha Helper",
          "description: First cache-probe skill",
          "---",
          "# Alpha Helper",
          "",
        ].join("\n"),
      );

      const result = yield* withProcessEnv(
        { [BUNDLED_EXTENSIONS_PATH_ENV]: extensionsRoot },
        Effect.gen(function* () {
          const service = yield* SkillsCatalogService;
          const first = yield* service.getCatalog({
            query: "cache-probe",
            page: 1,
            pageSize: 20,
          });
          yield* fs.makeDirectory(secondSkillDir, { recursive: true });
          yield* fs.writeFileString(
            path.join(secondSkillDir, "SKILL.md"),
            [
              "---",
              "displayName: Beta Helper",
              "description: Newly added cache-probe skill",
              "---",
              "# Beta Helper",
              "",
            ].join("\n"),
          );
          const cached = yield* service.getCatalog({
            query: "cache-probe",
            page: 1,
            pageSize: 20,
          });
          const refreshed = yield* service.getCatalog({
            force: true,
            query: "cache-probe",
            page: 1,
            pageSize: 20,
          });
          const namesFrom = (state: typeof first) =>
            state.snapshots.flatMap((snapshot) => snapshot.skills.map((skill) => skill.name));
          return {
            firstNames: namesFrom(first),
            cachedNames: namesFrom(cached),
            refreshedNames: namesFrom(refreshed),
          };
        }).pipe(
          Effect.provide(
            SkillsCatalogServiceLive.pipe(
              Layer.provideMerge(processRunnerLayer),
              Layer.provideMerge(ServerConfig.layerTest(path.join(tempRoot, "workspace"), {
                prefix: "t3-skills-catalog-cache-home-",
              })),
              Layer.provideMerge(FetchHttpClient.layer),
            ),
          ),
        ),
      );

      assert.deepStrictEqual(result.firstNames, ["alpha-helper"]);
      assert.deepStrictEqual(result.cachedNames, ["alpha-helper"]);
      assert.deepStrictEqual(result.refreshedNames, ["alpha-helper", "beta-helper"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
