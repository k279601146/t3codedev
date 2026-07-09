import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { type CodexSettings, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { expandHomePath } from "../pathExpansion.ts";
import {
  resolveBundledEngineConfig,
  buildCodexProcessEnv,
} from "../provider/BundledEngineConfig.ts";
import { TextGenerationError } from "@t3tools/contracts";
import {
  resolveCommercialEngineGatewayBaseUrl,
  resolveCommercialEngineIdeJwt,
  resolveCommercialEngineOpenAiBaseUrl,
} from "@t3tools/shared/commercialEngine";
import { sanitizeProviderErrorMessage } from "@t3tools/shared/providerErrors";
import {
  type BranchNameGenerationInput,
  type ThreadTitleGenerationResult,
  type TextGenerationShape,
} from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

const CODEX_GIT_TEXT_GENERATION_REASONING_EFFORT = "low";
const CODEX_TIMEOUT_MS = 180_000;
const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);
const COMMERCIAL_GATEWAY_STRUCTURED_OUTPUT_UNSUPPORTED_PATTERNS = [
  /compile_grammar_error/iu,
  /guided_grammar/iu,
  /unsupported tokenizer type/iu,
] as const;

function formatCommercialGatewayHttpError(status: number, body: string): string {
  const statusPrefix = `Gateway returned HTTP ${status}`;
  const normalized = sanitizeProviderErrorMessage(`unexpected status ${status}: ${body}`);
  if (normalized) {
    return `${statusPrefix}: ${normalized}`;
  }

  const detail = body.trim().replace(/\s+/g, " ").slice(0, 500);
  return detail.length > 0 ? `${statusPrefix}: ${detail}` : `${statusPrefix}.`;
}

function extractGatewayMessageContent(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const choices = (payload as { readonly choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }

  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }

    const message = (choice as { readonly message?: unknown }).message;
    if (message && typeof message === "object") {
      const content = (message as { readonly content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
    }
  }

  return undefined;
}

function appendGatewayStreamContent(payload: unknown, chunks: Array<string>): void {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const choices = (payload as { readonly choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return;
  }

  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }

    const delta = (choice as { readonly delta?: unknown }).delta;
    if (delta && typeof delta === "object") {
      const content = (delta as { readonly content?: unknown }).content;
      if (typeof content === "string") {
        chunks.push(content);
        continue;
      }
    }

    const content = extractGatewayMessageContent({ choices: [choice] });
    if (typeof content === "string") {
      chunks.push(content);
    }
  }
}

function parseCommercialGatewaySseContent(body: string): string | undefined {
  const chunks: Array<string> = [];
  const events = body.split(/\r?\n\r?\n/u);

  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }

    const data = dataLines.join("\n").trim();
    if (data.length === 0 || data === "[DONE]") {
      continue;
    }

    appendGatewayStreamContent(JSON.parse(data), chunks);
  }

  return chunks.length > 0 ? chunks.join("") : undefined;
}

function parseCommercialGatewayContent(body: string): string | undefined {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("data:")) {
    return parseCommercialGatewaySseContent(body);
  }

  return extractGatewayMessageContent(JSON.parse(body));
}

/**
 * Build a Codex text-generation closure bound to a specific `CodexSettings`
 * payload. See `makeCodexAdapter` for the overall per-instance rationale.
 */
