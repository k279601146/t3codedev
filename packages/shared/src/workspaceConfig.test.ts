import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { parseMyIdeWorkspaceConfigToml } from "./workspaceConfig.ts";

describe("workspaceConfig", () => {
  it("parses the documented .myide/config.toml shape", () => {
    const config = parseMyIdeWorkspaceConfigToml(`
[project]
name = "My Backend API"
default_model = "claude-3-7-sonnet"

[context]
always_include = [
  "README.md",
  "docs/architecture.md",
  "src/types/index.ts",
]
ignore = ["dist/", "*.min.js", "*.lock"]

[rules]
custom_instructions = """
这个项目使用 Hono 框架，数据库是 PostgreSQL + Drizzle ORM。
"""
`);

    assert.deepEqual(config, {
      project: {
        name: "My Backend API",
        defaultModel: "claude-3-7-sonnet",
      },
      context: {
        alwaysInclude: ["README.md", "docs/architecture.md", "src/types/index.ts"],
        ignore: ["dist/", "*.min.js", "*.lock"],
      },
      rules: {
        customInstructions: "这个项目使用 Hono 框架，数据库是 PostgreSQL + Drizzle ORM。",
      },
    });
  });

  it("deduplicates and drops empty path entries", () => {
    const config = parseMyIdeWorkspaceConfigToml(`
[context]
always_include = [" README.md ", "", "README.md"]
ignore = ["dist/", "dist/"]
`);

    assert.deepEqual(config.context.alwaysInclude, ["README.md"]);
    assert.deepEqual(config.context.ignore, ["dist/"]);
  });
});
