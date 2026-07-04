#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { make as makeJsonSchemaGenerator } from "@effect/openapi-generator/JsonSchemaGenerator";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const DEFAULT_UPSTREAM_OWNER = "openai";
const DEFAULT_UPSTREAM_REPO = "codex";
const DEFAULT_UPSTREAM_REF = "98d28aab54ed86714901b6619400598598876dd0";
const UPSTREAM_OWNER =
  process.env.CODEX_APP_SERVER_UPSTREAM_OWNER?.trim() || DEFAULT_UPSTREAM_OWNER;
const UPSTREAM_REPO =
  process.env.CODEX_APP_SERVER_UPSTREAM_REPO?.trim() || DEFAULT_UPSTREAM_REPO;
const UPSTREAM_REF =
  process.env.CODEX_APP_SERVER_UPSTREAM_REF?.trim() || DEFAULT_UPSTREAM_REF;
const USER_AGENT = "effect-codex-app-server-generator";
const CODELOAD_TARBALL_URL =
  `https://codeload.github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/tar.gz/${UPSTREAM_REF}`;

const JsonSchemaDocument = Schema.StructWithRest(
  Schema.Struct({
    definitions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
const decodeJsonSchemaDocument = Schema.decodeEffect(Schema.fromJsonString(JsonSchemaDocument));

interface GeneratedPaths {
  readonly generatedDir: string;
  readonly schemaOutputPath: string;
  readonly metaOutputPath: string;
  readonly namespacesOutputPath: string;
}

interface MethodEntry {
  readonly method: string;
  readonly paramsType?: string;
}

interface JsonSchemaFile {
  readonly namespace?: string;
  readonly exportName: string;
  readonly fileName: string;
  readonly contents: string;
  readonly qualifiedName: string;
}

interface ProtocolSource {
  readonly jsonSchemaFiles: ReadonlyArray<JsonSchemaFile>;
  readonly clientRequestRaw: string;
  readonly clientNotificationRaw: string;
  readonly serverRequestRaw: string;
  readonly serverNotificationRaw: string;
}

class GeneratorError extends Schema.TaggedErrorClass<GeneratorError>()("GeneratorError", {
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message() {
    return this.detail;
  }
}

const ManualSchemas: Record<string, typeof Schema.Json.Type> = {
  GetAuthStatusParams: {
    type: "object",
    title: "GetAuthStatusParams",
    properties: {
      includeToken: {
        anyOf: [{ type: "boolean" }, { type: "null" }],
      },
      refreshToken: {
        anyOf: [{ type: "boolean" }, { type: "null" }],
      },
    },
  },
  GetConversationSummaryParams: {
    title: "GetConversationSummaryParams",
    oneOf: [
      {
        type: "object",
        properties: {
          rolloutPath: { type: "string" },
        },
        required: ["rolloutPath"],
      },
      {
        type: "object",
        properties: {
          conversationId: { type: "string" },
        },
        required: ["conversationId"],
      },
    ],
  },
  GetConversationSummaryResponse: {
    type: "object",
    title: "GetConversationSummaryResponse",
    properties: {
      summary: {},
    },
    required: ["summary"],
  },
  GitDiffToRemoteParams: {
    type: "object",
    title: "GitDiffToRemoteParams",
    properties: {
      cwd: { type: "string" },
    },
    required: ["cwd"],
  },
  GitDiffToRemoteResponse: {
    type: "object",
    title: "GitDiffToRemoteResponse",
    properties: {
      sha: { type: "string" },
      diff: { type: "string" },
    },
    required: ["sha", "diff"],
  },
  GetAuthStatusResponse: {
    type: "object",
    title: "GetAuthStatusResponse",
    properties: {
      authMethod: {
        anyOf: [{}, { type: "null" }],
      },
      authToken: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      requiresOpenaiAuth: {
        anyOf: [{ type: "boolean" }, { type: "null" }],
      },
    },
    required: ["authMethod", "authToken", "requiresOpenaiAuth"],
  },
};

const getGeneratedPaths = Effect.fn("getGeneratedPaths")(function* () {
  const path = yield* Path.Path;
  const generatedDir = path.join(import.meta.dirname, "..", "src", "_generated");
  return {
    generatedDir,
    schemaOutputPath: path.join(generatedDir, "schema.gen.ts"),
    metaOutputPath: path.join(generatedDir, "meta.gen.ts"),
    namespacesOutputPath: path.join(generatedDir, "namespaces.gen.ts"),
  } satisfies GeneratedPaths;
});

const getFormatterCommand = Effect.fn("getFormatterCommand")(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const executable = process.platform === "win32" ? "oxfmt.exe" : "oxfmt";
  const candidates = [
    path.join(import.meta.dirname, "..", "..", "..", "node_modules", ".bin", executable),
    path.join(import.meta.dirname, "..", "node_modules", ".bin", executable),
  ];

  for (const candidate of candidates) {
    if (yield* fs.exists(candidate)) {
      return candidate;
    }
  }

  return "oxfmt";
});

const ensureGeneratedDir = Effect.fn("ensureGeneratedDir")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { generatedDir } = yield* getGeneratedPaths();
  yield* fs.makeDirectory(generatedDir, { recursive: true });
});

const fetchText = Effect.fn("fetchText")(function* (url: string) {
  return yield* HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader("user-agent", USER_AGENT),
    HttpClient.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((okResponse) => okResponse.text),
    Effect.mapError(
      (cause) =>
        new GeneratorError({
          detail: `Failed to fetch ${url}`,
          cause,
        }),
    ),
  );
});

