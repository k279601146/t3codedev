/**
 * BundledEngineConfig — 捆绑引擎模式的配置与检测。
 *
 * 当 `MYIDE_ENGINE_PATH` 环境变量存在时，服务器进入"捆绑引擎模式"：
 * 使用内嵌的 codex-app-server 二进制替代系统 PATH 中的 codex CLI，
 * 并通过 `--no-load-config` + `--config` 参数注入自定义 API 配置，
 * 完全绕过用户本地的 config.toml。
 *
 * 这是商业化 IDE 客户端的核心机制：用户无需安装 Codex CLI，
 * 无需手动配置 config.toml，所有配置由客户端自动注入。
 *
 * @module provider/BundledEngineConfig
 */

// ── 环境变量常量 ────────────────────────────────────────────

/** 捆绑引擎二进制的绝对路径（由 Electron 主进程注入） */
const ENV_ENGINE_PATH = "MYIDE_ENGINE_PATH";

/** 隔离的 CODEX_HOME 目录（由 Electron 主进程注入） */
const ENV_ENGINE_HOME = "MYIDE_ENGINE_HOME";

/** 用户长期 API Key（由账号系统颁发，传给 app-server 使用） */
const ENV_API_KEY = "MYIDE_API_KEY";

/** 自定义 API 反代地址（可选，不设则使用硬编码默认值） */
const ENV_API_URL = "MYIDE_API_URL";

// ── 默认 API 配置 ────────────────────────────────────────────

/** 默认 API 反代地址 — 替换为你的实际后端 */
const DEFAULT_API_URL = "http://127.0.0.1:8317/v1";
const WIRE_API = "responses";

/** 内部 provider 标识符 */
const PROVIDER_ID = "myservice";

/** 用户可见的 provider 名称 */
export const PROVIDER_DISPLAY_NAME = "MyService";
// ── 核心接口 ────────────────────────────────────────────────

export interface BundledEngineResolvedConfig {
  /** 捆绑引擎二进制的绝对路径 */
  readonly binaryPath: string;

  /** spawn 参数（包含 --no-load-config 和所有 --config 标志） */
  readonly spawnArgs: ReadonlyArray<string>;

  /** spawn 环境变量补丁（API Key + CODEX_HOME） */
  readonly spawnEnvPatch: Readonly<Record<string, string>>;

  /** 隔离的 CODEX_HOME 路径 */
  readonly engineHome: string;
}

// ── 检测与解析 ──────────────────────────────────────────────

/** 从环境变量中区分大小写或不区分大小写地获取值（Windows 稳定性） */
function getEnvVar(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key];
  const upperKey = key.toUpperCase();
  for (const k in env) {
    if (k.toUpperCase() === upperKey) return env[k];
  }
  return undefined;
}

/**
 * 解析捆绑引擎配置。
 * 当 MYIDE_ENGINE_PATH 环境变量存在且非空时返回配置对象，否则返回 undefined。
 *
 * 注意：此函数不检测文件是否存在（避免 node:fs 依赖），
 * 文件可执行性由 ChildProcessSpawner 在实际 spawn 时验证。
 */
