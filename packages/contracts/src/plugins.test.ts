import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MarketplaceAddInput,
  MarketplaceUpgradeInput,
  PluginInstallInput,
  PluginListResponse,
  PluginReadInput,
  PluginReadResponse,
  PluginSummary,
  PluginUninstallInput,
} from "./plugins.ts";

const decodePluginSummary = Schema.decodeUnknownSync(PluginSummary);
const decodePluginListResponse = Schema.decodeUnknownSync(PluginListResponse);
const decodePluginReadInput = Schema.decodeUnknownSync(PluginReadInput);
const decodePluginReadResponse = Schema.decodeUnknownSync(PluginReadResponse);
const decodePluginInstallInput = Schema.decodeUnknownSync(PluginInstallInput);
const decodePluginUninstallInput = Schema.decodeUnknownSync(PluginUninstallInput);
const decodeMarketplaceAddInput = Schema.decodeUnknownSync(MarketplaceAddInput);
const decodeMarketplaceUpgradeInput = Schema.decodeUnknownSync(MarketplaceUpgradeInput);

const builtinSummary = {
  id: "builtin:browser_use",
  name: "browser_use",
  displayName: "Browser Use",
  description: "内置浏览器能力。",
  installed: true,
  enabled: true,
  authPolicy: "ON_USE",
  installPolicy: "INSTALLED_BY_DEFAULT",
  availability: "AVAILABLE",
  source: { type: "builtin", builtinId: "browser_use" },
  location: {
    pluginName: "browser_use",
    marketplaceName: "T3 Builtins",
    marketplacePath: null,
    remoteMarketplaceName: null,
  },
};

const codexGitSummary = {
  id: "plugin:demo",
  name: "demo",
  displayName: "Demo Plugin",
  installed: false,
  enabled: true,
  authPolicy: "ON_INSTALL",
  installPolicy: "AVAILABLE",
  availability: "AVAILABLE",
  source: {
    type: "codexGit",
    url: "https://github.com/openai/codex-plugins",
    path: "plugins/demo",
    refName: "main",
    sha: "abc123",
  },
  keywords: ["demo"],
  localVersion: null,
  location: {
    pluginName: "demo",
    marketplacePath: null,
    remoteMarketplaceName: "official",
  },
};

describe("PluginSource", () => {
  it("accepts builtin and Codex source variants", () => {
    expect(decodePluginSummary(builtinSummary).source).toEqual({
      type: "builtin",
      builtinId: "browser_use",
    });
    expect(decodePluginSummary(codexGitSummary).source).toMatchObject({
      type: "codexGit",
      url: "https://github.com/openai/codex-plugins",
    });
    expect(
      decodePluginSummary({
        ...codexGitSummary,
        id: "plugin:remote",
        name: "remote_demo",
        displayName: "Remote Demo",
        source: { type: "codexRemote" },
      }).source,
    ).toEqual({ type: "codexRemote" });
    expect(
      decodePluginSummary({
        ...codexGitSummary,
        id: "plugin:local",
        name: "local_demo",
        displayName: "Local Demo",
        source: { type: "codexLocal", path: "/tmp/plugin" },
      }).source,
    ).toEqual({ type: "codexLocal", path: "/tmp/plugin" });
  });
});

describe("PluginListResponse", () => {
  it("decodes marketplaces and defaults optional list fields", () => {
    const parsed = decodePluginListResponse({
      marketplaces: [
        {
          name: "T3 Builtins",
          path: null,
          plugins: [builtinSummary],
        },
        {
          name: "official",
          displayName: "Official Marketplace",
          plugins: [codexGitSummary],
        },
      ],
      builtinPlugins: [builtinSummary],
    });

    expect(parsed.marketplaces).toHaveLength(2);
    expect(parsed.builtinPlugins[0]?.source.type).toBe("builtin");
    expect(parsed.featuredPluginIds).toEqual([]);
    expect(parsed.marketplaceLoadErrors).toEqual([]);
  });
});

describe("Plugin read and install payloads", () => {
  it("decodes Codex-native locator fields", () => {
    expect(
      decodePluginReadInput({
        pluginName: "demo",
        marketplacePath: null,
        remoteMarketplaceName: "official",
      }),
    ).toEqual({
      pluginName: "demo",
      marketplacePath: null,
      remoteMarketplaceName: "official",
    });

    expect(
      decodePluginInstallInput({
        pluginName: "demo",
        marketplacePath: "/tmp/marketplace/plugin.json",
        remoteMarketplaceName: null,
      }),
    ).toEqual({
      pluginName: "demo",
      marketplacePath: "/tmp/marketplace/plugin.json",
      remoteMarketplaceName: null,
    });
  });

  it("decodes plugin detail capabilities", () => {
    const parsed = decodePluginReadResponse({
      plugin: {
        summary: codexGitSummary,
        description: "官方插件详情。",
        marketplaceName: "official",
        marketplacePath: null,
        skills: [{ name: "demo-skill", displayName: "Demo Skill" }],
        apps: [{ id: "app-1", name: "demo-app", title: "Demo App" }],
        appTemplates: [{ id: "template-1", name: "demo-template" }],
        mcpServers: ["demo-mcp"],
        hooks: [{ name: "pre-turn", event: "turn.started" }],
      },
    });

    expect(parsed.plugin.skills[0]?.name).toBe("demo-skill");
    expect(parsed.plugin.mcpServers).toEqual(["demo-mcp"]);
  });
});

describe("Plugin mutation payloads", () => {
  it("decodes uninstall and marketplace payloads", () => {
    expect(decodePluginUninstallInput({ pluginId: "plugin:demo" })).toEqual({
      pluginId: "plugin:demo",
    });
    expect(
      decodeMarketplaceAddInput({
        source: "https://github.com/openai/codex-plugins",
        refName: null,
        sparsePaths: ["marketplaces/official"],
      }),
    ).toEqual({
      source: "https://github.com/openai/codex-plugins",
      refName: null,
      sparsePaths: ["marketplaces/official"],
    });
    expect(decodeMarketplaceUpgradeInput({ marketplaceName: null })).toEqual({
      marketplaceName: null,
    });
  });
});
