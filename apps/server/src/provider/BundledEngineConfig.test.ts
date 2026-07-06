import assert from "node:assert/strict";

import {
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV,
} from "@t3tools/shared/commercialEngine";
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
      MYIDE_GATEWAY_BASE_URL: "https://api.example.com",
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
    assert.equal(config.spawnEnvPatch.OPENAI_BASE_URL, "https://api.example.com/v1");
    assert.equal(config.spawnEnvPatch.CODEX_MODEL_PROVIDERS_MYSERVICE_WIRE_API, "responses");
    assert.equal(
      config.spawnEnvPatch.CODEX_MODEL_PROVIDERS_MYSERVICE_ENV_KEY,
      COMMERCIAL_ENGINE_IDE_JWT_ENV,
    );
  });

  it("does not map Windows sandbox mode to an unsupported CODEX env var", () => {
    const config = resolveBundledEngineConfig({
      MYIDE_ENGINE_PATH: "/opt/myide/ai-engine",
      MYIDE_ENGINE_HOME: "/home/user/.myide/agent-data",
      [COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV]: "unelevated",
    });

    assert.ok(config);
    assert.equal(config.spawnEnvPatch[COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV], "unelevated");
    assert.equal(config.spawnEnvPatch.CODEX_WINDOWS_SANDBOX, undefined);
  });

  it("generates TOML without commercial provider routing details", () => {
    const toml = generateBundledTomlConfig({
      MYIDE_GATEWAY_BASE_URL: "https://api.example.com/v1",
      [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
    });

    assert.match(toml, /plugins = true/);
    assert.match(toml, /apps = true/);
    assert.doesNotMatch(toml, /model_provider = "myservice"/);
    assert.doesNotMatch(toml, /\[model_providers\.myservice\]/);
    assert.doesNotMatch(toml, /base_url = "https:\/\/api\.example\.com\/v1"/);
    assert.doesNotMatch(toml, /wire_api = "responses"/);
    assert.doesNotMatch(toml, /requires_openai_auth/);
    assert.doesNotMatch(toml, new RegExp(COMMERCIAL_ENGINE_IDE_JWT_ENV));
    assert.doesNotMatch(toml, /jwt-token/);
  });

  it("prepends the packaged engine directory to the Codex child process PATH", () => {
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

  it("still provides the packaged engine directory when the base environment has no PATH", () => {
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
