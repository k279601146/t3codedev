import {
  type CommercialEngineWindowsSandboxMode,
  COMMERCIAL_ENGINE_WINDOWS_SANDBOX_MODES,
} from "@t3tools/shared/commercialEngine";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";

const SANDBOX_REGISTRY_KEY = "HKCU\\Software\\MyIDE";
const SANDBOX_REGISTRY_VALUE = "SandboxMode";
const REGISTRY_QUERY_TIMEOUT = Duration.seconds(2);

export interface DesktopWindowsSandboxShape {
  readonly resolveMode: Effect.Effect<CommercialEngineWindowsSandboxMode>;
}

export class DesktopWindowsSandbox extends Context.Service<
  DesktopWindowsSandbox,
  DesktopWindowsSandboxShape
>()("t3/desktop/WindowsSandbox") {}

const { logWarning: logSandboxWarning } =
  DesktopObservability.makeComponentLogger("desktop-windows-sandbox");

function parseSandboxMode(
  value: string | undefined,
): CommercialEngineWindowsSandboxMode | undefined {
  const normalized = value?.trim().toLowerCase();
  return COMMERCIAL_ENGINE_WINDOWS_SANDBOX_MODES.find((mode) => mode === normalized);
}

function parseRegistryOutput(output: string): CommercialEngineWindowsSandboxMode | undefined {
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes(SANDBOX_REGISTRY_VALUE)) continue;
    const parts = line.trim().split(/\s+/);
    return parseSandboxMode(parts[parts.length - 1]);
  }
  return undefined;
}

export const layer = Layer.effect(
  DesktopWindowsSandbox,
  Effect.gen(function* () {
    const config = yield* DesktopConfig.DesktopConfig;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const resolveMode = Effect.gen(function* () {
      const explicitMode = parseSandboxMode(Option.getOrUndefined(config.windowsSandboxMode));
      if (explicitMode !== undefined) {
        return explicitMode;
      }
      if (environment.platform !== "win32") {
        return "unelevated";
      }

      const registryMode = yield* spawner
        .string(
          ChildProcess.make("reg.exe", [
            "query",
            SANDBOX_REGISTRY_KEY,
            "/v",
            SANDBOX_REGISTRY_VALUE,
          ]),
        )
        .pipe(
          Effect.timeoutOption(REGISTRY_QUERY_TIMEOUT),
          Effect.map((output) =>
            Option.isSome(output) ? parseRegistryOutput(output.value) : undefined,
          ),
          Effect.catch((cause) =>
            logSandboxWarning("failed to read Windows sandbox registry state", { cause }).pipe(
              Effect.as(undefined),
            ),
          ),
        );
      return registryMode ?? "unelevated";
    });

    return DesktopWindowsSandbox.of({
      resolveMode,
    });
  }),
);

export const layerTest = (mode: CommercialEngineWindowsSandboxMode = "unelevated") =>
  Layer.succeed(
    DesktopWindowsSandbox,
    DesktopWindowsSandbox.of({
      resolveMode: Effect.succeed(mode),
    }),
  );
