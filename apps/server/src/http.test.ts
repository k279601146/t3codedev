import { describe, expect, it } from "vitest";

import { isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";
import { isBrowserApiCorsAllowedOrigin } from "./httpCors.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("allows browser API CORS from loopback origins", () => {
    expect(isBrowserApiCorsAllowedOrigin("http://localhost:5733")).toBe(true);
    expect(isBrowserApiCorsAllowedOrigin("http://127.0.0.1:5733")).toBe(true);
    expect(isBrowserApiCorsAllowedOrigin("http://[::1]:5733")).toBe(true);
  });

  it("does not allow browser API CORS from external origins by default", () => {
    expect(isBrowserApiCorsAllowedOrigin("https://app.example.com")).toBe(false);
  });

  it("allows browser API CORS from explicitly configured origins", () => {
    const original = process.env.T3CODE_BROWSER_API_ALLOWED_ORIGINS;
    process.env.T3CODE_BROWSER_API_ALLOWED_ORIGINS = "https://app.example.com/some/path";
    try {
      expect(isBrowserApiCorsAllowedOrigin("https://app.example.com")).toBe(true);
      expect(isBrowserApiCorsAllowedOrigin("https://other.example.com")).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.T3CODE_BROWSER_API_ALLOWED_ORIGINS;
      } else {
        process.env.T3CODE_BROWSER_API_ALLOWED_ORIGINS = original;
      }
    }
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});
