import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV,
  COMMERCIAL_ENGINE_WIRE_API,
  COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV,
  DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
  DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL,
  buildCommercialEngineProcessEnv,
  generateCommercialEngineTomlConfig,
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeApiBaseUrlCandidates,
  resolveCommercialEngineIdeJwt,
  resolveCommercialEngineWebAuthBaseUrl,
  resolveCommercialEngineWindowsSandboxMode,
} from "./commercialEngine.ts";

describe("commercialEngine", () => {
  it("uses the public gateway URL from explicit IDE configuration", () => {
    assert.equal(
      resolveCommercialEngineGatewayBaseUrl({
        MYIDE_GATEWAY_BASE_URL: "https://api.example.com/v1",
      }),
      "https://api.example.com/v1",
    );
  });

  it("falls back to the documented public gateway placeholder", () => {
    assert.equal(
      resolveCommercialEngineGatewayBaseUrl({}),
      DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
    );
  });

  it("uses a separate dev2 web authorization URL", () => {
    assert.equal(
      resolveCommercialEngineWebAuthBaseUrl({
        [COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV]: "https://app.example.com",
        MYIDE_GATEWAY_BASE_URL: "https://gateway.example.com/v1",
      }),
      "https://app.example.com",
    );
  });

  it("resolves public defaults when process is unavailable", () => {
    const previousProcess = globalThis.process;

    try {
      Reflect.deleteProperty(globalThis, "process");

      assert.equal(
        resolveCommercialEngineGatewayBaseUrl(),
        DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
      );
      assert.equal(
        resolveCommercialEngineWebAuthBaseUrl(),
        DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL,
      );
    } finally {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        enumerable: false,
        value: previousProcess,
        writable: true,
      });
    }
  });

  it("derives IDE API candidates from the gateway URL", () => {
    assert.deepEqual(resolveCommercialEngineIdeApiBaseUrlCandidates("https://api.example.com/v1"), [
      "https://api.example.com",
    ]);
    assert.deepEqual(resolveCommercialEngineIdeApiBaseUrlCandidates("https://sub.bahew.com/v1"), [
      "https://sub.bahew.com",
    ]);
  });

  it("only resolves the IDE JWT environment variable as the AI bearer token", () => {
    assert.equal(
      resolveCommercialEngineIdeJwt({
        MYIDE_API_KEY: "legacy-real-key",
        [COMMERCIAL_ENGINE_IDE_JWT_ENV]: " jwt-token ",
      }),
      "jwt-token",
    );
    assert.equal(resolveCommercialEngineIdeJwt({ MYIDE_API_KEY: "legacy-real-key" }), undefined);
  });

  it("resolves the Windows sandbox mode with an elevated fallback", () => {
    assert.equal(resolveCommercialEngineWindowsSandboxMode({}), "elevated");
    assert.equal(
      resolveCommercialEngineWindowsSandboxMode({
        [COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV]: " unelevated ",
      }),
      "unelevated",
    );
    assert.equal(
      resolveCommercialEngineWindowsSandboxMode({
        [COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV]: "unexpected",
      }),
      "elevated",
    );
  });

  it("generates non-secret codex provider configuration for the bundled engine", () => {
    const toml = generateCommercialEngineTomlConfig({
      MYIDE_GATEWAY_BASE_URL: "https://api.example.com/v1",
      MYIDE_API_KEY: "must-not-appear",
      [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
    });

    assert.match(toml, /base_url = "https:\/\/api\.example\.com\/v1"/);
    assert.match(toml, /sandbox_mode = "workspace-write"/);
    assert.match(toml, /approval_policy = "on-request"/);
    assert.match(toml, /approvals_reviewer = "user"/);
    assert.match(toml, /\[sandbox_workspace_write\]\s+network_access = false/);
    assert.match(toml, new RegExp(`wire_api = "${COMMERCIAL_ENGINE_WIRE_API}"`));
    assert.match(toml, new RegExp(`env_key = "${COMMERCIAL_ENGINE_IDE_JWT_ENV}"`));
    assert.match(toml, /image_generation = true/);
    assert.match(toml, /imagegenext = true/);
    assert.match(toml, /plugins = true/);
    assert.match(toml, /apps = true/);
    assert.match(toml, /browser_use = true/);
    assert.match(toml, /in_app_browser = true/);
    assert.match(toml, /computer_use = true/);
    assert.doesNotMatch(toml, /must-not-appear/);
    assert.doesNotMatch(toml, /jwt-token/);
    assert.doesNotMatch(toml, /"OPENAI_API_KEY"/);
    assert.doesNotMatch(toml, new RegExp(`"${COMMERCIAL_ENGINE_IDE_JWT_ENV}"[^\\n]*\\]`));
  });

  it("builds a minimum process environment for the bundled engine", () => {
    const env = buildCommercialEngineProcessEnv(
      {
        PATH: "/bin",
        HOME: "/home/user",
        AWS_SECRET_ACCESS_KEY: "must-not-leak",
        OPENAI_API_KEY: "must-not-leak",
        SystemDrive: "C:",
      },
      {
        CODEX_HOME: "/home/user/.bahew/engine",
        [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
      },
    );

    assert.equal(env.PATH, "/bin");
    assert.equal(env.HOME, "/home/user");
    assert.equal(env.SystemDrive, "C:");
    assert.equal(env.CODEX_HOME, "/home/user/.bahew/engine");
    assert.equal(env[COMMERCIAL_ENGINE_IDE_JWT_ENV], "jwt-token");
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
  });

  it("keeps Windows shell environment variables needed by sandboxed command runners", () => {
    const toml = generateCommercialEngineTomlConfig({});
    const shellIncludeLine = toml
      .split("\n")
      .find((line) => line.trim().startsWith("include_only = "));

    assert.match(shellIncludeLine ?? "", /"SystemDrive"/);
    assert.doesNotMatch(shellIncludeLine ?? "", /"MYIDE_IDE_JWT"/);
    assert.doesNotMatch(shellIncludeLine ?? "", /"OPENAI_API_KEY"/);
  });
});
