import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const commercialEngineFeaturePolicyPath = path.join(
  repoRoot,
  "packages",
  "shared",
  "src",
  "commercialEngineFeaturePolicy.json",
);
const commercialEngineFeaturePolicy = JSON.parse(
  readFileSync(commercialEngineFeaturePolicyPath, "utf8"),
);
const managedEnabledFeatureKeys = new Set(commercialEngineFeaturePolicy.enabledFeatureKeys ?? []);
const managedExcludedFeatureKeys = new Set(commercialEngineFeaturePolicy.excludedFeatureKeys ?? []);
const codexModelInfoRequiredFields = [
  "slug",
  "display_name",
  "shell_type",
  "visibility",
  "supported_in_api",
  "base_instructions",
  "truncation_policy",
  "supports_parallel_tool_calls",
  "apply_patch_tool_type",
];

function parseArgs(argv) {
  const options = {
    enginePath: process.env.MYIDE_ENGINE_PATH || defaultEnginePath,
    timeoutMs: 10_000,
    port: undefined,
    json: false,
    verbose: false,
    managed: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (arg === "--raw-engine-defaults") {
      options.managed = false;
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
  node scripts/probe-ai-engine-capabilities.mjs [enginePath]
  node scripts/probe-ai-engine-capabilities.mjs --engine <path> [--json] [--timeout-ms 10000] [--port 49888]

说明:
  默认检查 apps/desktop/bin/${defaultEngineName}
  也可通过 MYIDE_ENGINE_PATH 或 --engine 指定其它 ai-engine 二进制
  --json 输出完整机器可读报告
  --raw-engine-defaults 不写入 T3 托管 config.toml，仅查看 ai-engine 裸默认开关`);
}

function failUsage(message) {
  console.error(`参数错误: ${message}`);
  console.error("运行 node scripts/probe-ai-engine-capabilities.mjs --help 查看用法。");
  process.exit(1);
}

function getRpcErrorMessage(response) {
  return String(response?.error?.message ?? response?.error ?? "");
}

function classifyRpcError(message) {
  if (message.includes("Method not found") || message.includes("method not found")) {
    return "unsupported";
  }
  if (message.includes("feature is disabled")) {
    return "disabled";
  }
  if (message.includes("requires experimentalApi capability")) {
    return "disabled";
  }
  return "unavailable";
}

async function safeRequest(client, method, params, summarize) {
  try {
    const response = await client.requestRaw(method, params);
    if (response?.error) {
      const message = getRpcErrorMessage(response);
      return {
        method,
        status: classifyRpcError(message),
        error: message,
      };
    }
    const result = response?.result;
    return {
      method,
      status: "available",
      summary: summarize ? summarize(result) : undefined,
      result,
    };
  } catch (error) {
    return {
      method,
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function safePagedRequest(client, method, baseParams, summarize) {
  try {
    const data = [];
    let nextCursor = null;
    let pageCount = 0;
    do {
      const result = await client.request(method, {
        ...baseParams,
        cursor: nextCursor,
        limit: baseParams.limit ?? 100,
      });
      const pageData = Array.isArray(result?.data) ? result.data : [];
      data.push(...pageData);
      nextCursor = result?.nextCursor ?? null;
      pageCount += 1;
    } while (nextCursor && pageCount < 100);

    const result = {
      data,
      nextCursor,
      truncated: Boolean(nextCursor),
    };
    return {
      method,
      status: "available",
      summary: summarize ? summarize(result) : undefined,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      method,
      status: classifyRpcError(message),
      error: message,
    };
  }
}

async function listExperimentalFeatures(client) {
  const data = [];
  let nextCursor = null;
  let pageCount = 0;
  do {
    const result = await client.request("experimentalFeature/list", {
      cursor: nextCursor,
      limit: 100,
    });
    if (!Array.isArray(result?.data)) {
      throw new Error("experimentalFeature/list 返回缺少 data 数组");
    }
    data.push(...result.data);
    nextCursor = result.nextCursor ?? null;
    pageCount += 1;
  } while (nextCursor && pageCount < 100);

  return {
    status: "available",
    enabledCount: data.filter((feature) => feature?.enabled === true).length,
    disabledCount: data.filter((feature) => feature?.enabled !== true).length,
    data,
    nextCursor,
    truncated: Boolean(nextCursor),
  };
}

function renderManagedTomlConfig() {
  const featureLines = [...managedEnabledFeatureKeys].map((key) => `${key} = true`).join("\n");
  const windowsConfig =
    process.platform === "win32" ? '\n[windows]\nsandbox = "elevated"\n' : "";
  return `
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "user"
disable_telemetry = true

[sandbox_workspace_write]
network_access = false

[features]
${featureLines}

[shell_environment_policy]
include_only = ["PATH", "HOME", "LANG", "TERM", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot", "SystemDrive", "HOMEDRIVE", "HOMEPATH"]
${windowsConfig}
  `.trim();
}

function classifyFeatureFlags(featureFlags, managedMode) {
  if (featureFlags.status !== "available") return featureFlags;
  if (!managedMode) {
    const data = Array.isArray(featureFlags.data) ? featureFlags.data : [];
    const removed = data.filter((feature) => String(feature?.stage ?? "").toLowerCase() === "removed");
    const nonRemoved = data.filter((feature) => String(feature?.stage ?? "").toLowerCase() !== "removed");
    return {
      ...featureFlags,
      managedMode: false,
      enabled: nonRemoved.filter((feature) => feature?.enabled === true),
      unexpectedOff: nonRemoved.filter((feature) => feature?.enabled !== true),
      removed,
      enabledCount: nonRemoved.filter((feature) => feature?.enabled === true).length,
      unexpectedOffCount: nonRemoved.filter((feature) => feature?.enabled !== true).length,
      removedCount: removed.length,
    };
  }

  const data = Array.isArray(featureFlags.data) ? featureFlags.data : [];
  const seen = new Set(data.map((feature) => feature?.name).filter((name) => typeof name === "string"));
  const enabled = [];
  const unexpectedOff = [];
  const excluded = [];
  const removed = [];
  const otherOff = [];

  for (const feature of data) {
    const name = feature?.name;
    const stage = String(feature?.stage ?? "").toLowerCase();
    if (stage === "removed") {
      removed.push(feature);
    } else if (feature?.enabled === true) {
      enabled.push(feature);
    } else if (typeof name === "string" && managedExcludedFeatureKeys.has(name)) {
      excluded.push(feature);
    } else if (typeof name === "string" && managedEnabledFeatureKeys.has(name)) {
      unexpectedOff.push(feature);
    } else {
      otherOff.push(feature);
    }
  }

  const missingManagedFeatureKeys = [...managedEnabledFeatureKeys].filter((key) => !seen.has(key));
  return {
    ...featureFlags,
    managedMode: true,
    enabled,
    unexpectedOff,
    excluded,
    removed,
    otherOff,
    missingManagedFeatureKeys,
    enabledCount: enabled.length,
    unexpectedOffCount: unexpectedOff.length,
    excludedCount: excluded.length,
    removedCount: removed.length,
    otherOffCount: otherOff.length,
  };
}

async function probeEngineModelList(client) {
  return safePagedRequest(client, "model/list", { includeHidden: true, limit: 100 }, (result) =>
    summarizeDataList(result, ["id", "model", "displayName"]),
  );
}

function gatewayModelsUrl() {
  const baseUrl = (
    process.env.MYIDE_GATEWAY_BASE_URL ||
    process.env.MYIDE_API_URL ||
    "https://sub.bahew.com/v1"
  ).trim();
  const url = new URL(baseUrl);
  url.hash = "";
  url.search = "";
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath === "" ? "/v1" : normalizedPath;
  return `${url.toString().replace(/\/$/, "")}/models`;
}

function readRecordString(record, key) {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function modelEntriesFromGatewayBody(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.models)) return body.models;
  return null;
}

function summarizeGatewayModelCatalogBody(body) {
  const entries = modelEntriesFromGatewayBody(body);
  if (!entries) {
    return {
      validModelList: false,
      modelCount: 0,
      nativeApplyPatchReadyCount: 0,
      models: [],
      error: "响应缺少 data/models 数组",
    };
  }

  const models = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const id = readRecordString(entry, "id") ?? readRecordString(entry, "slug") ?? "(missing id)";
    const applyPatchToolType = readRecordString(entry, "apply_patch_tool_type") ?? null;
    const missingNativeApplyPatchFields = codexModelInfoRequiredFields.filter(
      (field) => !Object.hasOwn(entry, field) || entry[field] === null || entry[field] === undefined,
    );
    models.push({
      id,
      applyPatchToolType,
      nativeApplyPatchReady:
        missingNativeApplyPatchFields.length === 0 && applyPatchToolType === "freeform",
      missingNativeApplyPatchFields,
    });
  }

  return {
    validModelList: true,
    modelCount: models.length,
    nativeApplyPatchReadyCount: models.filter((model) => model.nativeApplyPatchReady).length,
    models: models.slice(0, 20),
  };
}

async function probeGatewayModelCatalog() {
  const token = process.env.MYIDE_IDE_JWT?.trim();
  if (!token) {
    return {
      status: "unavailable",
      summary: "未设置 MYIDE_IDE_JWT，跳过商业网关 /models 原始响应检查",
    };
  }

  const url = gatewayModelsUrl();
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      return {
        status: "unavailable",
        summary: `网关返回 HTTP ${response.status}`,
        url,
      };
    }
    const body = await response.json();
    return {
      status: "available",
      url,
      summary: summarizeGatewayModelCatalogBody(body),
    };
  } catch (error) {
    return {
      status: "unavailable",
      summary: error instanceof Error ? error.message : String(error),
      url,
    };
  }
}

function classifyGoalResponse(response) {
  if (response?.result && Object.hasOwn(response.result, "goal")) {
    return {
      method: "thread/goal/get",
      status: "enabled",
      summary: "返回了正常结果",
      result: response.result,
    };
  }

  const message = getRpcErrorMessage(response);
  if (message.includes("thread not found")) {
    return {
      method: "thread/goal/get",
      status: "enabled",
      summary: "RPC 存在且 goals feature 已开启；假的 threadId 不存在是预期结果",
      error: message,
    };
  }
  if (message.includes("goals feature is disabled")) {
    return {
      method: "thread/goal/get",
      status: "disabled",
      summary: "RPC 存在，但 goals feature 未开启",
      error: message,
    };
  }
  if (message.includes("Method not found") || message.includes("method not found")) {
    return {
      method: "thread/goal/get",
      status: "unsupported",
      summary: "ai-engine 不认识 thread/goal/get",
      error: message,
    };
  }
  return {
    method: "thread/goal/get",
    status: "unknown",
    summary: message || "未知响应",
    error: message || JSON.stringify(response),
  };
}

async function probeGoal(client) {
  try {
    const response = await client.requestRaw("thread/goal/get", { threadId: fakeThreadId });
    return classifyGoalResponse(response);
  } catch (error) {
    return {
      method: "thread/goal/get",
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeDataList(result, nameKeys = ["name", "id", "title"]) {
  const data = Array.isArray(result?.data) ? result.data : [];
  return {
    count: data.length,
    names: data.slice(0, 20).map((item) => pickName(item, nameKeys)).filter(Boolean),
    truncated: Boolean(result?.truncated),
  };
}

function summarizeProviderCapabilities(result) {
  return Object.fromEntries(
    Object.entries(result ?? {}).map(([name, value]) => [name, value === true ? "enabled" : "disabled"]),
  );
}

function summarizePluginList(result) {
  const marketplaces = Array.isArray(result?.marketplaces) ? result.marketplaces : [];
  const plugins = marketplaces.flatMap((marketplace) => {
    if (Array.isArray(marketplace?.plugins)) return marketplace.plugins;
    if (Array.isArray(marketplace?.entries)) return marketplace.entries;
    return [];
  });
  return {
    marketplaceCount: marketplaces.length,
    pluginCount: plugins.length,
    loadErrorCount: Array.isArray(result?.marketplaceLoadErrors) ? result.marketplaceLoadErrors.length : 0,
    featuredPluginCount: Array.isArray(result?.featuredPluginIds) ? result.featuredPluginIds.length : 0,
  };
}

function summarizeSkillsList(result) {
  const cwdEntries = Array.isArray(result?.data) ? result.data : [];
  const skills = cwdEntries.flatMap((entry) => (Array.isArray(entry?.skills) ? entry.skills : []));
  return {
    cwdCount: cwdEntries.length,
    skillCount: skills.length,
    enabledCount: skills.filter((skill) => skill?.enabled === true).length,
    disabledCount: skills.filter((skill) => skill?.enabled === false).length,
    errorCount: cwdEntries.reduce((count, entry) => count + (Array.isArray(entry?.errors) ? entry.errors.length : 0), 0),
    names: skills.slice(0, 20).map((item) => pickName(item, ["name", "displayName", "path"])).filter(Boolean),
  };
}

function summarizeHooksList(result) {
  const cwdEntries = Array.isArray(result?.data) ? result.data : [];
  const hooks = cwdEntries.flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : []));
  return {
    cwdCount: cwdEntries.length,
    hookCount: hooks.length,
    errorCount: cwdEntries.reduce((count, entry) => count + (Array.isArray(entry?.errors) ? entry.errors.length : 0), 0),
    warningCount: cwdEntries.reduce(
      (count, entry) => count + (Array.isArray(entry?.warnings) ? entry.warnings.length : 0),
      0,
    ),
    names: hooks.slice(0, 20).map((item) => pickName(item, ["name", "path", "event"])).filter(Boolean),
  };
}

function summarizeApps(result) {
  const data = Array.isArray(result?.data) ? result.data : [];
  return {
    count: data.length,
    enabledCount: data.filter((app) => app?.isEnabled === true).length,
    disabledCount: data.filter((app) => app?.isEnabled === false).length,
    accessibleCount: data.filter((app) => app?.isAccessible === true).length,
    inaccessibleCount: data.filter((app) => app?.isAccessible === false).length,
    names: data.slice(0, 20).map((item) => pickName(item)).filter(Boolean),
    truncated: Boolean(result?.truncated),
  };
}

function pickName(item, keys = ["name", "id", "title", "displayName"]) {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

async function buildReport(client, initializeResult, enginePath, managedMode) {
  let featureFlags;
  try {
    featureFlags = await listExperimentalFeatures(client);
  } catch (error) {
    featureFlags = {
      status: classifyRpcError(error instanceof Error ? error.message : String(error)),
      error: error instanceof Error ? error.message : String(error),
      data: [],
      enabledCount: 0,
      disabledCount: 0,
    };
  }

  featureFlags = classifyFeatureFlags(featureFlags, managedMode);

  const [
    providerCapabilities,
    goal,
    engineModels,
    gatewayModels,
    permissionProfiles,
    collaborationModes,
    skills,
    hooks,
    plugins,
    apps,
  ] = await Promise.all([
    safeRequest(client, "modelProvider/capabilities/read", {}, summarizeProviderCapabilities),
    probeGoal(client),
    probeEngineModelList(client),
    probeGatewayModelCatalog(),
    safePagedRequest(client, "permissionProfile/list", { cwd: repoRoot }, (result) =>
      summarizeDataList(result, ["id", "name", "displayName"]),
    ),
    safeRequest(client, "collaborationMode/list", {}, (result) =>
      summarizeDataList(result, ["name", "mode", "model"]),
    ),
    safeRequest(client, "skills/list", { cwds: [repoRoot], forceReload: false }, summarizeSkillsList),
    safeRequest(client, "hooks/list", { cwds: [repoRoot] }, summarizeHooksList),
    safeRequest(client, "plugin/list", { cwds: [repoRoot] }, summarizePluginList),
    safePagedRequest(client, "app/list", { limit: 100 }, summarizeApps),
  ]);

  return {
    probedAt: new Date().toISOString(),
    engine: enginePath,
    probeMode: managedMode ? "t3-managed" : "raw-engine-defaults",
    note:
      "JSON-RPC 协议没有安全的运行时全量方法枚举；本报告覆盖 ai-engine 公开可查询的 feature flags、provider capabilities 和安全只读能力 RPC。",
    initialize: initializeResult,
    featureFlags,
    providerCapabilities,
    runtimeRpc: {
      goal,
    },
    modelCatalog: {
      engineModels,
      gatewayModels,
    },
    catalog: {
      permissionProfiles,
      collaborationModes,
      skills,
      hooks,
      plugins,
      apps,
    },
  };
}

function printHumanReport(report) {
  console.log("ai-engine 能力总览");
  console.log(`engine: ${report.engine}`);
  console.log(`mode: ${report.probeMode}`);
  console.log(`time: ${report.probedAt}`);
  console.log("说明: JSON-RPC 没有安全的运行时全量方法枚举；这里展示公开可查询的 feature flags 和安全只读能力。");
  console.log("");

  printFeatureFlags(report.featureFlags);
  printProviderCapabilities(report.providerCapabilities);
  printRuntimeRpc(report.runtimeRpc);
  printModelCatalog(report.modelCatalog);
  printCatalog(report.catalog);
}

function printFeatureFlags(featureFlags) {
  console.log(`Feature flags: ${statusLabel(featureFlags.status)}`);
  if (featureFlags.status !== "available") {
    console.log(`  error: ${featureFlags.error ?? "未知错误"}`);
    console.log("");
    return;
  }

  console.log(`  开启: ${featureFlags.enabledCount}`);
  for (const feature of featureFlags.enabled ?? featureFlags.data.filter((item) => item?.enabled === true)) {
    console.log(`    [ON] ${formatFeature(feature)}`);
  }
  console.log(`  异常未开启: ${featureFlags.unexpectedOffCount ?? featureFlags.disabledCount}`);
  for (const feature of featureFlags.unexpectedOff ?? featureFlags.data.filter((item) => item?.enabled !== true)) {
    console.log(`    [OFF] ${formatFeature(feature)}`);
  }
  if (Array.isArray(featureFlags.excluded) && featureFlags.excluded.length > 0) {
    console.log(`  已排除: ${featureFlags.excludedCount}`);
    for (const feature of featureFlags.excluded) {
      console.log(`    [SKIP] ${formatFeature(feature)}`);
    }
  }
  if (Array.isArray(featureFlags.removed) && featureFlags.removed.length > 0) {
    console.log(`  Removed 不适用: ${featureFlags.removedCount}`);
    for (const feature of featureFlags.removed) {
      console.log(`    [REMOVED] ${formatFeature(feature)}`);
    }
  }
  if (Array.isArray(featureFlags.otherOff) && featureFlags.otherOff.length > 0) {
    console.log(`  其它未托管 OFF: ${featureFlags.otherOffCount}`);
    for (const feature of featureFlags.otherOff) {
      console.log(`    [OFF] ${formatFeature(feature)}`);
    }
  }
  if (Array.isArray(featureFlags.missingManagedFeatureKeys) && featureFlags.missingManagedFeatureKeys.length > 0) {
    console.log(`  托管配置中存在但当前 engine 未上报: ${featureFlags.missingManagedFeatureKeys.join(", ")}`);
  }
  if (featureFlags.truncated) {
    console.log("  注意: 结果超过分页上限，输出已截断。");
  }
  console.log("");
}

function formatFeature(feature) {
  const name = feature?.name ?? "(unknown)";
  const stage = feature?.stage ?? "unknown";
  const defaultState = feature?.defaultEnabled === true ? "default:on" : "default:off";
  const displayName = feature?.displayName ? ` - ${feature.displayName}` : "";
  return `${name} (${stage}, ${defaultState})${displayName}`;
}

function printProviderCapabilities(providerCapabilities) {
  console.log(`Provider capabilities: ${statusLabel(providerCapabilities.status)}`);
  if (providerCapabilities.status !== "available") {
    console.log(`  error: ${providerCapabilities.error ?? "未知错误"}`);
    console.log("");
    return;
  }
  for (const [name, state] of Object.entries(providerCapabilities.summary ?? {})) {
    console.log(`  ${name}: ${state === "enabled" ? "开启" : "未开启"}`);
  }
  console.log("");
}

function printRuntimeRpc(runtimeRpc) {
  console.log("Runtime RPC probes:");
  for (const probe of Object.values(runtimeRpc)) {
    console.log(`  ${probe.method}: ${statusLabel(probe.status)}${probe.summary ? ` - ${probe.summary}` : ""}`);
  }
  console.log("");
}

function printModelCatalog(modelCatalog) {
  console.log("Model catalog probes:");
  const engineModels = modelCatalog.engineModels;
  console.log(
    `  engine model/list: ${statusLabel(engineModels.status)}${
      engineModels.summary ? ` - ${formatSummary(engineModels.summary)}` : ""
    }`,
  );
  if (engineModels.status !== "available" && engineModels.error) {
    console.log(`    error: ${engineModels.error}`);
  }

  const gatewayModels = modelCatalog.gatewayModels;
  if (gatewayModels.status !== "available") {
    console.log(`  gateway /models: ${statusLabel(gatewayModels.status)} - ${gatewayModels.summary ?? ""}`);
    console.log("");
    return;
  }

  const summary = gatewayModels.summary;
  console.log(
    `  gateway /models: 可用 - modelCount=${summary.modelCount}; nativeApplyPatchReady=${summary.nativeApplyPatchReadyCount}`,
  );
  for (const model of summary.models ?? []) {
    const missing =
      model.missingNativeApplyPatchFields.length > 0
        ? `; missing=${model.missingNativeApplyPatchFields.join(",")}`
        : "";
    console.log(
      `    ${model.nativeApplyPatchReady ? "[PATCH]" : "[NO-PATCH]"} ${model.id}; applyPatchToolType=${
        model.applyPatchToolType ?? "null"
      }${missing}`,
    );
  }
  console.log("");
}

function printCatalog(catalog) {
  console.log("Catalog/list capabilities:");
  for (const [name, probe] of Object.entries(catalog)) {
    const summary = formatSummary(probe.summary);
    console.log(`  ${name}: ${statusLabel(probe.status)}${summary ? ` - ${summary}` : ""}`);
    if (probe.status !== "available" && probe.error) {
      console.log(`    error: ${probe.error}`);
    }
  }
}

function formatSummary(summary) {
  if (!summary) return "";
  const parts = [];
  for (const [key, value] of Object.entries(summary)) {
    if (Array.isArray(value)) {
      if (value.length > 0) parts.push(`${key}=${value.join(", ")}`);
      continue;
    }
    parts.push(`${key}=${value}`);
  }
  return parts.join("; ");
}

function statusLabel(status) {
  switch (status) {
    case "available":
      return "可用";
    case "enabled":
      return "开启";
    case "disabled":
      return "未开启";
    case "unsupported":
      return "不支持";
    case "unavailable":
      return "不可用";
    case "unknown":
      return "未知";
    default:
      return String(status ?? "未知");
  }
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
    const report = await withAiEngineRpc(
      {
        repoRoot,
        enginePath: options.enginePath,
        timeoutMs: options.timeoutMs,
        port: options.port,
        verbose: options.verbose,
        homePrefix: "ai-engine-capability-probe",
        clientInfo: {
          name: "t3-capability-probe",
          title: "T3 Capability Probe",
          version: "0.0.0",
        },
        prepareHome: options.managed
          ? (probeHome) => {
              writeFileSync(path.join(probeHome, "config.toml"), `${renderManagedTomlConfig()}\n`, "utf8");
            }
          : undefined,
      },
      async ({ client, initializeResult }) =>
        buildReport(client, initializeResult, options.enginePath, options.managed),
    );

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanReport(report);
    }
    process.exitCode = report.featureFlags.status === "available" ? 0 : 2;
  } catch (error) {
    printProbeError(error);
    process.exitCode = 1;
  }
}

main();
