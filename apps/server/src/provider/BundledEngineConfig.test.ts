import assert from "node:assert/strict";

import { COMMERCIAL_ENGINE_IDE_JWT_ENV } from "@t3tools/shared/commercialEngine";
import { describe, it } from "vitest";

import {
  buildCodexProcessEnv,
  generateBundledTomlConfig,
  resolveBundledEngineConfig,
} from "./BundledEngineConfig.ts";

describe("BundledEngineConfig", () => {
  it("does not enter bundled mode for command names from PATH", () => {
    assert.equal(resolveBundledEngineConfig({ MYIDE_ENGINE_PATH: "codex" }), undefined);
  });

  it("uses an IDE JWT as the bundled engine bearer token", () => {
    const config = resolveBundledEngineConfig({
      MYIDE_ENGINE_PATH: "/opt/myide/ai-engine",
      MYIDE_ENGINE_HOME: "/home/user/.myide/agent-data",
      MYIDE_GATEWAY_BASE_URL: "https://api.example.com/v1",
      [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
      MYIDE_API_KEY: "legacy-real-key",
    });

    assert.ok(config);
    assert.equal(config.binaryPath, "/opt/myide/ai-engine");
    assert.equal(config.spawnEnvPatch.CODEX_HOME, "/home/user/.myide/agent-data");
    assert.equal(config.spawnEnvPatch[COMMERCIAL_ENGINE_IDE_JWT_ENV], "jwt-token");
    assert.equal(config.spawnEnvPatch.MYIDE_API_KEY, undefined);
    assert.equal(config.spawnEnvPatch.CODEX_MODEL_PROVIDER, "myservice");
    assert.equal(config.spawnEnvPatch.CODEX_FEATURES_IMAGEGENEXT, "true");
    assert.equal(
      config.spawnEnvPatch.CODEX_MODEL_PROVIDERS_MYSERVICE_BASE_URL,
      "https://api.example.com/v1",
    );
    assert.equal(config.spawnEnvPatch.CODEX_MODEL_PROVIDERS_MYSERVICE_WIRE_API, "responses");
    assert.equal(
      config.spawnEnvPatch.CODEX_MODEL_PROVIDERS_MYSERVICE_ENV_KEY,
      COMMERCIAL_ENGINE_IDE_JWT_ENV,
    );
  });

  it("generates TOML without serializing token values", () => {
    const toml = generateBundledTomlConfig({
      MYIDE_GATEWAY_BASE_URL: "https://api.example.com/v1",
      [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
    });

    assert.match(toml, /base_url = "https:\/\/api\.example\.com\/v1"/);
    assert.match(toml, /wire_api = "responses"/);
    assert.match(toml, new RegExp(`env_key = "${COMMERCIAL_ENGINE_IDE_JWT_ENV}"`));
    assert.match(toml, /plugins = true/);
    assert.match(toml, /apps = true/);
    assert.doesNotMatch(toml, /jwt-token/);
  });

  it("将捆绑引擎目录前置到 Codex 子进程 PATH", () => {
    const env = buildCodexProcessEnv({
      baseEnv: {
        PATH: "C:\\Windows\\System32",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      },
      resolvedHomePath: undefined,
      bundledConfig: {
        binaryPath: "D:\\T3 Code\\resources\\ai-engine.exe",
        spawnArgs: [],
        spawnEnvPatch: {},
        engineHome: "C:\\Users\\alice\\.bahew\\agent-data",
      },
    });

    assert.equal(
      env.PATH,
      `D:\\T3 Code\\resources${process.platform === "win32" ? ";" : ":"}C:\\Windows\\System32`,
    );
    assert.equal(env.Path, env.PATH);
  });

  it("原环境没有 PATH 时仍提供捆绑引擎目录", () => {
    const env = buildCodexProcessEnv({
      baseEnv: {},
      resolvedHomePath: undefined,
      bundledConfig: {
        binaryPath: "D:\\T3 Code\\resources\\ai-engine.exe",
        spawnArgs: [],
        spawnEnvPatch: {},
        engineHome: "C:\\Users\\alice\\.bahew\\agent-data",
      },
    });

    assert.equal(env.PATH, "D:\\T3 Code\\resources");
    assert.equal(env.Path, "D:\\T3 Code\\resources");
  });
});
