import { describe, expect, it } from "vitest";

import { buildPairingQrPayload } from "./RemoteControlSettings";
import { SETTINGS_NAV_GROUPS } from "./SettingsSidebarNav";

describe("remote control settings logic", () => {
  it("uses the manual pairing code in the QR payload", () => {
    expect(
      buildPairingQrPayload({
        pairingCode: "pairing-code",
        manualPairingCode: "manual-code",
        environmentId: "env-1",
        expiresAt: 1,
      }),
    ).toBe("t3code://remote-control/bind?code=manual-code&environmentId=env-1");
  });

  it("falls back to the pairing code when no manual code is present", () => {
    expect(
      buildPairingQrPayload({
        pairingCode: "pairing-code",
        manualPairingCode: null,
        environmentId: "env-1",
        expiresAt: 1,
      }),
    ).toBe("t3code://remote-control/bind?code=pairing-code&environmentId=env-1");
  });

  it("exposes the remote control settings route in the settings nav", () => {
    const paths = SETTINGS_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    expect(paths).toContain("/settings/remote-control");
  });
});