const fetchBytes = Effect.fn("fetchBytes")(function* (url: string) {
  return yield* HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader("user-agent", USER_AGENT),
    HttpClient.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((okResponse) => okResponse.arrayBuffer),
    Effect.map((buffer) => Buffer.from(buffer)),
    Effect.mapError(
      (cause) =>
        new GeneratorError({
          detail: `Failed to fetch ${url}`,
          cause,
        }),
    ),
  );
});

const fetchProtocolSource = Effect.fn("fetchProtocolSource")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const archive = yield* fetchBytes(CODELOAD_TARBALL_URL);
  const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "codex-schema-" });
  const archivePath = path.join(tempDir, "source.tar.gz");
  const extractDir = path.join(tempDir, "source");

  yield* fs.writeFile(archivePath, archive);
  yield* fs.makeDirectory(extractDir);
  const extractExitCode = yield* Effect.service(ChildProcessSpawner.ChildProcessSpawner).pipe(
    Effect.flatMap((spawner) =>
      spawner.spawn(
        ChildProcess.make("tar", [
          "-xzf",
          archivePath,
          "-C",
          extractDir,
          "--strip-components=1",
        ]),
      ),
    ),
    Effect.flatMap((child) => child.exitCode),
  );
  if (extractExitCode !== 0) {
    return yield* new GeneratorError({
      detail: `Failed to extract ${CODELOAD_TARBALL_URL}: tar exited with code ${extractExitCode}`,
    });
  }

  const protocolRoot = path.join(extractDir, "codex-rs", "app-server-protocol");
  const jsonRoot = path.join(protocolRoot, "schema", "json");
  const typescriptRoot = path.join(protocolRoot, "schema", "typescript");
  const allJsonFiles = (yield* fs.readDirectory(jsonRoot, { recursive: true })).map((entry) =>
    path.join(jsonRoot, entry),
  );
  const jsonSchemaFiles = yield* Effect.forEach(
    allJsonFiles
      .filter(
        (filePath) =>
          filePath.endsWith(".json") &&
          !path.basename(filePath).startsWith("codex_app_server_protocol."),
      )
      .toSorted((left, right) => left.localeCompare(right)),
    (filePath) => {
      const relativePath = path.relative(jsonRoot, filePath).replaceAll(path.sep, "/");
      const parts = relativePath.split("/");
      const namespace = parts.length > 1 ? parts[0] : undefined;
      return fs.readFileString(filePath, "utf8").pipe(
        Effect.map(
          (contents) =>
            ({
              ...(namespace ? { namespace } : {}),
              exportName: exportNameForPath(relativePath),
              fileName: path.basename(filePath),
              contents,
              qualifiedName: relativePath.replace(/\.json$/, ""),
            }) satisfies JsonSchemaFile,
        ),
      );
    },
  );

  return {
    jsonSchemaFiles: jsonSchemaFiles.toSorted((left, right) =>
      left.exportName.localeCompare(right.exportName),
    ),
    clientRequestRaw: yield* fs.readFileString(path.join(typescriptRoot, "ClientRequest.ts")),
    clientNotificationRaw: yield* fs.readFileString(
      path.join(typescriptRoot, "ClientNotification.ts"),
    ),
    serverRequestRaw: yield* fs.readFileString(path.join(typescriptRoot, "ServerRequest.ts")),
    serverNotificationRaw: yield* fs.readFileString(
      path.join(typescriptRoot, "ServerNotification.ts"),
    ),
  } satisfies ProtocolSource;
});

