import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  BUNDLED_EXTENSIONS_PATH_ENV,
  resolveBundledExtensionsRoot,
} from "./BundledExtensions.ts";

describe("BundledExtensions", () => {
  it.effect("优先使用 T3CODE_BUNDLED_EXTENSIONS_PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-bundled-extensions-test-",
      });
      const configuredRoot = path.join(tempRoot, "configured");
      const developmentRoot = path.join(tempRoot, "development");
      yield* fs.makeDirectory(configuredRoot, { recursive: true });
      yield* fs.makeDirectory(developmentRoot, { recursive: true });

      const resolved = yield* resolveBundledExtensionsRoot({
        env: { [BUNDLED_EXTENSIONS_PATH_ENV]: configuredRoot },
        developmentRoot,
      });

      assert.equal(resolved, path.resolve(configuredRoot));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("未配置环境变量时回退到开发目录", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-bundled-extensions-test-",
      });
      const developmentRoot = path.join(tempRoot, "extensions");
      yield* fs.makeDirectory(developmentRoot, { recursive: true });

      const resolved = yield* resolveBundledExtensionsRoot({
        env: {},
        developmentRoot,
      });

      assert.equal(resolved, path.resolve(developmentRoot));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("候选路径都不存在时静默跳过", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-bundled-extensions-test-",
      });

      const resolved = yield* resolveBundledExtensionsRoot({
        env: { [BUNDLED_EXTENSIONS_PATH_ENV]: path.join(tempRoot, "missing-env") },
        developmentRoot: path.join(tempRoot, "missing-dev"),
      });

      assert.equal(resolved, undefined);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
