import * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as NetService from "./Net.ts";

const closeServer = (server: NodeNet.Server) =>
  Effect.sync(() => {
    try {
      server.close();
    } catch {
      // Ignore cleanup failures in tests.
    }
  });

const getPort = (server: NodeNet.Server): number => {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

const openServer = (host?: string): Effect.Effect<NodeNet.Server, NetService.NetError> =>
  Effect.callback<NodeNet.Server, NetService.NetError>((resume) => {
    const server = NodeNet.createServer();
    let settled = false;

    const settle = (effect: Effect.Effect<NodeNet.Server, NetService.NetError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    server.once("error", (cause) => {
      settle(
        Effect.fail(new NetService.NetError({ message: "Failed to open test server", cause })),
      );
    });

    if (host) {
      server.listen(0, host, () => settle(Effect.succeed(server)));
    } else {
      server.listen(0, () => settle(Effect.succeed(server)));
    }

    return closeServer(server);
  });

it.layer(NetService.layer)("NetService", (it) => {
  describe("Net helpers", () => {
    it.effect("reserveLoopbackPort returns a positive loopback port", () =>
      Effect.gen(function* () {
        const net = yield* NetService.NetService;
        const port = yield* net.reserveLoopbackPort();

        assert.ok(port > 0);
      }),
    );

    it.effect("isPortAvailableOnLoopback reports false for an occupied port", () =>
      Effect.acquireUseRelease(
        openServer("127.0.0.1"),
        (server) =>
          Effect.gen(function* () {
            const net = yield* NetService.NetService;
            const port = getPort(server);

            const available = yield* net.isPortAvailableOnLoopback(port);
            assert.equal(available, false);
          }),
        closeServer,
      ),
    );

    it.effect("findAvailablePort returns preferred when it is free", () =>
      Effect.gen(function* () {
        const net = yield* NetService.NetService;
        const preferred = yield* net.reserveLoopbackPort();

        const resolved = yield* net.findAvailablePort(preferred);
        assert.equal(resolved, preferred);
      }),
    );

    it.effect("findAvailablePort falls back when preferred is occupied", () =>
      Effect.acquireUseRelease(
        openServer(),
        (server) =>
          Effect.gen(function* () {
            const net = yield* NetService.NetService;
            const preferred = getPort(server);

            const resolved = yield* net.findAvailablePort(preferred);
            assert.ok(resolved > 0);
            assert.notEqual(resolved, preferred);
          }),
        closeServer,
      ),
    );
  });
});

describe("resilientFetch", () => {
  it("retries transient HTTP statuses", async () => {
    const statuses = [503, 200];
    const attempts: Array<number> = [];

    const response = await NetService.resilientFetch("https://api.example.test/models", {
      baseDelayMs: 0,
      fetchImpl: (async () => {
        const status = statuses.shift() ?? 500;
        attempts.push(status);
        return new Response("{}", { status });
      }) as typeof fetch,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(attempts, [503, 200]);
  });

  it("does not retry non-transient HTTP failures", async () => {
    let attempts = 0;

    const response = await NetService.resilientFetch("https://api.example.test/auth", {
      baseDelayMs: 0,
      fetchImpl: (async () => {
        attempts += 1;
        return new Response("unauthorized", { status: 401 });
      }) as typeof fetch,
    });

    assert.equal(response.status, 401);
    assert.equal(attempts, 1);
  });
});