function collectSchemaEntries(
  chunk: string,
): ReadonlyArray<{ readonly name: string; readonly code: string }> {
  const lines = chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  const entries: Array<{ name: string; code: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const typeLine = lines[index];
    if (!typeLine?.startsWith("export type ")) {
      continue;
    }

    const constLine = lines[index + 1];
    if (!constLine?.startsWith("export const ")) {
      throw new Error(`Malformed generator output near: ${typeLine}`);
    }

    const match = /^export type ([A-Za-z0-9_]+)/.exec(typeLine);
    if (!match?.[1]) {
      throw new Error(`Could not extract schema name from: ${typeLine}`);
    }

    entries.push({
      name: match[1],
      code: `${typeLine}\n${constLine}`,
    });
    index += 1;
  }

  return entries;
}

function normalizeNullableTypes(value: typeof Schema.Json.Type): typeof Schema.Json.Type {
  if (Array.isArray(value)) {
    return value.map(normalizeNullableTypes);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const normalizedEntries = Object.entries(value).map(([key, child]) => [
    key,
    normalizeNullableTypes(child),
  ]);
  const normalizedObject = Object.fromEntries(normalizedEntries) as Record<
    string,
    typeof Schema.Json.Type
  >;
  const typeValue = normalizedObject.type;

  if (!Array.isArray(typeValue)) {
    return normalizedObject;
  }

  const normalizedTypes = typeValue.filter((entry): entry is string => typeof entry === "string");
  if (normalizedTypes.length !== typeValue.length || !normalizedTypes.includes("null")) {
    return normalizedObject;
  }

  const nonNullTypes = normalizedTypes.filter((entry) => entry !== "null");
  if (nonNullTypes.length !== 1) {
    return normalizedObject;
  }
  const nonNullType = nonNullTypes[0]!;

  const nextObject: Record<string, typeof Schema.Json.Type> = {};
  for (const [key, child] of Object.entries(normalizedObject)) {
    if (key !== "type") {
      nextObject[key] = child;
    }
  }

  return {
    anyOf: [
      {
        ...nextObject,
        type: nonNullType,
      },
      { type: "null" },
    ],
  };
}

function stripNullDefaults(value: typeof Schema.Json.Type): typeof Schema.Json.Type {
  if (Array.isArray(value)) {
    return value.map(stripNullDefaults);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !(key === "default" && child === null))
      .map(([key, child]) => [key, stripNullDefaults(child)]),
  ) as typeof Schema.Json.Type;
}

function toPascalCaseMethod(method: string) {
  return method
    .split("/")
    .flatMap((segment) => segment.split(/(?=[A-Z])/))
    .flatMap((segment) => segment.split(/[-_]/))
    .filter(Boolean)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join("");
}

function parseRequestEntries(fileContents: string): ReadonlyArray<MethodEntry> {
  const entryPattern = /\{\s*"method":\s*"([^"]+)",\s*id:\s*RequestId,\s*params:\s*([^,}]+)/g;
  const entries: Array<MethodEntry> = [];
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(fileContents)) !== null) {
    entries.push({
      method: match[1]!,
      paramsType: match[2]!.trim(),
    });
  }
  return entries;
}

function parseNotificationEntries(fileContents: string): ReadonlyArray<MethodEntry> {
  const entryPattern = /\{\s*"method":\s*"([^"]+)"(?:,\s*"params":\s*([^ }]+))?\s*\}/g;
  const entries: Array<MethodEntry> = [];
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(fileContents)) !== null) {
    entries.push({
      method: match[1]!,
      ...(match[2] ? { paramsType: match[2].trim() } : {}),
    });
  }
  return entries;
}

