// @effect-diagnostics nodeBuiltinImport:off
import assert from "node:assert/strict";
import * as NodeHttp from "node:http";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { describe, it } from "vitest";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

import { T3_BROWSER_EXTERNAL_TOOL_NAMESPACE } from "../browserTools.ts";
import * as BrowserExternalToolServiceShape from "../Services/BrowserExternalToolService.ts";
import * as BrowserExternalToolService from "./BrowserExternalToolService.ts";

const basePayload = {
  arguments: {},
  callId: "call-1",
  namespace: T3_BROWSER_EXTERNAL_TOOL_NAMESPACE,
  threadId: "thread-1",
  tool: "browser_title",
  turnId: "turn-1",
} satisfies EffectCodexSchema.DynamicToolCallParams;

function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function withHost(
  handler: (payload: unknown, token: string) => EffectCodexSchema.DynamicToolCallResponse,
  run: (endpoint: string, token: string) => Promise<void>,
) {
  const token = "test-token";
  const server = NodeHttp.createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const authorized = request.headers.authorization === `Bearer ${token}`;
      response.writeHead(authorized ? 200 : 401, { "content-type": "application/json" });
      response.end(
        JSON.stringify(authorized ? handler(payload, token) : { success: false, contentItems: [] }),
      );
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`, token);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("BrowserExternalToolService", () => {
  it("returns a clear error when the extension host is unavailable", async () => {
    await withEnv(
      {
        T3CODE_BROWSER_USE_EXTERNAL_ENDPOINT: undefined,
        T3CODE_BROWSER_USE_EXTERNAL_TOKEN: undefined,
      },
      async () => {
        const scope = Effect.runSync(Scope.make());
        const context = await Effect.runPromise(
          Layer.buildWithScope(BrowserExternalToolService.layer, scope),
        );
        const service = Effect.runSync(
          Effect.service(BrowserExternalToolServiceShape.BrowserExternalToolService).pipe(
            Effect.provide(context),
          ),
        );
        const response = await service.call(basePayload);
        assert.equal(response.success, false);
        assert.match(
          response.contentItems[0]?.type === "inputText" ? response.contentItems[0].text : "",
          /unavailable/i,
        );
        await Effect.runPromise(Scope.close(scope, Exit.void));
      },
    );
  });

  it("rejects unknown namespace and tool names", async () => {
    const scope = Effect.runSync(Scope.make());
    const context = await Effect.runPromise(
      Layer.buildWithScope(BrowserExternalToolService.layer, scope),
    );
    const service = Effect.runSync(
      Effect.service(BrowserExternalToolServiceShape.BrowserExternalToolService).pipe(
        Effect.provide(context),
      ),
    );
    assert.equal((await service.call({ ...basePayload, namespace: "other" })).success, false);
    assert.equal((await service.call({ ...basePayload, tool: "browser_cookie" })).success, false);
    assert.equal(
      (await service.call({ ...basePayload, tool: "browser_set_viewport" })).success,
      false,
    );
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  it("proxies successful host responses", async () => {
    await withHost(
      () => ({
        success: true,
        contentItems: [{ type: "inputText", text: "ok" }],
      }),
      async (endpoint, token) =>
        withEnv(
          {
            T3CODE_BROWSER_USE_EXTERNAL_ENDPOINT: endpoint,
            T3CODE_BROWSER_USE_EXTERNAL_TOKEN: token,
          },
          async () => {
            const scope = Effect.runSync(Scope.make());
            const context = await Effect.runPromise(
              Layer.buildWithScope(BrowserExternalToolService.layer, scope),
            );
            const service = Effect.runSync(
              Effect.service(BrowserExternalToolServiceShape.BrowserExternalToolService).pipe(
                Effect.provide(context),
              ),
            );
            const response = await service.call(basePayload);
            assert.deepEqual(response, {
              success: true,
              contentItems: [{ type: "inputText", text: "ok" }],
            });
            await Effect.runPromise(Scope.close(scope, Exit.void));
          },
        ),
    );
  });
});
