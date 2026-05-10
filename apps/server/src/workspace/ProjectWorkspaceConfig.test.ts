// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectWorkspaceConfig from "./ProjectWorkspaceConfig.ts";

const layer = ProjectWorkspaceConfig.layer.pipe(Layer.provideMerge(NodeServices.layer));

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3-project-workspace-config-"));
  fs.mkdirSync(path.join(workspaceRoot, ".myide"), { recursive: true });
  return workspaceRoot;
}

describe("ProjectWorkspaceConfig", () => {
  it.effect("reads .myide/config.toml and builds a bounded prompt prefix", () =>
    Effect.gen(function* () {
      const workspaceRoot = makeWorkspace();
      fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# API\nUse Hono.\n", "utf8");
      fs.writeFileSync(
        path.join(workspaceRoot, ".myide", "config.toml"),
        `
[project]
name = "Configured Project"
default_model = "claude-3-7-sonnet"

[context]
always_include = ["README.md"]
ignore = ["dist/"]

[rules]
custom_instructions = """
Use PostgreSQL + Drizzle ORM.
"""
`,
        "utf8",
      );

      const service = yield* ProjectWorkspaceConfig.ProjectWorkspaceConfig;
      const config = yield* service.read(workspaceRoot);
      const promptContext = yield* service.buildPromptContext(workspaceRoot);

      assert.equal(Option.isSome(config), true);
      if (Option.isSome(config)) {
        assert.equal(config.value.project.name, "Configured Project");
        assert.equal(config.value.project.defaultModel, "claude-3-7-sonnet");
      }
      assert.equal(Option.isSome(promptContext), true);
      if (Option.isSome(promptContext)) {
        assert.match(promptContext.value.promptPrefix ?? "", /Use PostgreSQL/);
        assert.match(promptContext.value.promptPrefix ?? "", /README.md/);
        assert.match(promptContext.value.promptPrefix ?? "", /Use Hono/);
      }
    }).pipe(Effect.provide(layer)),
  );

  it.effect("ignores always_include paths outside the workspace", () =>
    Effect.gen(function* () {
      const workspaceRoot = makeWorkspace();
      fs.writeFileSync(
        path.join(workspaceRoot, ".myide", "config.toml"),
        `
[context]
always_include = ["../outside.txt"]
`,
        "utf8",
      );

      const service = yield* ProjectWorkspaceConfig.ProjectWorkspaceConfig;
      const promptContext = yield* service.buildPromptContext(workspaceRoot);

      assert.equal(Option.isSome(promptContext), true);
      if (Option.isSome(promptContext)) {
        assert.equal(promptContext.value.promptPrefix, undefined);
      }
    }).pipe(Effect.provide(layer)),
  );
});