function resolveSchemaTypeName(
  rawTypeName: string,
  generatedSchemaNames: ReadonlySet<string>,
): string {
  if (rawTypeName === "undefined") {
    return "undefined";
  }

  const candidates = [
    rawTypeName,
    `V2${rawTypeName}`,
    `V1${rawTypeName}`,
    `SerdeJson${rawTypeName}`,
  ];
  for (const candidate of candidates) {
    if (generatedSchemaNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve schema type name: ${rawTypeName}`);
}

function resolveResponseTypeName(
  method: string,
  paramsType: string | undefined,
  generatedSchemaNames: ReadonlySet<string>,
): string {
  const overrides: Record<string, string> = {
    "account/logout": "LogoutAccountResponse",
    "account/rateLimits/read": "GetAccountRateLimitsResponse",
    "account/workspaceMessages/read": "GetWorkspaceMessagesResponse",
    "account/usage/read": "GetAccountTokenUsageResponse",
    "config/batchWrite": "ConfigWriteResponse",
    "config/mcpServer/reload": "McpServerRefreshResponse",
    "config/value/write": "ConfigWriteResponse",
    "configRequirements/read": "ConfigRequirementsReadResponse",
    "externalAgentConfig/import/readHistories": "ExternalAgentConfigImportHistoriesReadResponse",
  };

  const override = overrides[method];
  if (override) {
    return resolveSchemaTypeName(override, generatedSchemaNames);
  }

  if (paramsType && paramsType !== "undefined") {
    const fromParams = paramsType.replace(/Params$/, "Response");
    try {
      return resolveSchemaTypeName(fromParams, generatedSchemaNames);
    } catch {
      // Fall through to method-based lookup.
    }
  }

  return resolveSchemaTypeName(`${toPascalCaseMethod(method)}Response`, generatedSchemaNames);
}

function renderMethodConstants(constantName: string, entries: ReadonlyArray<MethodEntry>) {
  return [
    `export const ${constantName} = {`,
    ...entries.map(
      (entry) => `  ${JSON.stringify(entry.method)}: ${JSON.stringify(entry.method)},`,
    ),
    "} as const;",
    "",
  ].join("\n");
}

function renderTypeInterface(
  interfaceName: string,
  entries: ReadonlyArray<MethodEntry>,
  typeName: (entry: MethodEntry) => string,
) {
  return [
    `export interface ${interfaceName} {`,
    ...entries.map((entry) => `  readonly ${JSON.stringify(entry.method)}: ${typeName(entry)};`),
    "}",
    "",
  ].join("\n");
}

function renderSchemaMap(
  constantName: string,
  entries: ReadonlyArray<MethodEntry>,
  typeName: (entry: MethodEntry) => string,
) {
  return [
    `export const ${constantName} = {`,
    ...entries.map((entry) => {
      const schemaName = typeName(entry);
      return `  ${JSON.stringify(entry.method)}: ${
        schemaName === "undefined" ? "undefined" : `CodexSchema.${schemaName}`
      },`;
    }),
    "} as const;",
    "",
  ].join("\n");
}

function renderSchemaTypeReference(schemaName: string) {
  return schemaName === "undefined" ? "undefined" : `typeof CodexSchema.${schemaName}.Type`;
}

function exportNameForPath(filePath: string): string {
  const relative = filePath.replace(/^schema\/json\//, "").replace(/\.json$/, "");
  if (!relative.includes("/")) {
    return relative;
  }

  const [namespace, name] = relative.split("/", 2) as [string, string];
  const namespacePrefix = namespace
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join("");
  return `${namespacePrefix}${name}`;
}

function rewriteExternalRefs(
  value: typeof Schema.Json.Type,
  localDefinitionNames: ReadonlyMap<string, string>,
  currentNamespace: string | undefined,
  exportNameByQualifiedName: ReadonlyMap<string, string>,
): typeof Schema.Json.Type {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteExternalRefs(entry, localDefinitionNames, currentNamespace, exportNameByQualifiedName),
    );
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/definitions/")) {
        const definitionName = child.slice("#/definitions/".length);
        const localRewrite = localDefinitionNames.get(definitionName);
        if (localRewrite) {
          return [key, `#/definitions/${localRewrite}`];
        }

        const candidates = [
          ...(currentNamespace ? [`${currentNamespace}/${definitionName}`] : []),
          definitionName,
          definitionName.replace(/^v[12]\//, ""),
          definitionName.replace(/^serde_json\//, ""),
          `v2/${definitionName}`,
          `v1/${definitionName}`,
          `serde_json/${definitionName}`,
        ];

        const rewritten = candidates
          .map((candidate) => exportNameByQualifiedName.get(candidate))
          .find((candidate) => candidate !== undefined);

        if (!rewritten) {
          throw new Error(`Missing rewritten definition for ref: ${child}`);
        }

        return [key, `#/definitions/${rewritten}`];
      }

      return [
        key,
        rewriteExternalRefs(
          child,
          localDefinitionNames,
          currentNamespace,
          exportNameByQualifiedName,
        ),
      ];
    }),
  ) as typeof Schema.Json.Type;
}

const generateFiles = Effect.fn("generateFiles")(function* () {
  yield* ensureGeneratedDir();

  const {
    clientNotificationRaw,
    clientRequestRaw,
    jsonSchemaFiles,
    serverNotificationRaw,
    serverRequestRaw,
  } = yield* fetchProtocolSource();

  const exportNameByQualifiedName = new Map(
    jsonSchemaFiles.map((file) => [file.qualifiedName, file.exportName]),
  );
  const aggregateSchemas: Record<string, typeof Schema.Json.Type> = {};

  for (const file of jsonSchemaFiles) {
    const raw = file.contents;
    const parsed = yield* decodeJsonSchemaDocument(raw);
    const localDefinitionNames = new Map(
      Object.keys(parsed.definitions ?? {}).map((definitionName) => [
        definitionName,
        `${file.exportName}__${definitionName.replace(/[^A-Za-z0-9]/g, "")}`,
      ]),
    );

    for (const [definitionName, definitionSchema] of Object.entries(parsed.definitions ?? {})) {
      aggregateSchemas[localDefinitionNames.get(definitionName)!] = stripNullDefaults(
        normalizeNullableTypes(
          rewriteExternalRefs(
            definitionSchema,
            localDefinitionNames,
            file.namespace,
            exportNameByQualifiedName,
          ),
        ),
      );
    }

    const topLevelSchema: Record<string, typeof Schema.Json.Type> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== "definitions") {
        topLevelSchema[key] = value;
      }
    }

    aggregateSchemas[file.exportName] = stripNullDefaults(
      normalizeNullableTypes(
        rewriteExternalRefs(
          topLevelSchema,
          localDefinitionNames,
          file.namespace,
          exportNameByQualifiedName,
        ),
      ),
    );
  }

  for (const [name, schema] of Object.entries(ManualSchemas)) {
    if (!(name in aggregateSchemas)) {
      aggregateSchemas[name] = stripNullDefaults(normalizeNullableTypes(schema));
    }
  }

  const generator = makeJsonSchemaGenerator();
  for (const [name, schema] of Object.entries(aggregateSchemas).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    generator.addSchema(name, schema as never);
  }

  const generatedEntries = new Map<string, string>();
  const output = generator.generate("openapi-3.1", aggregateSchemas as never, false).trim();
  if (output.length > 0) {
    for (const entry of collectSchemaEntries(output)) {
      if (!generatedEntries.has(entry.name)) {
        generatedEntries.set(entry.name, entry.code);
      }
    }
  }

  const generatedSchemaNames = new Set(generatedEntries.keys());
  const clientRequestEntries = parseRequestEntries(clientRequestRaw);
  const clientNotificationEntries = parseNotificationEntries(clientNotificationRaw);
  const serverRequestEntries = parseRequestEntries(serverRequestRaw);
  const serverNotificationEntries = parseNotificationEntries(serverNotificationRaw);

  const prelude = [
    "// This file is generated by the effect-codex-app-server package. Do not edit manually.",
    `// Upstream protocol source: ${UPSTREAM_OWNER}/${UPSTREAM_REPO}`,
    `// Upstream protocol ref: ${UPSTREAM_REF}`,
    "",
  ];

  const schemaOutput = [
    ...prelude,
    'import * as Schema from "effect/Schema";',
    "",
    [...generatedEntries.values()].join("\n\n"),
    "",
  ].join("\n");

  const metaOutput = [
    ...prelude,
    'import * as CodexSchema from "./schema.gen.ts";',
    "",
    renderMethodConstants("CLIENT_REQUEST_METHODS", clientRequestEntries),
    renderMethodConstants("CLIENT_NOTIFICATION_METHODS", clientNotificationEntries),
    renderMethodConstants("SERVER_REQUEST_METHODS", serverRequestEntries),
    renderMethodConstants("SERVER_NOTIFICATION_METHODS", serverNotificationEntries),
    "export type ClientRequestMethod = keyof typeof CLIENT_REQUEST_METHODS;",
    "export type ClientNotificationMethod = keyof typeof CLIENT_NOTIFICATION_METHODS;",
    "export type ServerRequestMethod = keyof typeof SERVER_REQUEST_METHODS;",
    "export type ServerNotificationMethod = keyof typeof SERVER_NOTIFICATION_METHODS;",
    "",
    renderTypeInterface("ClientRequestParamsByMethod", clientRequestEntries, (entry) =>
      renderSchemaTypeReference(
        resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
      ),
    ),
    renderTypeInterface("ClientRequestResponsesByMethod", clientRequestEntries, (entry) =>
      renderSchemaTypeReference(
        resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
      ),
    ),
    renderTypeInterface("ClientNotificationParamsByMethod", clientNotificationEntries, (entry) =>
      renderSchemaTypeReference(
        resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
      ),
    ),
    renderTypeInterface("ServerRequestParamsByMethod", serverRequestEntries, (entry) =>
      renderSchemaTypeReference(
        resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
      ),
    ),
    renderTypeInterface("ServerRequestResponsesByMethod", serverRequestEntries, (entry) =>
      renderSchemaTypeReference(
        resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
      ),
    ),
    renderTypeInterface("ServerNotificationParamsByMethod", serverNotificationEntries, (entry) =>
      renderSchemaTypeReference(
        resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
      ),
    ),
    renderSchemaMap("CLIENT_REQUEST_PARAMS", clientRequestEntries, (entry) =>
      resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderSchemaMap("CLIENT_REQUEST_RESPONSES", clientRequestEntries, (entry) =>
      resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
    ),
    renderSchemaMap("CLIENT_NOTIFICATION_PARAMS", clientNotificationEntries, (entry) =>
      resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderSchemaMap("SERVER_REQUEST_PARAMS", serverRequestEntries, (entry) =>
      resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderSchemaMap("SERVER_REQUEST_RESPONSES", serverRequestEntries, (entry) =>
      resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
    ),
    renderSchemaMap("SERVER_NOTIFICATION_PARAMS", serverNotificationEntries, (entry) =>
      resolveSchemaTypeName(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
  ].join("\n");

  const namespaceGroups = new Map<string, Array<JsonSchemaFile>>();
  for (const file of jsonSchemaFiles) {
    if (!file.namespace) {
      continue;
    }
    const current = namespaceGroups.get(file.namespace) ?? [];
    current.push(file);
    namespaceGroups.set(file.namespace, current);
  }

  const namespacesOutput = [
    ...prelude,
    'import * as CodexSchema from "./schema.gen.ts";',
    "",
    ...[...namespaceGroups.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([namespace, files]) => {
        const constantName = namespace.replace(/[^A-Za-z0-9]/g, "");
        return [
          `export const ${constantName} = {`,
          ...files
            .toSorted((left, right) => left.fileName.localeCompare(right.fileName))
            .map(
              (file) =>
                `  ${JSON.stringify(file.fileName.replace(/\.json$/, ""))}: CodexSchema.${file.exportName},`,
            ),
          "} as const;",
          "",
        ].join("\n");
      }),
  ].join("\n");

  const fs = yield* FileSystem.FileSystem;
  const { generatedDir, metaOutputPath, namespacesOutputPath, schemaOutputPath } =
    yield* getGeneratedPaths();
  const formatterCommand = yield* getFormatterCommand();
  yield* fs.writeFileString(schemaOutputPath, schemaOutput);
  yield* fs.writeFileString(metaOutputPath, metaOutput);
  yield* fs.writeFileString(namespacesOutputPath, namespacesOutput);

  yield* Effect.log(
    `Generated Codex App Server schemas from ${UPSTREAM_OWNER}/${UPSTREAM_REPO}@${UPSTREAM_REF}`,
  );

  yield* Effect.service(ChildProcessSpawner.ChildProcessSpawner).pipe(
    Effect.flatMap((spawner) =>
      spawner.spawn(ChildProcess.make(formatterCommand, [generatedDir])),
    ),
    Effect.flatMap((child) => child.exitCode),
    Effect.tap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new GeneratorError({
              detail: `oxfmt failed with exit code ${code}`,
            }),
          ),
    ),
  );
});

generateFiles().pipe(
  Effect.scoped,
  Effect.provide(
    Layer.mergeAll(
      Logger.layer([Logger.consolePretty()]),
      NodeServices.layer,
      FetchHttpClient.layer,
    ),
  ),
  NodeRuntime.runMain,
);
