# T3 Code 内置扩展

这个目录存放随 T3 Code 商业客户端一起打包分发的内置插件和技能。

- `plugins/`：完整插件目录，每个插件应包含 `.codex-plugin/plugin.json`。
- `.agents/plugins/marketplace.json`：T3 Code 内置插件 marketplace，server 会把本目录作为本地 marketplace root 传给运行时。
- `skills/`：独立技能目录，每个技能使用 `<name>/SKILL.md` 结构。

内置扩展不会自动写入用户目录。用户在客户端安装后，运行时会把插件或技能安装到 `BAHEW_HOME/agent-data/plugins` 或 `BAHEW_HOME/agent-data/skills`。

导入第三方插件时请保留上游许可证和来源说明；不要把大体积生成物、缓存、示例输出或私有数据放进客户端包。
