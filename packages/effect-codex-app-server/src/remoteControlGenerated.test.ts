import { describe, expect, it } from "vitest";

import {
  CLIENT_REQUEST_METHODS,
  CLIENT_REQUEST_PARAMS,
  CLIENT_REQUEST_RESPONSES,
} from "./_generated/meta.gen.ts";

const REMOTE_CONTROL_METHODS = [
  "remoteControl/enable",
  "remoteControl/disable",
  "remoteControl/status/read",
  "remoteControl/pairing/start",
  "remoteControl/pairing/status",
  "remoteControl/client/list",
  "remoteControl/client/revoke",
] as const;

describe("generated remote control protocol metadata", () => {
  for (const method of REMOTE_CONTROL_METHODS) {
    it(`contains params and response schemas for ${method}`, () => {
      expect(CLIENT_REQUEST_METHODS[method]).toBe(method);
      expect(Object.hasOwn(CLIENT_REQUEST_PARAMS, method)).toBe(true);
      expect(Object.hasOwn(CLIENT_REQUEST_RESPONSES, method)).toBe(true);
    });
  }

  it("keeps status/read params undefined and response schema present", () => {
    expect(CLIENT_REQUEST_PARAMS["remoteControl/status/read"]).toBeUndefined();
    expect(CLIENT_REQUEST_RESPONSES["remoteControl/status/read"]).toBeDefined();
  });
});
