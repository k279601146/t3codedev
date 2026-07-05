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
});
