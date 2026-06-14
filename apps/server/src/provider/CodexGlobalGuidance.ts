// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";

import {
  CodexSettings,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ServerCodexGlobalGuidanceError,
  type CodexSettings as CodexSettingsConfig,
  type ServerCodexGlobalGuidance,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { getCommercialEngineEnvVar } from "@t3tools/shared/commercialEngine";
import { expandHomePath } from "../pathExpansion.ts";
import { resolveBundledEngineConfig } from "./BundledEngineConfig.ts";
import { resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
const CODEX_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(CODEX_DRIVER_KIND);
const decodeCodexSettingsOption = Schema.decodeUnknownOption(CodexSettings);

function toGuidanceError(reason: string, cause?: unknown): ServerCodexGlobalGuidanceError {
  return new ServerCodexGlobalGuidanceError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function resolveDefaultCodexSettings(settings: ServerSettings): CodexSettingsConfig {
  const instance = settings.providerInstances[CODEX_DEFAULT_INSTANCE_ID];
  if (instance?.driver === CODEX_DRIVER_KIND) {
    const decoded = decodeCodexSettingsOption(instance.config ?? {});
    if (Option.isSome(decoded)) {
      return decoded.value;
    }
  }
  return settings.providers.codex;
}

function resolveCommercialCodexHome(env: NodeJS.ProcessEnv): string | undefined {
  const bundledHome = resolveBundledEngineConfig(env)?.engineHome.trim();
  if (bundledHome) {
    return bundledHome;
  }

  const explicitEngineHome = getCommercialEngineEnvVar(env, "MYIDE_ENGINE_HOME")?.trim();
  if (explicitEngineHome) {
    return explicitEngineHome;
  }

  const bahewHome = getCommercialEngineEnvVar(env, "BAHEW_HOME")?.trim();
  return bahewHome ? `${bahewHome}/agent-data` : undefined;
}

export const resolveCodexGlobalGuidancePaths = Effect.fn("resolveCodexGlobalGuidancePaths")(
  function* (settings: ServerSettings): Effect.fn.Return<
    {
      readonly filePath: string;
      readonly overrideFilePath: string;
    },
    ServerCodexGlobalGuidanceError,
    Path.Path
  > {
    const path = yield* Path.Path;
    const commercialHome = resolveCommercialCodexHome(process.env);
    const sharedHomePath =
      commercialHome !== undefined
        ? path.resolve(expandHomePath(commercialHome))
        : (yield* resolveCodexHomeLayout(resolveDefaultCodexSettings(settings))).sharedHomePath ||
          path.join(NodeOS.homedir(), ".codex");
    return {
      filePath: path.join(sharedHomePath, "AGENTS.md"),
      overrideFilePath: path.join(sharedHomePath, "AGENTS.override.md"),
    };
  },
);

function readOptionalFile(
  fileSystem: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<string, ServerCodexGlobalGuidanceError> {
  return fileSystem.readFileString(filePath).pipe(
    Effect.catch((error) => {
      if (error.reason._tag === "NotFound") {
        return Effect.succeed("");
      }
      return Effect.fail(toGuidanceError(`无法读取 ${filePath}`, error));
    }),
  );
}

function fileExists(
  fileSystem: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<boolean, ServerCodexGlobalGuidanceError> {
  return fileSystem
    .exists(filePath)
    .pipe(Effect.mapError((cause) => toGuidanceError(`无法检查 ${filePath} 是否存在`, cause)));
}

export function readCodexGlobalGuidance(
  settings: ServerSettings,
): Effect.Effect<
  ServerCodexGlobalGuidance,
  ServerCodexGlobalGuidanceError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const paths = yield* resolveCodexGlobalGuidancePaths(settings);
    const [content, overrideActive] = yield* Effect.all(
      [
        readOptionalFile(fileSystem, paths.filePath),
        fileExists(fileSystem, paths.overrideFilePath),
      ],
      { concurrency: "unbounded" },
    );
    return {
      content,
      filePath: paths.filePath,
      overrideFilePath: paths.overrideFilePath,
      overrideActive,
    };
  });
}

export function updateCodexGlobalGuidance(input: {
  readonly settings: ServerSettings;
  readonly content: string;
}): Effect.Effect<
  ServerCodexGlobalGuidance,
  ServerCodexGlobalGuidanceError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const paths = yield* resolveCodexGlobalGuidancePaths(input.settings);

    if (input.content.trim().length === 0) {
      yield* fileSystem.remove(paths.filePath).pipe(
        Effect.catch((error) => {
          if (error.reason._tag === "NotFound") {
            return Effect.void;
          }
          return Effect.fail(toGuidanceError(`无法删除 ${paths.filePath}`, error));
        }),
      );
      return yield* readCodexGlobalGuidance(input.settings);
    }

    yield* fileSystem
      .makeDirectory(path.dirname(paths.filePath), { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          toGuidanceError(`无法创建 ${path.dirname(paths.filePath)}`, cause),
        ),
      );
    yield* fileSystem
      .writeFileString(paths.filePath, input.content)
      .pipe(Effect.mapError((cause) => toGuidanceError(`无法写入 ${paths.filePath}`, cause)));
    return yield* readCodexGlobalGuidance(input.settings);
  });
}
