import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { CommercialPublicRuntimeConfigSchema } from "./model.ts";

const decodeCommercialPublicRuntimeConfig = Schema.decodeUnknownSync(
  CommercialPublicRuntimeConfigSchema,
);

describe("CommercialPublicRuntimeConfigSchema", () => {
  it("decodes legacy public config and defaults model selector to enabled", () => {
    const decoded = decodeCommercialPublicRuntimeConfig({
      featureFlags: {
        upgradeEntryEnabled: false,
      },
    });

    expect(decoded.featureFlags).toEqual({
      upgradeEntryEnabled: false,
      emailAuthEnabled: true,
      desktopDownloadPromptEnabled: true,
      t3ClientModelSelectorEnabled: true,
    });
  });

  it("decodes desktop client public endpoints", () => {
    const decoded = decodeCommercialPublicRuntimeConfig({
      featureFlags: {
        upgradeEntryEnabled: false,
      },
      desktopClient: {
        gatewayBaseUrl: "http://localhost:8000/v1",
        downloadUrl: "/api/t3code-download",
      },
    });

    expect(decoded.desktopClient).toEqual({
      gatewayBaseUrl: "http://localhost:8000/v1",
      downloadUrl: "/api/t3code-download",
    });
  });
});
