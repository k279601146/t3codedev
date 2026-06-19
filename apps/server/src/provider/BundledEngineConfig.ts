/**
 * BundledEngineConfig — 捆绑引擎模式的配置与检测。
 *
 * 当 `MYIDE_ENGINE_PATH` 环境变量存在时，服务器进入"捆绑引擎模式"：
 * 使用内嵌的 codex-app-server 二进制替代系统 PATH 中的 codex CLI，
 * 并通过内存环境变量注入自定义 API 配置。
 *
 * 这是商业化 IDE 客户端的核心机制：用户无需安装 Codex CLI，
 * 无需手动配置 config.toml，所有敏感凭证由客户端登录态按需注入。
 *
 * @module provider/BundledEngineConfig
 */

import {
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME,
  COMMERCIAL_ENGINE_PROVIDER_ID,
  COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY,
  COMMERCIAL_ENGINE_WIRE_API,
  COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV,
  generateCommercialEngineTomlConfig,
  getCommercialEngineEnvVar,
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeJwt,
  buildCommercialEngineProcessEnv,
} from "@t3tools/shared/commercialEngine";

// ── 环境变量常量 ────────────────────────────────────────────

/** 捆绑引擎二进制的绝对路径（由 Electron 主进程注入） */
const ENV_ENGINE_PATH = "MYIDE_ENGINE_PATH";

/** 隔离的 CODEX_HOME 目录（由 Electron 主进程注入） */
const ENV_ENGINE_HOME = "MYIDE_ENGINE_HOME";

/** 用户 JWT（由 sub2api IDE 登录流程签发，传给 app-server 作为 Bearer 凭证） */
const ENV_IDE_JWT = COMMERCIAL_ENGINE_IDE_JWT_ENV;

export const PROVIDER_DISPLAY_NAME = COMMERCIAL_ENGINE_PROVIDER_DISPLAY_NAME;
// ── 核心接口 ────────────────────────────────────────────────

export interface BundledEngineResolvedConfig {
  /** 捆绑引擎二进制的绝对路径 */
  readonly binaryPath: string;

  /** spawn 参数（包含 --no-load-config 和所有 --config 标志） */
  readonly spawnArgs: ReadonlyArray<string>;

  /** spawn 环境变量补丁（IDE JWT + CODEX_HOME） */
  readonly spawnEnvPatch: Readonly<Record<string, string>>;

  /** 隔离的 CODEX_HOME 路径 */
  readonly engineHome: string;
}

// ── 检测与解析 ──────────────────────────────────────────────

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
  const binaryPath = getCommercialEngineEnvVar(env, ENV_ENGINE_PATH);
  if (!binaryPath || binaryPath.trim().length === 0) {
    return undefined;
  }

  // 当路径是 "codex" 这样的简单名称时，说明没有设置真正的捆绑路径
  // 只有绝对路径才视为捆绑模式
  if (!binaryPath.includes("/") && !binaryPath.includes("\\")) {
    return undefined;
  }

  const gatewayBaseUrl = resolveCommercialEngineGatewayBaseUrl(env);
  const ideJwt = resolveCommercialEngineIdeJwt(env);
  const engineHome = getCommercialEngineEnvVar(env, ENV_ENGINE_HOME) || "";

  // 构建 --config 参数列表
  // 独立引擎 (ai-engine) 不接受 --no-load-config 和 --config，
  // 我们通过 CODEX_ 前缀的环境变量来注入配置（Figment 会自动解析这些环境变量）。
  const configFlags: string[] = [];

  // 构建环境变量补丁
  const spawnEnvPatch: Record<string, string> = {
    CODEX_MODEL_PROVIDER: COMMERCIAL_ENGINE_PROVIDER_ID,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_NAME`]:
      PROVIDER_DISPLAY_NAME,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_BASE_URL`]:
      gatewayBaseUrl,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_WIRE_API`]:
      COMMERCIAL_ENGINE_WIRE_API,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_ENV_KEY`]: ENV_IDE_JWT,
    [`CODEX_MODEL_PROVIDERS_${COMMERCIAL_ENGINE_PROVIDER_ID.toUpperCase()}_REQUIRES_OPENAI_AUTH`]:
      "false",
    CODEX_SHELL_ENVIRONMENT_POLICY_INCLUDE_ONLY: JSON.stringify([
      ...COMMERCIAL_ENGINE_SHELL_ENVIRONMENT_INCLUDE_ONLY,
    ]),
    CODEX_DISABLE_TELEMETRY: "true",
    CODEX_FEATURES_IMAGEGENEXT: "true",
    // 强制重定向内置的 OpenAI 提供商到我们的网关
    CODEX_OPENAI_BASE_URL: gatewayBaseUrl,
    CODEX_CHATGPT_BASE_URL: gatewayBaseUrl,
    CODEX_MODEL_PROVIDERS_OPENAI_BASE_URL: gatewayBaseUrl,
    CODEX_MODEL_PROVIDERS_OPENAI_REQUIRES_OPENAI_AUTH: "false",
    CODEX_MODEL_PROVIDERS_OPENAI_ENV_KEY: ENV_IDE_JWT,
    OPENAI_BASE_URL: gatewayBaseUrl,
  };

  if (ideJwt) {
    spawnEnvPatch[ENV_IDE_JWT] = ideJwt;
  }
  if (engineHome) {
    spawnEnvPatch.CODEX_HOME = engineHome;
  }
  const windowsSandboxMode = getCommercialEngineEnvVar(env, COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV);
  if (windowsSandboxMode) {
    spawnEnvPatch[COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV] = windowsSandboxMode;
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
  return generateCommercialEngineTomlConfig(env);
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

/**
 * 构建 Codex 进程的环境变量。
 * 处理 CODEX_HOME 路径展开以及捆绑引擎的环境变量补丁。
 */
export function buildCodexProcessEnv(input: {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly resolvedHomePath: string | undefined;
  readonly bundledConfig: BundledEngineResolvedConfig | undefined;
}): Record<string, string> {
  const dirname = (value: string): string | undefined => {
    const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
    return index > 0 ? value.slice(0, index) : undefined;
  };
  const engineBinDir =
    input.bundledConfig?.binaryPath &&
    (input.bundledConfig.binaryPath.includes("/") || input.bundledConfig.binaryPath.includes("\\"))
      ? dirname(input.bundledConfig.binaryPath)
      : undefined;
  const basePathValue =
    getCommercialEngineEnvVar(input.baseEnv, "PATH") ??
    getCommercialEngineEnvVar(input.baseEnv, "Path");
  const patchedPath =
    engineBinDir && basePathValue
      ? `${engineBinDir}${process.platform === "win32" ? ";" : ":"}${basePathValue}`
      : engineBinDir
        ? engineBinDir
      : undefined;
  const patch = {
    ...(input.resolvedHomePath ? { CODEX_HOME: input.resolvedHomePath } : {}),
    ...(patchedPath ? { PATH: patchedPath, Path: patchedPath } : {}),
    ...(input.bundledConfig?.spawnEnvPatch ?? {}),
  };

  const rawEnv = input.bundledConfig
    ? buildCommercialEngineProcessEnv(input.baseEnv, patch)
    : {
        ...input.baseEnv,
        ...patch,
      };

  return Object.fromEntries(
    Object.entries(rawEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
