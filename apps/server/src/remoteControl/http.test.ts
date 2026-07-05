import * as Crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildQqReplyRequest,
  extractQqMessage,
  signQqValidation,
  verifyQqWebhookSignature,
} from "./http.ts";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function signExpected(input: {
  readonly appSecret: string;
  readonly eventTs: string;
  readonly plainToken: string;
}) {
  const secretBytes = Buffer.from(input.appSecret, "utf8");
  let seed = secretBytes;
  while (seed.byteLength < 32) {
    seed = Buffer.concat([seed, secretBytes]);
  }
  const key = Crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed.subarray(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
  return Crypto.sign(
    null,
    Buffer.from(`${input.eventTs}${input.plainToken}`, "utf8"),
    key,
  ).toString("hex");
}

describe("QQ remote control webhook helpers", () => {
  it("signs official validation payloads with the configured app secret", () => {
    const input = {
      appSecret: "secret",
      eventTs: "1700000000",
      plainToken: "plain-token",
    };

    expect(signQqValidation(input)).toBe(signExpected(input));
  });

  it("verifies signed QQ webhook events from the raw request body", () => {
    const appSecret = "secret";
    const timestamp = "1700000000";
    const rawBody = JSON.stringify({
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: { content: "/status", user_openid: "user-openid" },
    });
    const privateKey = Crypto.createPrivateKey({
      key: Buffer.concat([
        ED25519_PKCS8_PREFIX,
        Buffer.from("secretsecretsecretsecretsecretse", "utf8"),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const signatureHex = Crypto.sign(
      null,
      Buffer.from(`${timestamp}${rawBody}`, "utf8"),
      privateKey,
    ).toString("hex");

    expect(
      verifyQqWebhookSignature({
        appSecret,
        timestamp,
        rawBody,
        signatureHex,
      }),
    ).toBe(true);
    expect(
      verifyQqWebhookSignature({
        appSecret,
        timestamp,
        rawBody: `${rawBody}\n`,
        signatureHex,
      }),
    ).toBe(false);
  });

  it("extracts C2C message fields from QQ event payloads", () => {
    expect(
      extractQqMessage({
        op: 0,
        t: "C2C_MESSAGE_CREATE",
        d: {
          content: "/status",
          user_openid: "user-openid",
          author: { username: "alice" },
        },
      }),
    ).toEqual({
      userId: "user-openid",
      groupId: undefined,
      content: "/status",
      displayName: "alice",
    });
  });

  it("extracts group message fields and strips bot mentions", () => {
    expect(
      extractQqMessage({
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          content: "<@!123456> /bind ABCD",
          group_openid: "group-openid",
          author: { member_openid: "user-id", nick: "bob" },
        },
      }),
    ).toEqual({
      userId: "user-id",
      groupId: "group-openid",
      content: "/bind ABCD",
      displayName: "bob",
    });
  });

  it("builds official QQ C2C reply requests", () => {
    expect(
      buildQqReplyRequest({
        userId: "user-openid",
        content: "已绑定",
        msgId: "msg-1",
      }),
    ).toEqual({
      url: "https://api.sgroup.qq.com/v2/users/user-openid/messages",
      body: {
        msg_type: 0,
        content: "已绑定",
        msg_id: "msg-1",
      },
    });
  });

  it("builds official QQ group reply requests", () => {
    expect(
      buildQqReplyRequest({
        userId: "user-openid",
        groupId: "group-openid",
        content: "状态正常",
      }),
    ).toEqual({
      url: "https://api.sgroup.qq.com/v2/groups/group-openid/messages",
      body: {
        msg_type: 0,
        content: "状态正常",
        msg_seq: 1,
      },
    });
  });
});
