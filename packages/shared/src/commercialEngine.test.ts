import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  COMMERCIAL_ENGINE_IDE_JWT_ENV,
  COMMERCIAL_ENGINE_WIRE_API,
  COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV,
  DEFAULT_COMMERCIAL_ENGINE_GATEWAY_BASE_URL,
  generateCommercialEngineTomlConfig,
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeJwt,
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

  it("resolves the Windows sandbox mode with a conservative fallback", () => {
    assert.equal(resolveCommercialEngineWindowsSandboxMode({}), "unelevated");
    assert.equal(
      resolveCommercialEngineWindowsSandboxMode({
        [COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV]: " elevated ",
      }),
      "elevated",
    );
    assert.equal(
      resolveCommercialEngineWindowsSandboxMode({
        [COMMERCIAL_ENGINE_WINDOWS_SANDBOX_ENV]: "unexpected",
      }),
      "unelevated",
    );
  });

  it("generates non-secret codex provider configuration for the bundled engine", () => {
    const toml = generateCommercialEngineTomlConfig({
      MYIDE_GATEWAY_BASE_URL: "https://api.example.com/v1",
      MYIDE_API_KEY: "must-not-appear",
      [COMMERCIAL_ENGINE_IDE_JWT_ENV]: "jwt-token",
    });

    assert.match(toml, /base_url = "https:\/\/api\.example\.com\/v1"/);
    assert.match(toml, new RegExp(`wire_api = "${COMMERCIAL_ENGINE_WIRE_API}"`));
    assert.match(toml, new RegExp(`env_key = "${COMMERCIAL_ENGINE_IDE_JWT_ENV}"`));
    assert.doesNotMatch(toml, /must-not-appear/);
    assert.doesNotMatch(toml, /jwt-token/);
  });
});
