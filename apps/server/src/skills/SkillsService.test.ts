import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { BUNDLED_EXTENSIONS_PATH_ENV, BUNDLED_SKILL_SOURCE_ID } from "../extensions/BundledExtensions.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";

import {
  type CatalogSkillEntry,
  SkillsCatalogService,
  type SkillsCatalogServiceShape,
} from "./SkillsCatalogService.ts";
import { SkillsService, SkillsServiceLive } from "./SkillsService.ts";

const bundledCatalogItem = {
  id: `${BUNDLED_SKILL_SOURCE_ID}:test-skill`,
  name: "test-skill",
  displayName: "Test Skill",
  description: "测试内置技能",
  shortDescription: "测试内置技能",
  repoPath: "skills/test-skill",
  iconSmall: null,
  iconLarge: null,
  sourceId: BUNDLED_SKILL_SOURCE_ID,
} satisfies CatalogSkillEntry;

const catalogLayer = Layer.succeed(
  SkillsCatalogService,
  SkillsCatalogService.of({
    getCatalog: () =>
      Effect.succeed({
        snapshots: [
          {
            source: {
              id: BUNDLED_SKILL_SOURCE_ID,
              displayName: "Bahew Built-in Skills",
              repo: "t3tools/t3code",
              ref: "bundled",
              curatedPath: "skills",
            },
            fetchedAt: 1,
            skills: [bundledCatalogItem],
          },
        ],
        hasErrors: false,
      }),
    warmUp: Effect.void,
    findCatalogItem: (catalogItemId) =>
      Effect.succeed(catalogItemId === bundledCatalogItem.id ? bundledCatalogItem : undefined),
    resolveVendorAssetPath: () => Effect.succeed(null),
    readCatalogContent: () => Effect.succeed(null),
  } satisfies SkillsCatalogServiceShape),
);

const providerRegistryLayer = Layer.succeed(
  ProviderRegistry,
  ProviderRegistry.of({
    getProviders: Effect.succeed([] satisfies ReadonlyArray<ServerProvider>),
    refresh: () => Effect.succeed([] satisfies ReadonlyArray<ServerProvider>),
    refreshInstance: () => Effect.succeed([] satisfies ReadonlyArray<ServerProvider>),
    getProviderMaintenanceCapabilitiesForInstance: () => Effect.die("unexpected maintenance lookup"),
    setProviderMaintenanceActionState: () =>
      Effect.succeed([] satisfies ReadonlyArray<ServerProvider>),
    streamChanges: Stream.empty,
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

const withHarness = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | FileSystem.FileSystem | Path.Path | ServerConfig | SkillsService
  >,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "t3-skills-service-test-",
    });
    const workspaceCwd = path.join(tempRoot, "workspace");
    const serverBaseDir = path.join(tempRoot, "server-home");
    const codexHome = path.join(tempRoot, "codex-home");
    const extensionsRoot = path.join(tempRoot, "extensions");
    const bundledSkillDir = path.join(extensionsRoot, bundledCatalogItem.repoPath);
    yield* fs.makeDirectory(workspaceCwd, { recursive: true });
    yield* fs.makeDirectory(bundledSkillDir, { recursive: true });
    yield* fs.writeFileString(
      path.join(bundledSkillDir, "SKILL.md"),
      "---\nname: test-skill\ndisplayName: Test Skill\n---\n# Test Skill\n",
    );

    return yield* withProcessEnv(
      { [BUNDLED_EXTENSIONS_PATH_ENV]: extensionsRoot },
      effect,
    ).pipe(
      Effect.provide(
        SkillsServiceLive.pipe(
          Layer.provideMerge(catalogLayer),
          Layer.provideMerge(providerRegistryLayer),
          Layer.provideMerge(
            ServerSettingsService.layerTest({
              providers: {
                codex: {
                  homePath: codexHome,
                },
              },
            }),
          ),
          Layer.provideMerge(ServerConfig.layerTest(workspaceCwd, serverBaseDir)),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("SkillsService bundled skills", () => {
  it.effect("安装内置技能时复制到用户 skill 目录", () =>
    withHarness(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig;
        const service = yield* SkillsService;

        const result = yield* service.install({ catalogItemId: bundledCatalogItem.id });
        const installedSkill = path.join(
          config.baseDir.replace(/server-home$/, "codex-home"),
          "skills",
          "test-skill",
          "SKILL.md",
        );

        assert.deepEqual(result, { marketplaceName: "test-skill", alreadyAdded: false });
        assert.equal(yield* fs.exists(installedSkill), true);
      }),
    ),
  );

  it.effect("同名技能已存在时不会覆盖用户文件", () =>
    withHarness(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig;
        const service = yield* SkillsService;
        const installedSkillDir = path.join(
          config.baseDir.replace(/server-home$/, "codex-home"),
          "skills",
          "test-skill",
        );
        const installedSkillMd = path.join(installedSkillDir, "SKILL.md");
        yield* fs.makeDirectory(installedSkillDir, { recursive: true });
        yield* fs.writeFileString(installedSkillMd, "# 用户已有版本\n");

        const result = yield* service.install({ catalogItemId: bundledCatalogItem.id });

        assert.deepEqual(result, { marketplaceName: "test-skill", alreadyAdded: true });
        assert.equal(yield* fs.readFileString(installedSkillMd), "# 用户已有版本\n");
      }),
    ),
  );
});
