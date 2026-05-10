import type { MyIdeWorkspaceConfig } from "@t3tools/shared/workspaceConfig";
import { parseMyIdeWorkspaceConfigToml } from "@t3tools/shared/workspaceConfig";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

const WORKSPACE_CONFIG_PATH = ".myide/config.toml";
const MAX_INCLUDED_FILES = 20;
const MAX_INCLUDED_FILE_BYTES = 64 * 1024;
const MAX_INCLUDED_TOTAL_BYTES = 256 * 1024;

export interface WorkspacePromptContext {
  readonly promptPrefix?: string;
  readonly config: MyIdeWorkspaceConfig;
}

export interface ProjectWorkspaceConfigShape {
  readonly read: (
    workspaceRoot: string,
  ) => Effect.Effect<Option.Option<MyIdeWorkspaceConfig>, never>;
  readonly buildPromptContext: (
    workspaceRoot: string,
  ) => Effect.Effect<Option.Option<WorkspacePromptContext>, never>;
}

export class ProjectWorkspaceConfig extends Context.Service<
  ProjectWorkspaceConfig,
  ProjectWorkspaceConfigShape
>()("t3/workspace/ProjectWorkspaceConfig") {}

function isPathWithinRoot(path: Path.Path, workspaceRoot: string, candidate: string): boolean {
  const relative = path.relative(workspaceRoot, candidate);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function renderPromptPrefix(input: {
  readonly config: MyIdeWorkspaceConfig;
  readonly includedFiles: readonly { readonly relativePath: string; readonly content: string }[];
}): string | undefined {
  const sections: string[] = [];

  if (input.config.rules.customInstructions) {
    sections.push(
      ["Project instructions from .myide/config.toml:", input.config.rules.customInstructions].join(
        "\n",
      ),
    );
  }

  if (input.config.context.ignore.length > 0) {
    sections.push(
      [
        "Project ignore guidance from .myide/config.toml:",
        input.config.context.ignore.join(", "),
      ].join("\n"),
    );
  }

  if (input.includedFiles.length > 0) {
    sections.push(
      [
        "Project context files from .myide/config.toml:",
        ...input.includedFiles.map((file) =>
          [`--- ${file.relativePath} ---`, file.content.trimEnd()].join("\n"),
        ),
      ].join("\n\n"),
    );
  }

  const rendered = sections.join("\n\n").trim();
  return rendered.length > 0 ? rendered : undefined;
}

export const layer = Layer.effect(
  ProjectWorkspaceConfig,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const read: ProjectWorkspaceConfigShape["read"] = Effect.fn("ProjectWorkspaceConfig.read")(
      function* (workspaceRoot) {
        const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_PATH);
        const raw = yield* fileSystem.readFileString(configPath).pipe(Effect.option);
        if (Option.isNone(raw)) {
          return Option.none();
        }

        return Option.some(parseMyIdeWorkspaceConfigToml(raw.value));
      },
    );

    const buildPromptContext: ProjectWorkspaceConfigShape["buildPromptContext"] = Effect.fn(
      "ProjectWorkspaceConfig.buildPromptContext",
    )(function* (workspaceRoot) {
      const config = yield* read(workspaceRoot);
      if (Option.isNone(config)) {
        return Option.none();
      }

      let totalBytes = 0;
      const includedFiles: Array<{ relativePath: string; content: string }> = [];
      for (const relativePath of config.value.context.alwaysInclude.slice(0, MAX_INCLUDED_FILES)) {
        const candidate = path.resolve(workspaceRoot, relativePath);
        if (!isPathWithinRoot(path, workspaceRoot, candidate)) {
          yield* Effect.logWarning("ignored .myide/config.toml context path outside workspace", {
            workspaceRoot,
            relativePath,
          });
          continue;
        }

        const bytes = yield* fileSystem.readFile(candidate).pipe(Effect.option);
        if (Option.isNone(bytes)) continue;
        if (bytes.value.byteLength > MAX_INCLUDED_FILE_BYTES) {
          yield* Effect.logWarning("ignored oversized .myide/config.toml context file", {
            workspaceRoot,
            relativePath,
            sizeBytes: bytes.value.byteLength,
          });
          continue;
        }
        if (totalBytes + bytes.value.byteLength > MAX_INCLUDED_TOTAL_BYTES) {
          break;
        }
        totalBytes += bytes.value.byteLength;
        includedFiles.push({
          relativePath,
          content: new TextDecoder().decode(bytes.value),
        });
      }
      const promptPrefix = renderPromptPrefix({ config: config.value, includedFiles });

      return Option.some({
        config: config.value,
        ...(promptPrefix ? { promptPrefix } : {}),
      });
    });

    return ProjectWorkspaceConfig.of({
      read,
      buildPromptContext,
    });
  }),
);

export const layerEmpty = Layer.succeed(
  ProjectWorkspaceConfig,
  ProjectWorkspaceConfig.of({
    read: () => Effect.succeed(Option.none()),
    buildPromptContext: () => Effect.succeed(Option.none()),
  }),
);
