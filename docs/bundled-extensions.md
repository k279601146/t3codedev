# T3 Code 内置插件与技能接入指南

本文档说明如何把新的插件或技能作为 T3 Code 商业客户端的内置扩展随包分发。后续新增插件/技能必须优先复用本体系，不要再为单个插件另写一套发现、安装或打包链路。

## 目标

- 项目级内置扩展统一放在仓库根目录 `extensions/`。
- 桌面客户端打包时把 `extensions/` 放入真实文件系统资源目录，运行时通过 `T3CODE_BUNDLED_EXTENSIONS_PATH` 传给 server。
- 用户在客户端里看到内置插件/技能后手动安装，安装结果进入用户自己的 `BAHEW_HOME/agent-data`。
- 内置资源不写入 `.codex`，不污染系统级 Codex 配置，也不把商业客户端做成 Codex 资源目录的简单外壳。

## 目录结构

```text
extensions/
  .agents/plugins/marketplace.json
  plugins/
    <plugin-name>/
      .codex-plugin/plugin.json
      ...
  skills/
    <skill-name>/
      SKILL.md
      ...
  README.md
```

其中：

- `extensions/.agents/plugins/marketplace.json` 是 T3 Code 内置插件 marketplace。
- `extensions/plugins/<plugin-name>/` 存放完整插件快照。
- `extensions/skills/<skill-name>/SKILL.md` 存放独立技能。

## 新增内置插件

1. 把完整插件目录放入：

```text
extensions/plugins/<plugin-name>/
```

2. 插件目录应包含 Codex 兼容 manifest：

```text
extensions/plugins/<plugin-name>/.codex-plugin/plugin.json
```

如果第三方插件只有其他平台 manifest，例如 `.claude-plugin/marketplace.json`，不要删除上游文件；可以额外补 `.codex-plugin/plugin.json` 做 T3/Codex 兼容。

3. 在 `extensions/.agents/plugins/marketplace.json` 登记插件：

```json
{
  "name": "<plugin-name>",
  "source": {
    "source": "local",
    "path": "./plugins/<plugin-name>"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_USE"
  },
  "category": "productivity"
}
```

完整 marketplace 示例：

```json
{
  "name": "t3-bundled-plugins",
  "interface": {
    "displayName": "T3 Code Built-in Plugins"
  },
  "plugins": [
    {
      "name": "ppt-master",
      "source": {
        "source": "local",
        "path": "./plugins/ppt-master"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_USE"
      },
      "category": "productivity"
    }
  ]
}
```

4. 保留第三方插件的 `LICENSE`、`README`、必要脚本、skills、templates、manifest 和运行所需资源。

5. 不要导入无关大体积产物，例如构建输出、缓存、临时目录、用户生成结果、私有测试数据。

## 新增内置技能

独立技能放入：

```text
extensions/skills/<skill-name>/SKILL.md
```

可选资源可以跟随技能目录放置：

```text
extensions/skills/<skill-name>/
  SKILL.md
  assets/
  scripts/
  references/
```

技能进入客户端后只是“可发现/可安装”。用户安装后，server 会复制到：

```text
BAHEW_HOME/agent-data/skills/<skill-name>
```

同名技能已经存在时，不覆盖用户已安装版本。

## 运行时发现链路

server 侧通过 `apps/server/src/extensions/BundledExtensions.ts` 解析内置扩展根目录：

1. 优先读取环境变量 `T3CODE_BUNDLED_EXTENSIONS_PATH`。
2. 开发环境回退到仓库根目录 `extensions/`。
3. 路径不存在时静默跳过，不影响普通插件页。

插件列表由 `CodexPluginService` 把内置扩展根目录追加到 `plugin/list` 的 `cwds`，使运行时发现：

```text
extensions/.agents/plugins/marketplace.json
```

技能目录由 `SkillsCatalogService` 合并远程 catalog 与：

```text
extensions/skills/
```

## 桌面打包链路

