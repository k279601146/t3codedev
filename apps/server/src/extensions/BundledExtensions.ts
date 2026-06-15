// @effect-diagnostics nodeBuiltinImport:off
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const BUNDLED_EXTENSIONS_PATH_ENV = "T3CODE_BUNDLED_EXTENSIONS_PATH";
export const BUNDLED_SKILL_SOURCE_ID = "t3-bundled";

function normalizeConfiguredPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export const resolveBundledExtensionsRoot = Effect.fn("resolveBundledExtensionsRoot")(function* (
  input: {
    readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    readonly developmentRoot?: string | undefined;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = input.env ?? process.env;
  const configured = normalizeConfiguredPath(env[BUNDLED_EXTENSIONS_PATH_ENV]);
  const developmentRoot =
    input.developmentRoot ?? path.resolve(import.meta.dirname, "../../../..", "extensions");
  const candidates = [
    configured ? path.resolve(configured) : undefined,
    developmentRoot ? path.resolve(developmentRoot) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      return candidate;
    }
  }
  return undefined;
});
