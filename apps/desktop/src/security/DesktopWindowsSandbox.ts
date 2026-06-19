import {
  type CommercialEngineWindowsSandboxMode,
  COMMERCIAL_ENGINE_WINDOWS_SANDBOX_MODES,
} from "@t3tools/shared/commercialEngine";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export interface DesktopWindowsSandboxShape {
  readonly resolveMode: Effect.Effect<CommercialEngineWindowsSandboxMode>;
}

export class DesktopWindowsSandbox extends Context.Service<
  DesktopWindowsSandbox,
  DesktopWindowsSandboxShape
>()("t3/desktop/WindowsSandbox") {}

function parseSandboxMode(
  value: string | undefined,
): CommercialEngineWindowsSandboxMode | undefined {
  const normalized = value?.trim().toLowerCase();
  return COMMERCIAL_ENGINE_WINDOWS_SANDBOX_MODES.find((mode) => mode === normalized);
}

export const layer = Layer.effect(
  DesktopWindowsSandbox,
  Effect.gen(function* () {
    const config = yield* DesktopConfig.DesktopConfig;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;

    const resolveMode = Effect.gen(function* () {
      const explicitMode = parseSandboxMode(Option.getOrUndefined(config.windowsSandboxMode));
      if (explicitMode !== undefined) {
        return explicitMode;
      }
      if (environment.platform !== "win32") {
        return "unelevated";
      }

      return "elevated";
    });

    return DesktopWindowsSandbox.of({
      resolveMode,
    });
  }),
);

export const layerTest = (mode: CommercialEngineWindowsSandboxMode = "elevated") =>
  Layer.succeed(
    DesktopWindowsSandbox,
    DesktopWindowsSandbox.of({
      resolveMode: Effect.succeed(mode),
    }),
  );