桌面构建会把 `extensions/` 作为 Electron `extraResources` 打包到真实文件系统资源目录，例如：

```text
resources/extensions
```

桌面启动时：

- `DesktopEnvironment` 解析 `bundledExtensionsPath`。
- `DesktopBackendConfiguration` 注入 `T3CODE_BUNDLED_EXTENSIONS_PATH`。
- server 通过该路径发现内置插件和技能。

不要把需要 Rust 引擎读取的 marketplace 放进 asar 内部路径。

## 用户安装后的目录

插件安装后进入：

```text
BAHEW_HOME/agent-data/plugins
```

技能安装后进入：

```text
BAHEW_HOME/agent-data/skills
```

开发环境默认 `BAHEW_HOME` 未设置时通常是：

```text
C:\Users\<User>\.bahew
```

所以 Windows 默认安装路径通常类似：

```text
C:\Users\<User>\.bahew\agent-data\plugins
C:\Users\<User>\.bahew\agent-data\skills
```

## 安全要求

- 不要把真实 API Key、`.env`、token、私有证书或客户数据放进 `extensions/`。
- `.env.example` 可以保留，但只能包含注释和占位符。
- 第三方插件如果需要用户自己的 Key，应让用户写入自己的用户级配置或通过 T3 server/网关安全注入。
- 客户端包内资源对最终用户可见，任何进入 `extensions/` 的秘密都等同于泄露。

## 新增插件检查清单

- [ ] 插件目录位于 `extensions/plugins/<plugin-name>/`。
- [ ] 存在 `.codex-plugin/plugin.json`。
- [ ] `extensions/.agents/plugins/marketplace.json` 已登记插件。
- [ ] `source.path` 使用相对路径 `./plugins/<plugin-name>`。
- [ ] 保留上游许可证和来源说明。
- [ ] 未放入真实 `.env`、密钥、缓存或生成结果。
- [ ] 如果插件包含 skills，安装后能通过 `$<skill-name>` 或插件技能发现机制使用。
- [ ] 如果插件依赖外部运行时或 Python/Node 包，已确认目标客户端环境可满足，或已补充安装/降级说明。

## 新增技能检查清单

- [ ] 技能目录位于 `extensions/skills/<skill-name>/`。
- [ ] 存在 `SKILL.md`。
- [ ] `SKILL.md` 的名称、描述和触发方式清晰。
- [ ] 需要的 `assets/`、`scripts/`、`references/` 随目录一起放入。
- [ ] 未放入真实 `.env`、密钥、缓存或用户私有数据。
- [ ] 同名已安装技能不会被覆盖，必要时考虑改名或版本策略。

## 验证建议

最小验证：

```bash
bun run test --filter=@t3tools/server
bun run test --filter=@t3tools/desktop
bun run typecheck
```

只验证相关文件时，可优先跑：

```bash
bunx vitest run apps/server/src/extensions/BundledExtensions.test.ts
bunx vitest run apps/server/src/plugins/CodexPluginService.test.ts
bunx vitest run apps/server/src/skills/SkillsCatalogService.test.ts
bunx vitest run apps/server/src/skills/SkillsService.test.ts
bunx vitest run apps/desktop/src/app/DesktopEnvironment.test.ts
bunx vitest run apps/desktop/src/backend/DesktopBackendConfiguration.test.ts
```

如果只新增资源文件且未改代码，至少检查：

```bash
git diff --check
```

## 不要做的事

- 不要把内置插件放到 `.codex`、用户 home、`apps/server/resources` 或其他临时目录。
- 不要把某个插件硬编码进 `BUILTIN_PLUGINS`，除非它是 T3 自有桥接插件，例如 Browser / Computer / Chrome 这类运行时能力。
- 不要为了一个新插件新增独立的 server/web/desktop 发现链路。
- 不要在 UI 中伪造插件能力。入口应调用现有 `plugins.list/read/install/uninstall` 或 `skills.catalog/install/list`，并反映真实安装状态。
- 不要自动覆盖用户已经安装的同名插件或技能。
