做好了。新增了一个通用能力探针：

- [scripts/probe-ai-engine-capabilities.mjs](D:/workspace/t3codedev/scripts/probe-ai-engine-capabilities.mjs)：查询 `ai-engine.exe` 的 feature flags、provider capabilities、goal RPC、permission profiles、collaboration modes、skills、hooks、plugins、apps。
- [scripts/lib/ai-engine-probe.mjs](D:/workspace/t3codedev/scripts/lib/ai-engine-probe.mjs)：复用启动 `ai-engine`、连接 WebSocket、初始化 JSON-RPC、清理临时 `CODEX_HOME` 的逻辑。
- [scripts/probe-ai-engine-goal.mjs](D:/workspace/t3codedev/scripts/probe-ai-engine-goal.mjs)：已切到公共探针逻辑。
- [package.json](D:/workspace/t3codedev/package.json)：新增 `probe:engine`，保留 `probe:goal`。

用法：

```bash
bun run probe:engine
bun run probe:engine --json
bun run probe:goal
```

我已做轻量验证：`node --check` 通过；`bun run probe:goal` 通过；`bun run probe:engine` 成功连上当前 `D:\workspace\t3codedev\apps\desktop\bin\ai-engine.exe`。当前探测结果里 feature flags 为开启 27、未开启 56，`goals` 开启，provider 的 `imageGeneration`、`namespaceTools`、`webSearch` 都开启。

补一句边界：JSON-RPC 本身没有安全的“运行时全量方法枚举”接口，所以这个脚本报告的是 `ai-engine` 当前公开可查询的 feature flags 加安全只读能力 RPC，不会去暴力调用可能有副作用的方法。Goal 已完成，本目标累计用量 `147556` tokens，用时约 47 分钟。