export function resolveBundledEngineConfig(
  env: NodeJS.ProcessEnv = process.env,
): BundledEngineResolvedConfig | undefined {
  const binaryPath = getEnvVar(env, ENV_ENGINE_PATH);
  if (!binaryPath || binaryPath.trim().length === 0) {
    return undefined;
  }

  // 当路径是 "codex" 这样的简单名称时，说明没有设置真正的捆绑路径
  // 只有绝对路径才视为捆绑模式
  if (!binaryPath.includes("/") && !binaryPath.includes("\\")) {
    return undefined;
  }

  const apiUrl = getEnvVar(env, ENV_API_URL) || DEFAULT_API_URL;
  const apiKey = getEnvVar(env, ENV_API_KEY) || "";
  const engineHome = getEnvVar(env, ENV_ENGINE_HOME) || "";

  // 构建 --config 参数列表
  // 独立引擎 (ai-engine) 不接受 --no-load-config 和 --config，
  // 我们通过 CODEX_ 前缀的环境变量来注入配置（Figment 会自动解析这些环境变量）。
  const configFlags: string[] = [];

  // 构建环境变量补丁
  const spawnEnvPatch: Record<string, string> = {
    CODEX_MODEL_PROVIDER: PROVIDER_ID,
    [`CODEX_MODEL_PROVIDERS_${PROVIDER_ID.toUpperCase()}_NAME`]: PROVIDER_DISPLAY_NAME,
    [`CODEX_MODEL_PROVIDERS_${PROVIDER_ID.toUpperCase()}_BASE_URL`]: apiUrl,
    [`CODEX_MODEL_PROVIDERS_${PROVIDER_ID.toUpperCase()}_WIRE_API`]: WIRE_API,
    [`CODEX_MODEL_PROVIDERS_${PROVIDER_ID.toUpperCase()}_ENV_KEY`]: ENV_API_KEY,
    [`CODEX_MODEL_PROVIDERS_${PROVIDER_ID.toUpperCase()}_REQUIRES_OPENAI_AUTH`]: "false",
    CODEX_SHELL_ENVIRONMENT_POLICY_INCLUDE_ONLY:
      '["PATH","HOME","LANG","TERM","USERPROFILE","APPDATA","LOCALAPPDATA","TEMP","TMP","SystemRoot","HOMEDRIVE","HOMEPATH"]',
    CODEX_DISABLE_TELEMETRY: "true",
  };

  // Windows 使用 unelevated 沙箱（早期版本）
  if (process.platform === "win32") {
    spawnEnvPatch.CODEX_WINDOWS_SANDBOX = "unelevated";
  }

  if (apiKey) {
    spawnEnvPatch[ENV_API_KEY] = apiKey;
  }
  if (engineHome) {
    spawnEnvPatch.CODEX_HOME = engineHome;
  }

  return {
    binaryPath,
    spawnArgs: configFlags,
    spawnEnvPatch,
    engineHome,
  };
}

/**
 * 动态生成引擎的 TOML 配置内容，以避免底层 Figment 解析带下划线的环境变量时出现嵌套错误
 *（例如 requires_openai_auth 可能会被解析为 requires.openai.auth）。
 */
export function generateBundledTomlConfig(env: NodeJS.ProcessEnv = process.env): string {
  const apiUrl = getEnvVar(env, ENV_API_URL) || DEFAULT_API_URL;
  const apiKey = getEnvVar(env, ENV_API_KEY) || "";
  return `
model_provider = "${PROVIDER_ID}"
disable_telemetry = true

[model_providers.${PROVIDER_ID}]
name = "${PROVIDER_DISPLAY_NAME}"
base_url = "${apiUrl}"
wire_api = "${WIRE_API}"
env_key = "${ENV_API_KEY}"
requires_openai_auth = false

[shell_environment_policy]
include_only = ["PATH", "HOME", "LANG", "TERM", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot", "HOMEDRIVE", "HOMEPATH"]

${process.platform === "win32" ? '[windows]\nsandbox = "unelevated"' : ""}
  `.trim();
}

/**
 * 构建捆绑引擎的 spawn 参数。
 *
 * 与系统安装的 `codex` CLI 不同，独立的 `codex-app-server` 二进制
 * 无需 `app-server` 子命令，直接以 app-server 模式启动。
 *
 * 返回格式: [...configFlags]（无 "app-server" 子命令）
 */
export function buildBundledSpawnArgs(config: BundledEngineResolvedConfig): ReadonlyArray<string> {
  return config.spawnArgs;
}

/**
 * 构建系统 codex CLI 的 spawn 参数。
 * 需要 `app-server` 子命令。
 *
 * 返回格式: ["app-server"]
 */
export function buildSystemSpawnArgs(): ReadonlyArray<string> {
  return ["app-server"];
}
