import { assert, describe, it } from "@effect/vitest";

import { buildPluginListCwds } from "./CodexPluginService.ts";

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
});
