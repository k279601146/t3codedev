import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopEngineUpdater from "../engine/DesktopEngineUpdater.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopCommercialAuth from "../settings/DesktopCommercialAuth.ts";
import * as DesktopInstallationIdentity from "./DesktopInstallationIdentity.ts";
import * as DesktopApm from "./DesktopApm.ts";

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: unknown;
}

function makeClientSettingsLayer(settings: Option.Option<ClientSettings>) {
  return Layer.succeed(DesktopClientSettings.DesktopClientSettings, {
    get: Effect.succeed(settings),
    set: () => Effect.void,
  } satisfies DesktopClientSettings.DesktopClientSettingsShape);
}

function makeLayer(settings: Option.Option<ClientSettings> = Option.none()) {
  const configLayer = DesktopConfig.layerTest({ BAHEW_HOME: "D:/tmp/t3-apm-test" });
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "D:/repo/apps/desktop/src",
    homeDirectory: "D:/Users/alice",
    platform: "win32",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "D:/repo",
    isPackaged: true,
    resourcesPath: "D:/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, configLayer)));

  return DesktopApm.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(makeClientSettingsLayer(settings)),
    Layer.provideMerge(
      DesktopCommercialAuth.layerTest({
        gatewayBaseUrl: "https://gateway.example.test/proxy",
        ideJwt: "test-jwt",
      }),
    ),
    Layer.provideMerge(DesktopEngineUpdater.layerTest({ currentVersion: "0.9.0" })),
    Layer.provideMerge(
      DesktopInstallationIdentity.layerTest({
        installationId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        deviceId: "device-1",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

function withFetch<A, E, R>(fetchImpl: typeof fetch, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.fetch;
      globalThis.fetch = fetchImpl;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        globalThis.fetch = previous;
      }),
  );
}

function parseBody(init: RequestInit): unknown {
  return typeof init.body === "string" ? JSON.parse(init.body) : init.body;
}

describe("DesktopApm", () => {
  it.effect("默认允许基础运营事件发送，并去除敏感字段", () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (url, init = {}) => {
      calls.push({ url: String(url), init, body: parseBody(init) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    return withFetch(
      fetchImpl,
      Effect.gen(function* () {
        const apm = yield* DesktopApm.DesktopApm;
        yield* apm.track("app_launch", {
          component: "desktop",
          token: "secret",
          prompt: "hidden",
          terminalOutput: "hidden",
          errorCode: "hidden",
          workspacePath: "D:/secret/project",
        });
        yield* apm.flush;

        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.url, "https://gateway.example.test/ide/api/telemetry");
        assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer test-jwt");
        const body = calls[0]?.body as { events: Array<Record<string, any>> };
        assert.equal(body.events.length, 1);
        assert.equal(body.events[0]?.type, "app_launch");
        assert.equal(body.events[0]?.appVersion, "1.2.3");
        assert.equal(body.events[0]?.engineVersion, "0.9.0");
        assert.equal(body.events[0]?.installationId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert.deepEqual(body.events[0]?.data, { component: "desktop" });
      }).pipe(Effect.provide(makeLayer()), Effect.scoped),
    );
  });

  it.effect("详细使用事件受 usageAnalytics 开关控制", () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (url, init = {}) => {
      calls.push({ url: String(url), init, body: parseBody(init) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    return withFetch(
      fetchImpl,
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const apm = yield* DesktopApm.DesktopApm;
          yield* apm.track("ttft", { duration_ms: 123 });
          yield* apm.flush;
        }).pipe(Effect.provide(makeLayer()), Effect.scoped);
        assert.equal(calls.length, 0);

        const enabled = {
          ...DEFAULT_CLIENT_SETTINGS,
          telemetryConsent: {
            ...DEFAULT_CLIENT_SETTINGS.telemetryConsent,
            usageAnalytics: true,
          },
        };
        yield* Effect.gen(function* () {
          const enabledApm = yield* DesktopApm.DesktopApm;
          yield* enabledApm.track("ttft", { duration_ms: 456 });
          yield* enabledApm.flush;
        }).pipe(Effect.provide(makeLayer(Option.some(enabled))), Effect.scoped);

        assert.equal(calls.length, 1);
        const body = calls[0]?.body as { events: Array<Record<string, any>> };
        assert.equal(body.events[0]?.type, "ttft");
      }),
    );
  });

  it.effect("发送失败后事件回到队列，下一次 flush 会重试", () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (url, init = {}) => {
      calls.push({ url: String(url), init, body: parseBody(init) });
      return new Response(null, { status: calls.length === 1 ? 500 : 204 });
    }) as typeof fetch;

    return withFetch(
      fetchImpl,
      Effect.gen(function* () {
        const apm = yield* DesktopApm.DesktopApm;
        yield* apm.track("backend_ready", { component: "backend" });
        yield* apm.flush;
        yield* apm.flush;

        assert.equal(calls.length, 2);
        const secondBody = calls[1]?.body as { events: Array<Record<string, any>> };
        assert.equal(secondBody.events.length, 1);
        assert.equal(secondBody.events[0]?.type, "backend_ready");
      }).pipe(Effect.provide(makeLayer()), Effect.scoped),
    );
  });

  it.effect("达到 50 条后自动按批量上报", () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (url, init = {}) => {
      calls.push({ url: String(url), init, body: parseBody(init) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    return withFetch(
      fetchImpl,
      Effect.gen(function* () {
        const apm = yield* DesktopApm.DesktopApm;
        for (let index = 0; index < 50; index += 1) {
          yield* apm.track("app_launch", { index });
        }

        assert.equal(calls.length, 1);
        const body = calls[0]?.body as { events: Array<Record<string, any>> };
        assert.equal(body.events.length, 50);
      }).pipe(Effect.provide(makeLayer()), Effect.scoped),
    );
  });
});
