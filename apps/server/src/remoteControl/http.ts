import * as Crypto from "node:crypto";

import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import { RemoteControlService } from "./RemoteControlService.ts";
import {
  DEFAULT_QQ_WEBHOOK_PATH,
  QQ_APP_ID_SECRET,
  QQ_APP_SECRET_SECRET,
} from "./RemoteControlLayer.ts";

const textDecoder = new TextDecoder();
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const QQ_ACCESS_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_OPEN_API_BASE_URL = "https://api.sgroup.qq.com";
const MAX_QQ_REPLY_CHARS = 1900;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readHeader(
  headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

function makeQqEd25519Seed(appSecret: string): Buffer {
  const source = Buffer.from(appSecret, "utf8");
  if (source.byteLength === 0) {
    throw new Error("QQ Bot App Secret cannot be empty.");
  }
  let seed = source;
  while (seed.byteLength < 32) {
    seed = Buffer.concat([seed, source]);
  }
  return seed.subarray(0, 32);
}

function makeQqPrivateKey(appSecret: string) {
  return Crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, makeQqEd25519Seed(appSecret)]),
    format: "der",
    type: "pkcs8",
  });
}

function firstString(...values: ReadonlyArray<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function truncateQqReply(content: string): string {
  if (content.length <= MAX_QQ_REPLY_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_QQ_REPLY_CHARS)}\n...已截断`;
}

export function signQqValidation(input: {
  readonly appSecret: string;
  readonly eventTs: string;
  readonly plainToken: string;
}): string {
  return Crypto.sign(
    null,
    Buffer.from(`${input.eventTs}${input.plainToken}`, "utf8"),
    makeQqPrivateKey(input.appSecret),
  ).toString("hex");
}

export function verifyQqWebhookSignature(input: {
  readonly appSecret: string;
  readonly timestamp: string;
  readonly rawBody: string;
  readonly signatureHex: string;
}): boolean {
  const signature = Buffer.from(input.signatureHex, "hex");
  if (
    signature.byteLength !== 64 ||
    (signature[63] & 0xe0) !== 0 ||
    signature.toString("hex") !== input.signatureHex.toLowerCase()
  ) {
    return false;
  }
  const publicKey = Crypto.createPublicKey(makeQqPrivateKey(input.appSecret));
  return Crypto.verify(
    null,
    Buffer.from(`${input.timestamp}${input.rawBody}`, "utf8"),
    publicKey,
    signature,
  );
}

function extractQqMessageId(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.d) ?? root;
  return firstString(data?.id, data?.msg_id, data?.message_id);
}

export function extractQqMessage(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.d) ?? root;
  const author = asRecord(data?.author) ?? asRecord(data?.member) ?? null;
  const content = firstString(data?.content, data?.text);
  const userId = firstString(
    data?.user_openid,
    data?.openid,
    data?.member_openid,
    author?.id,
    author?.user_openid,
    author?.openid,
    author?.member_openid,
  );
  if (!content || !userId) {
    return null;
  }
  return {
    userId,
    groupId:
      firstString(data?.group_openid, data?.group_id, data?.guild_id, data?.channel_id) ??
      undefined,
    content: content.replace(/^<@!?\d+>\s*/u, "").trim(),
    displayName: firstString(author?.username, author?.nick, author?.global_name) ?? undefined,
  };
}

export function buildQqReplyRequest(input: {
  readonly userId: string;
  readonly groupId?: string;
  readonly content: string;
  readonly msgId?: string | null;
}) {
  const targetPath = input.groupId
    ? `/v2/groups/${encodeURIComponent(input.groupId)}/messages`
    : `/v2/users/${encodeURIComponent(input.userId)}/messages`;
  return {
    url: `${QQ_OPEN_API_BASE_URL}${targetPath}`,
    body: {
      msg_type: 0,
      content: truncateQqReply(input.content),
      ...(input.msgId ? { msg_id: input.msgId } : { msg_seq: 1 }),
    },
  };
}

function fetchQqAccessToken(input: { readonly appId: string; readonly appSecret: string }) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(QQ_ACCESS_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: input.appId,
          clientSecret: input.appSecret,
        }),
        signal,
      });
      const body = (await response.json()) as unknown;
      const record = asRecord(body);
      const accessToken = readString(record, "access_token");
      if (!response.ok || !accessToken) {
        throw new Error(
          `QQ access token request failed: ${response.status} ${JSON.stringify(body)}`,
        );
      }
      return accessToken;
    },
    catch: (cause) => ({
      status: 502,
      message: cause instanceof Error ? cause.message : "获取 QQ Bot access token 失败。",
      cause,
    }),
  });
}

function sendQqReply(input: {
  readonly appId: string;
  readonly appSecret: string;
  readonly userId: string;
  readonly groupId?: string;
  readonly msgId?: string | null;
  readonly content: string;
}) {
  return Effect.gen(function* () {
    const accessToken = yield* fetchQqAccessToken({
      appId: input.appId,
      appSecret: input.appSecret,
    });
    const request = buildQqReplyRequest(input);
    yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(request.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `QQBot ${accessToken}`,
          },
          body: JSON.stringify(request.body),
          signal,
        });
        if (!response.ok) {
          throw new Error(`QQ message send failed: ${response.status} ${await response.text()}`);
        }
      },
      catch: (cause) => ({
        status: 502,
        message: cause instanceof Error ? cause.message : "发送 QQ Bot 回复失败。",
        cause,
      }),
    });
  });
}

export const qqRemoteControlWebhookRouteLayer = HttpRouter.add(
  "POST",
  DEFAULT_QQ_WEBHOOK_PATH,
  Effect.gen(function* () {
    const secretStore = yield* ServerSecretStore;
    const remoteControl = yield* RemoteControlService;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rawBody = yield* request.text.pipe(
      Effect.mapError((cause) => ({ status: 400, message: "QQ webhook body 无效。", cause })),
    );
    const payload = yield* Effect.try({
      try: () => JSON.parse(rawBody) as unknown,
      catch: (cause) => ({ status: 400, message: "QQ webhook payload 无效。", cause }),
    });
    const root = asRecord(payload);
    const data = asRecord(root?.d);

    if (root?.op === 13) {
      const plainToken = readString(data, "plain_token");
      const eventTs = readString(data, "event_ts");
      if (!plainToken || !eventTs) {
        return yield* Effect.fail({
          status: 400,
          message: "QQ webhook 验证 payload 缺少 plain_token 或 event_ts。",
        });
      }
      const secretBytes = yield* secretStore.get(QQ_APP_SECRET_SECRET).pipe(
        Effect.mapError((cause) => ({
          status: 500,
          message: "读取 QQ Bot secret 失败。",
          cause,
        })),
      );
      if (!secretBytes) {
        return yield* Effect.fail({
          status: 400,
          message: "尚未配置 QQ Bot App Secret，无法完成官方回调验证。",
        });
      }
      const signature = yield* Effect.try({
        try: () =>
          signQqValidation({
            appSecret: textDecoder.decode(secretBytes),
            eventTs,
            plainToken,
          }),
        catch: (cause) => ({ status: 400, message: "QQ webhook 验证签名生成失败。", cause }),
      });
      return HttpServerResponse.jsonUnsafe(
        { plain_token: plainToken, signature },
        { status: 200, headers: browserApiCorsHeaders },
      );
    }

    const signature = readHeader(request.headers, "x-signature-ed25519");
    const timestamp = readHeader(request.headers, "x-signature-timestamp");
    if (!signature || !timestamp) {
      return yield* Effect.fail({
        status: 401,
        message: "QQ webhook 缺少官方签名头。",
      });
    }
    const secretBytes = yield* secretStore.get(QQ_APP_SECRET_SECRET).pipe(
      Effect.mapError((cause) => ({
        status: 500,
        message: "读取 QQ Bot secret 失败。",
        cause,
      })),
    );
    if (!secretBytes) {
      return yield* Effect.fail({
        status: 400,
        message: "尚未配置 QQ Bot App Secret，无法校验官方回调签名。",
      });
    }
    const verified = yield* Effect.try({
      try: () =>
        verifyQqWebhookSignature({
          appSecret: textDecoder.decode(secretBytes),
          timestamp,
          rawBody,
          signatureHex: signature,
        }),
      catch: (cause) => ({ status: 401, message: "QQ webhook 签名校验失败。", cause }),
    });
    if (!verified) {
      return yield* Effect.fail({
        status: 401,
        message: "QQ webhook 签名无效。",
      });
    }

    const message = extractQqMessage(payload);
    if (!message) {
      return yield* Effect.fail({
        status: 400,
        message: "QQ webhook 消息事件缺少 userId 或 content。",
      });
    }

    const result = yield* remoteControl
      .handleQqMessage(message)
      .pipe(Effect.mapError((cause) => ({ status: 400, message: cause.message, cause })));
    const [appIdBytes, appSecretBytes] = yield* Effect.all([
      secretStore.get(QQ_APP_ID_SECRET),
      secretStore.get(QQ_APP_SECRET_SECRET),
    ]).pipe(
      Effect.mapError((cause) => ({ status: 500, message: "读取 QQ Bot 配置失败。", cause })),
    );
    if (!appIdBytes || !appSecretBytes) {
      return yield* Effect.fail({
        status: 400,
        message: "尚未配置 QQ Bot App ID 或 App Secret，无法发送官方 Bot 回复。",
      });
    }
    yield* sendQqReply({
      appId: textDecoder.decode(appIdBytes),
      appSecret: textDecoder.decode(appSecretBytes),
      userId: message.userId,
      groupId: message.groupId,
      msgId: extractQqMessageId(payload),
      content: result.reply,
    });
    return HttpServerResponse.jsonUnsafe(
      {
        ok: true,
        command: result.command,
        reply: result.reply,
      },
      { status: 200, headers: browserApiCorsHeaders },
    );
  }).pipe(
    Effect.catch(
      (error: { readonly status?: number; readonly message?: string; readonly cause?: unknown }) =>
        HttpServerResponse.jsonUnsafe(
          {
            ok: false,
            error: error.message ?? "QQ webhook 处理失败。",
          },
          { status: error.status ?? 500, headers: browserApiCorsHeaders },
        ),
    ),
  ),
);