export const makeCodexTextGeneration = Effect.fn("makeCodexTextGeneration")(function* (
  codexConfig: CodexSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* Effect.service(ServerConfig);

  type MaterializedImageAttachments = {
    readonly imagePaths: ReadonlyArray<string>;
  };

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.mapError((cause) =>
        normalizeCliError("codex", operation, cause, "Failed to collect process output"),
      ),
    );

  const writeTempFile = (
    operation: string,
    prefix: string,
    content: string,
  ): Effect.Effect<string, TextGenerationError, Scope.Scope> => {
    return Effect.gen(function* () {
      const tempFileId = yield* Random.nextUUIDv4;
      return yield* fileSystem
        .makeTempFileScoped({
          prefix: `t3code-${prefix}-${process.pid}-${tempFileId}.tmp`,
        })
        .pipe(Effect.tap((filePath) => fileSystem.writeFileString(filePath, content)));
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: `Failed to write temp file`,
            cause,
          }),
      ),
    );
  };

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const encodeJsonForOperation = (
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle",
    value: unknown,
  ): Effect.Effect<string, TextGenerationError> =>
    encodeJsonString(value).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "Failed to encode structured output schema.",
            cause,
          }),
      ),
    );

  const isStructuredOutputUnsupported = (input: {
    readonly status: number;
    readonly body: string;
  }): boolean => {
    if (input.status !== 400 && input.status !== 422) {
      return false;
    }
    return COMMERCIAL_GATEWAY_STRUCTURED_OUTPUT_UNSUPPORTED_PATTERNS.some((pattern) =>
      pattern.test(input.body),
    );
  };

  const buildPlainJsonPrompt = (input: {
    readonly prompt: string;
    readonly schemaJson: string;
  }): string =>
    [
      input.prompt,
      "",
      "Return only valid JSON matching this JSON Schema. Do not include markdown fences or extra text.",
      input.schemaJson,
    ].join("\n");

  const materializeImageAttachments = Effect.fn("materializeImageAttachments")(function* (
    _operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle",
    attachments: BranchNameGenerationInput["attachments"],
  ): Effect.fn.Return<MaterializedImageAttachments, TextGenerationError> {
    if (!attachments || attachments.length === 0) {
      return { imagePaths: [] };
    }

    const imagePaths: string[] = [];
    for (const attachment of attachments) {
      if (attachment.type !== "image") {
        continue;
      }

      const resolvedPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
        continue;
      }
      const fileInfo = yield* fileSystem
        .stat(resolvedPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!fileInfo || fileInfo.type !== "File") {
        continue;
      }
      imagePaths.push(resolvedPath);
    }
    return { imagePaths };
  });

  const runCodexJson = Effect.fn("runCodexJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    imagePaths = [],
    cleanupPaths = [],
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    imagePaths?: ReadonlyArray<string>;
    cleanupPaths?: ReadonlyArray<string>;
    modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const outputSchemaObject = toJsonSchemaObject(outputSchemaJson);
    const schemaJson = yield* encodeJsonForOperation(operation, outputSchemaObject);
    const schemaPath = yield* writeTempFile(operation, "codex-schema", schemaJson);
    const outputPath = yield* writeTempFile(operation, "codex-output", "");

    const runCodexCommand = Effect.fn("runCodexJson.runCodexCommand")(function* () {
      const reasoningEffort =
        getModelSelectionStringOptionValue(modelSelection, "reasoningEffort") ??
        CODEX_GIT_TEXT_GENERATION_REASONING_EFFORT;
      const bundledConfig = resolveBundledEngineConfig(environment);
      const effectiveBinaryPath = bundledConfig?.binaryPath ?? codexConfig.binaryPath ?? "codex";
      const command = ChildProcess.make(
        effectiveBinaryPath,
        [
          ...(bundledConfig?.spawnArgs ?? []),
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "-s",
          "read-only",
          "--model",
          modelSelection.model,
          "--config",
          `model_reasoning_effort="${reasoningEffort}"`,
          ...(getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true
            ? ["--config", `service_tier="fast"`]
            : []),
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
          "-",
        ],
        {
          env: buildCodexProcessEnv({
            baseEnv: environment,
            resolvedHomePath: codexConfig.homePath
              ? expandHomePath(codexConfig.homePath)
              : undefined,
            bundledConfig,
          }),
          cwd,
          shell: process.platform === "win32",
          stdin: {
            stream: Stream.encodeText(Stream.make(prompt)),
          },
        },
      );

      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeCliError("codex", operation, cause, "Failed to spawn Codex CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(operation, child.stdout),
          readStreamAsString(operation, child.stderr),
          child.exitCode.pipe(
            Effect.mapError((cause) =>
              normalizeCliError("codex", operation, cause, "Failed to read Codex CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
        return yield* new TextGenerationError({
          operation,
          detail:
            detail.length > 0
              ? `Codex CLI command failed: ${detail}`
              : `Codex CLI command failed with code ${exitCode}.`,
        });
      }
    });

    const runCommercialGatewayJson = Effect.fn("runCodexJson.runCommercialGatewayJson")(
      function* () {
        const gatewayBaseUrl = resolveCommercialEngineGatewayBaseUrl(environment);
        const openAiBaseUrl = resolveCommercialEngineOpenAiBaseUrl(gatewayBaseUrl);
        const ideJwt = resolveCommercialEngineIdeJwt(environment);
        if (!ideJwt) {
          return yield* new TextGenerationError({
            operation,
            detail: "Commercial gateway authentication token missing (not signed in).",
          });
        }

        const url = new URL(
          "chat/completions",
          openAiBaseUrl.endsWith("/") ? openAiBaseUrl : `${openAiBaseUrl}/`,
        ).toString();

        type GatewayResult =
          | {
              readonly _tag: "success";
              readonly content: string;
            }
          | {
              readonly _tag: "http-error";
              readonly status: number;
              readonly body: string;
            };

        const requestGateway = (input: {
          readonly prompt: string;
          readonly structuredOutput: boolean;
        }): Effect.Effect<GatewayResult, TextGenerationError> =>
          Effect.gen(function* () {
            const response = yield* Effect.tryPromise({
              try: (signal) =>
                fetch(url, {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${ideJwt}`,
                  },
                  body: JSON.stringify({
                    model: modelSelection.model,
                    stream: false,
                    messages: [{ role: "user", content: input.prompt }],
                    ...(input.structuredOutput
                      ? {
                          response_format: {
                            type: "json_schema",
                            json_schema: {
                              name: operation,
                              strict: true,
                              schema: outputSchemaObject,
                            },
                          },
                        }
                      : {}),
                  }),
                  signal,
                }),
              catch: (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Failed to request commercial gateway.",
                  cause,
                }),
            });

            if (!response.ok) {
              const body = yield* Effect.tryPromise({
                try: () => response.text(),
                catch: () => "",
              }).pipe(Effect.orElseSucceed(() => ""));
              return {
                _tag: "http-error",
                status: response.status,
                body,
              } satisfies GatewayResult;
            }

            const body = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Failed to read commercial gateway response.",
                  cause,
                }),
            });

            const content = yield* Effect.try({
              try: () => parseCommercialGatewayContent(body),
              catch: (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Gateway returned invalid JSON.",
                  cause,
                }),
            });
            if (typeof content !== "string") {
              return yield* new TextGenerationError({
                operation,
                detail: "Gateway response missing content.",
              });
            }

            return {
              _tag: "success",
              content,
            } satisfies GatewayResult;
          });

        const structuredResult = yield* requestGateway({
          prompt,
          structuredOutput: true,
        });
        let content: string;
        if (structuredResult._tag === "success") {
          content = structuredResult.content;
        } else if (isStructuredOutputUnsupported(structuredResult)) {
          content = yield* requestGateway({
            prompt: buildPlainJsonPrompt({ prompt, schemaJson }),
            structuredOutput: false,
          }).pipe(
            Effect.flatMap((fallbackResult) => {
              if (fallbackResult._tag === "success") {
                return Effect.succeed(fallbackResult.content);
              }
              return Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: formatCommercialGatewayHttpError(
                    fallbackResult.status,
                    fallbackResult.body,
                  ),
                }),
              );
            }),
          );
        } else {
          return yield* new TextGenerationError({
            operation,
            detail: formatCommercialGatewayHttpError(
              structuredResult.status,
              structuredResult.body,
            ),
          });
        }

        yield* fileSystem.writeFileString(outputPath, content).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail: "Failed to write output to temp file.",
                cause,
              }),
          ),
        );
      },
    );

    const cleanup = Effect.all(
      [schemaPath, outputPath, ...cleanupPaths].map((filePath) => safeUnlink(filePath)),
      {
        concurrency: "unbounded",
      },
    ).pipe(Effect.asVoid);

    return yield* Effect.gen(function* () {
      const bundledConfig = resolveBundledEngineConfig(environment);
      if (bundledConfig) {
        yield* runCommercialGatewayJson();
      } else {
        yield* runCodexCommand().pipe(
          Effect.scoped,
          Effect.timeoutOption(CODEX_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({ operation, detail: "Codex CLI request timed out." }),
                ),
              onSome: () => Effect.void,
            }),
          ),
        );
      }

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));

      return yield* fileSystem.readFileString(outputPath).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to read Codex output file.",
              cause,
            }),
        ),
        Effect.flatMap(decodeOutput),
        Effect.catchTag("SchemaError", (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Codex returned invalid structured output.",
              cause,
            }),
          ),
        ),
      );
    }).pipe(Effect.ensuring(cleanup));
  });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "CodexTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    const generated = yield* runCodexJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "CodexTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    const generated = yield* runCodexJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "CodexTextGeneration.generateBranchName",
  )(function* (input) {
    const { imagePaths } = yield* materializeImageAttachments(
      "generateBranchName",
      input.attachments,
    );
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runCodexJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      imagePaths,
      modelSelection: input.modelSelection,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "CodexTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { imagePaths } = yield* materializeImageAttachments(
      "generateThreadTitle",
      input.attachments,
    );
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runCodexJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      imagePaths,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    } satisfies ThreadTitleGenerationResult;
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});
