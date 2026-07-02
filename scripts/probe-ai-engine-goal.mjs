import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultEngineName,
  getDefaultEnginePath,
  parsePositiveInt,
  withAiEngineRpc,
} from "./lib/ai-engine-probe.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultEnginePath = getDefaultEnginePath(repoRoot);
const fakeThreadId = "00000000-0000-0000-0000-000000000000";

function parseArgs(argv) {
  const options = {
    enginePath: process.env.MYIDE_ENGINE_PATH || defaultEnginePath,
    timeoutMs: 8_000,
    port: undefined,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (arg === "--engine") {
      const value = argv[index + 1];
      if (!value) failUsage("--engine 需要一个路径");
      options.enginePath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--engine=")) {
      options.enginePath = arg.slice("--engine=".length);
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = argv[index + 1];
      if (!value) failUsage("--timeout-ms 需要一个数字");
      options.timeoutMs = parseArgPositiveInt(value, "--timeout-ms");
      index += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parseArgPositiveInt(arg.slice("--timeout-ms=".length), "--timeout-ms");
      continue;
    }
    if (arg === "--port") {
      const value = argv[index + 1];
      if (!value) failUsage("--port 需要一个数字");
      options.port = parseArgPositiveInt(value, "--port");
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = parseArgPositiveInt(arg.slice("--port=".length), "--port");
      continue;
    }
    if (!arg.startsWith("-") && options.enginePath === defaultEnginePath) {
      options.enginePath = arg;
      continue;
    }
    failUsage(`未知参数: ${arg}`);
  }

  return {
    ...options,
    enginePath: path.resolve(options.enginePath),
  };
}

function parseArgPositiveInt(value, name) {
  try {
    return parsePositiveInt(value, name);
  } catch (error) {
    failUsage(error instanceof Error ? error.message : String(error));
  }
}

function printUsage() {
  console.log(`用法:
  node scripts/probe-ai-engine-goal.mjs [enginePath]
  node scripts/probe-ai-engine-goal.mjs --engine <path> [--timeout-ms 8000] [--port 49888]

说明:
  默认检查 apps/desktop/bin/${defaultEngineName}
  也可通过 MYIDE_ENGINE_PATH 或 --engine 指定其它 ai-engine 二进制`);
}

function failUsage(message) {
  console.error(`参数错误: ${message}`);
  console.error("运行 node scripts/probe-ai-engine-goal.mjs --help 查看用法。");
  process.exit(1);
}

function classifyGoalResponse(response) {
  if (response?.result && Object.hasOwn(response.result, "goal")) {
    return {
      ok: true,
      title: "支持 goal capability",
      detail: "thread/goal/get 返回了正常结果。",
    };
  }

  const errorMessage = String(response?.error?.message ?? "");
  if (errorMessage.includes("thread not found")) {
    return {
      ok: true,
      title: "支持 goal capability",
      detail: "thread/goal/get 已被识别并执行到线程查询阶段；假的 threadId 不存在是预期结果。",
    };
  }
  if (errorMessage.includes("goals feature is disabled")) {
    return {
      ok: false,
      title: "不支持可用的 goal capability",
      detail: "二进制包含 goal RPC，但运行时 goals feature 被关闭。",
    };
  }
  if (errorMessage.includes("Method not found") || errorMessage.includes("method not found")) {
    return {
      ok: false,
      title: "不支持 goal 协议",
      detail: "ai-engine 不认识 thread/goal/get。",
    };
  }
  if (errorMessage.includes("requires experimentalApi capability")) {
    return {
      ok: false,
      title: "goal 被 experimentalApi 门禁拦截",
      detail: "探针已经声明 experimentalApi=true，仍被拒绝，说明协议或初始化逻辑可能不匹配。",
    };
  }

  return {
    ok: false,
    title: "无法确认 goal capability",
    detail: errorMessage || `未知响应: ${JSON.stringify(response)}`,
  };
}

function printProbeError(error) {
  console.error(`探针失败: ${error instanceof Error ? error.message : String(error)}`);
  const stderrLines = error instanceof Error && Array.isArray(error.stderrLines) ? error.stderrLines : [];
  if (stderrLines.length > 0) {
    console.error("ai-engine stderr:");
    for (const line of stderrLines.slice(-10)) console.error(line);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.enginePath)) {
    console.error(`未找到 ai-engine: ${options.enginePath}`);
    process.exit(1);
  }

  try {
    await withAiEngineRpc(
      {
        repoRoot,
        enginePath: options.enginePath,
        timeoutMs: options.timeoutMs,
        port: options.port,
        verbose: options.verbose,
        homePrefix: "ai-engine-goal-probe",
        clientInfo: {
          name: "t3-goal-probe",
          title: "T3 Goal Probe",
          version: "0.0.0",
        },
      },
      async ({ client, probeHome }) => {
        const response = await client.requestRaw("thread/goal/get", { threadId: fakeThreadId });
        const result = classifyGoalResponse(response);
        console.log(`${result.ok ? "OK" : "FAIL"}: ${result.title}`);
        console.log(result.detail);
        console.log(`engine: ${options.enginePath}`);
        console.log(`CODEX_HOME(probe): ${probeHome}`);
        if (options.verbose) {
          console.log(`raw response: ${JSON.stringify(response)}`);
        }
        process.exitCode = result.ok ? 0 : 2;
      },
    );
  } catch (error) {
    printProbeError(error);
    process.exitCode = 1;
  }
}

main();
