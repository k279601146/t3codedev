import { assert, describe, it } from "@effect/vitest";

import { buildPluginListCwds, isPluginListCacheEntryFresh } from "./CodexPluginService.ts";

describe("CodexPluginService", () => {
  it("插件列表会保留工作区 cwd 并追加内置扩展根目录", () => {
    assert.deepEqual(
      buildPluginListCwds({
        workspaceCwd: "/workspace/project",
        bundledExtensionsRoot: "/opt/t3/resources/extensions",
      }),
      ["/workspace/project", "/opt/t3/resources/extensions"],
    );
  });

  it("未发现内置扩展目录时只传工作区 cwd", () => {
    assert.deepEqual(
      buildPluginListCwds({
        workspaceCwd: "/workspace/project",
        bundledExtensionsRoot: undefined,
      }),
      ["/workspace/project"],
    );
  });
  it("插件列表缓存只在 TTL 内命中", () => {
    const entry = {
      expiresAtMs: 1_030,
      value: {
        marketplaces: [],
        builtinPlugins: [],
        featuredPluginIds: [],
        marketplaceLoadErrors: [],
      },
    };

    assert.equal(isPluginListCacheEntryFresh(entry, 1_000), true);
    assert.equal(isPluginListCacheEntryFresh(entry, 1_030), false);
    assert.equal(isPluginListCacheEntryFresh(null, 1_000), false);
  });
});
