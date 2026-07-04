import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS,
  COMMERCIAL_ENGINE_EXCLUDED_FEATURE_KEYS,
  COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL_ENV,
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
    let gatewayBaseUrl: string | undefined;
    let webAuthBaseUrl: string | undefined;

    try {
      Reflect.deleteProperty(globalThis, "process");

      gatewayBaseUrl = resolveCommercialEngineGatewayBaseUrl();
      webAuthBaseUrl = resolveCommercialEngineWebAuthBaseUrl();
    } finally {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        enumerable: false,
        value: previousProcess,
        writable: true,
      });
    }

    assert.equal(gatewayBaseUrl, DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL);
    assert.equal(webAuthBaseUrl?.replace(/\/$/, ""), DEFAULT_COMMERCIAL_ENGINE_WEB_AUTH_BASE_URL);
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

  it("generates persistent engine configuration without commercial provider routing details", () => {
    const toml = generateCommercialEngineTomlConfig({
      MYIDE_GATEWAY_BASE_URL: "https://api.example.com/v1",
      MYIDE_API_KEY: "must-not-appear",
      [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
    });

    assert.match(toml, /sandbox_mode = "workspace-write"/);
    assert.match(toml, /approval_policy = "on-request"/);
    assert.match(toml, /approvals_reviewer = "user"/);
    assert.match(toml, /\[sandbox_workspace_write\]\s+network_access = false/);
    assert.match(toml, /image_generation = true/);
    assert.match(toml, /imagegenext = true/);
    assert.match(toml, /plugins = true/);
    assert.match(toml, /apps = true/);
    assert.match(toml, /browser_use = true/);
    assert.match(toml, /in_app_browser = true/);
    assert.match(toml, /computer_use = true/);
    assert.match(toml, /apply_patch_streaming_events = true/);
    assert.match(toml, /unified_exec = true/);
    assert.match(toml, /terminal_resize_reflow = true/);
    assert.match(toml, /prevent_idle_sleep = true/);
    assert.doesNotMatch(toml, /shell_zsh_fork = true/);
    assert.doesNotMatch(toml, /unified_exec_zsh_fork = true/);
    assert.doesNotMatch(toml, /apply_patch_freeform = true/);
    assert.doesNotMatch(toml, /remote_models = true/);
    assert.doesNotMatch(toml, /model_provider = "myservice"/);
    assert.doesNotMatch(toml, /\[model_providers\.myservice\]/);
    assert.doesNotMatch(toml, /base_url = "https:\/\/api\.example\.com\/v1"/);
    assert.doesNotMatch(toml, /wire_api = "responses"/);
    assert.doesNotMatch(toml, /requires_openai_auth/);
    assert.doesNotMatch(toml, /must-not-appear/);
    assert.doesNotMatch(toml, /jwt-token/);
    assert.doesNotMatch(toml, /"OPENAI_API_KEY"/);
    assert.doesNotMatch(toml, new RegExp(COMMERCIAL_ENGINE_IDE_JWT_ENV));
  });

  it("keeps the managed feature policy explicit and excludes unsupported zsh fork features", () => {
    assert.ok(COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS.includes("apply_patch_streaming_events"));
    assert.ok(COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS.includes("unified_exec"));
    assert.ok(COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS.includes("network_proxy"));
    assert.ok(COMMERCIAL_ENGINE_EXCLUDED_FEATURE_KEYS.includes("shell_zsh_fork"));
    assert.ok(COMMERCIAL_ENGINE_EXCLUDED_FEATURE_KEYS.includes("unified_exec_zsh_fork"));
    assert.equal(COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS.includes("apply_patch_freeform"), false);
    assert.equal(COMMERCIAL_ENGINE_ENABLED_FEATURE_KEYS.includes("remote_models"), false);
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
