import { describe, expect, it } from "vitest";

import manifest from "./manifest.json" with { type: "json" };

describe("chrome extension manifest", () => {
  it("keeps the extension on MV3 with local-only host permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background?.service_worker).toBe("src/background.js");
    expect(manifest.action?.default_popup).toBe("src/popup.html");
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
  });
});
