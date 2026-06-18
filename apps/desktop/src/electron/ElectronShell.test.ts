import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vitest";

const { openExternalMock, writeShortcutLinkMock, writeTextMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
  writeShortcutLinkMock: vi.fn(),
  writeTextMock: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: {
    openExternal: openExternalMock,
    writeShortcutLink: writeShortcutLinkMock,
  },
  clipboard: {
    writeText: writeTextMock,
  },
}));

import * as ElectronShell from "./ElectronShell.ts";

describe("ElectronShell", () => {
  beforeEach(() => {
    openExternalMock.mockReset();
    writeShortcutLinkMock.mockReset();
    writeTextMock.mockReset();
  });

  it.effect("opens safe external URLs", () =>
    Effect.gen(function* () {
      openExternalMock.mockResolvedValue(undefined);

      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.openExternal("https://example.com/path");

      assert.equal(result, true);
      assert.deepEqual(openExternalMock.mock.calls, [["https://example.com/path"]]);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("does not open unsafe external URLs", () =>
    Effect.gen(function* () {
      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.openExternal("file:///etc/passwd");

      assert.equal(result, false);
      assert.equal(openExternalMock.mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("returns false when Electron rejects openExternal", () =>
    Effect.gen(function* () {
      openExternalMock.mockRejectedValue(new Error("open failed"));

      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.openExternal("https://example.com/path");

      assert.equal(result, false);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("writes Windows shortcut links", () =>
    Effect.gen(function* () {
      writeShortcutLinkMock.mockReturnValue(true);

      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.writeShortcutLink("C:/Start/Bahew.lnk", "replace", {
        target: "C:/Bahew/Bahew.exe",
        appUserModelId: "com.t3tools.t3code",
      });

      assert.equal(result, true);
      assert.deepEqual(writeShortcutLinkMock.mock.calls, [
        [
          "C:/Start/Bahew.lnk",
          "replace",
          {
            target: "C:/Bahew/Bahew.exe",
            appUserModelId: "com.t3tools.t3code",
          },
        ],
      ]);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );
});
