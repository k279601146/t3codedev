import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { buildWindowsSandboxSnapshot } from "./windowsSandbox.ts";

describe("windowsSandbox", () => {
  it("把 unelevated 沙箱快照视为可继续运行", () => {
    const snapshot = buildWindowsSandboxSnapshot({
      binaryPath: "ai-engine.exe",
      environment: {
        MYIDE_WINDOWS_SANDBOX_MODE: "unelevated",
      },
      readiness: "updateRequired",
      updatedAt: "2026-06-17T00:00:00.000Z",
    });

    assert.equal(snapshot.mode, "unelevated");
    assert.equal(snapshot.readiness, "ready");
  });

  it("保留 elevated 沙箱的 updateRequired 状态", () => {
    const snapshot = buildWindowsSandboxSnapshot({
      binaryPath: "ai-engine.exe",
      environment: {
        MYIDE_WINDOWS_SANDBOX_MODE: "elevated",
      },
      readiness: "updateRequired",
      updatedAt: "2026-06-17T00:00:00.000Z",
    });

    assert.equal(snapshot.mode, "elevated");
    assert.equal(snapshot.readiness, "updateRequired");
  });
});
