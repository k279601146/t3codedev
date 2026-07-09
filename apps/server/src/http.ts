import Mime from "@effect/platform-node/Mime";
import type { ChatAttachment } from "@t3tools/contracts";
import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { cast } from "effect/Function";
import { randomUUID } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import NodePath from "node:path";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpMiddleware,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
  sanitizeAttachmentDisplayName,
} from "./attachmentStore.ts";
import { resolveStaticDir, ServerConfig } from "./config.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
import {
  desktopApmEventsTotal,
  formatPrometheusMetrics,
  increment,
} from "./observability/Metrics.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { respondToAuthError } from "./auth/http.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { resolveBundledEngineConfig } from "./provider/BundledEngineConfig.ts";
import {
  browserApiCorsAllowedHeaders,
  browserApiCorsAllowedMethods,
  browserApiCorsHeaders,
  isBrowserApiCorsAllowedOrigin,
  isLoopbackHostname as isBrowserApiCorsLoopbackHostname,
} from "./httpCors.ts";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
const PROMETHEUS_METRICS_PATH = "/api/observability/metrics";
const DESKTOP_APM_EVENTS_PATH = "/ide/api/telemetry";
const ENGINE_PROTOCOL_VERSION = "app-server-v1";
const ATTACHMENT_UPLOAD_THREAD_ID_PARAM = "threadId";
const ATTACHMENT_UPLOAD_NAME_PARAM = "name";
const ATTACHMENT_UPLOAD_TYPE_PARAM = "type";
const ATTACHMENT_UPLOAD_MIME_TYPE_PARAM = "mimeType";
const ATTACHMENT_UPLOAD_SIZE_BYTES_PARAM = "sizeBytes";

export const browserApiCorsLayer = HttpRouter.middleware(
  HttpMiddleware.cors({
    allowedOrigins: isBrowserApiCorsAllowedOrigin,
    allowedMethods: [...browserApiCorsAllowedMethods],
    allowedHeaders: [...browserApiCorsAllowedHeaders],
    maxAge: 600,
  }),
  { global: true },
);

export function isLoopbackHostname(hostname: string): boolean {
  return isBrowserApiCorsLoopbackHostname(hostname);
}

export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
  const redirectUrl = new URL(devUrl.toString());
  redirectUrl.pathname = requestUrl.pathname;
  redirectUrl.search = requestUrl.search;
  redirectUrl.hash = requestUrl.hash;
  return redirectUrl.toString();
}

function buildEngineHealthPayload() {
  const bundledConfig = resolveBundledEngineConfig(process.env);
  const engineName =
    process.env.MYIDE_ENGINE_NAME?.trim() || (bundledConfig ? "ai-engine" : "codex");
  return {
    engineName,
    upstream: process.env.MYIDE_ENGINE_UPSTREAM?.trim() || "openai/codex",
    upstreamVersion: process.env.MYIDE_ENGINE_UPSTREAM_VERSION?.trim() || null,
    protocolVersion: process.env.MYIDE_ENGINE_PROTOCOL_VERSION?.trim() || ENGINE_PROTOCOL_VERSION,
    build: process.env.MYIDE_ENGINE_BUILD?.trim() || null,
  };
}

export const healthRouteLayer = HttpRouter.add(
  "GET",
  "/health",
  Effect.succeed(
    HttpServerResponse.jsonUnsafe({
      status: "ok",
      engine: buildEngineHealthPayload(),
    }),
  ),
);

const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

export const serverEnvironmentRouteLayer = HttpRouter.add(
  "GET",
  "/.well-known/t3/environment",
  Effect.gen(function* () {
    const descriptor = yield* Effect.service(ServerEnvironment).pipe(
      Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
    );
    return HttpServerResponse.jsonUnsafe(descriptor, {
      status: 200,
      headers: browserApiCorsHeaders,
    });
  }),
);

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
}> {}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Trace export failed.", { status: 502 })),
        ),
      );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const prometheusMetricsRouteLayer = HttpRouter.add(
  "GET",
  PROMETHEUS_METRICS_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const snapshots = yield* Metric.snapshot;
    return HttpServerResponse.text(formatPrometheusMetrics(snapshots), {
      status: 200,
      headers: {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const desktopApmEventsRouteLayer = HttpRouter.add(
  "POST",
  DESKTOP_APM_EVENTS_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = (yield* request.json) as unknown;
    const events =
      typeof body === "object" &&
      body !== null &&
      "events" in body &&
      Array.isArray((body as { readonly events?: unknown }).events)
        ? (body as { readonly events: ReadonlyArray<unknown> }).events
        : [];

    yield* Effect.forEach(
      events.slice(0, 100),
      (event) => {
        const type =
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          typeof (event as { readonly type?: unknown }).type === "string"
            ? (event as { readonly type: string }).type
            : "unknown";
        return increment(desktopApmEventsTotal, { type });
      },
      { discard: true },
    );

    return HttpServerResponse.empty({ status: 204 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

function parseNonEmptyParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)?.trim();
  return value && value.length > 0 ? value : null;
}

function parseDeclaredSizeBytes(url: URL): number | null {
  const raw = parseNonEmptyParam(url, ATTACHMENT_UPLOAD_SIZE_BYTES_PARAM);
  if (!raw) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return (
    relative === "" ||
    (relative.length > 0 && !relative.startsWith("..") && !NodePath.isAbsolute(relative))
  );
}

const writeRequestStreamToAttachmentFile = (input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly targetPath: string;
  readonly attachmentsDir: string;
  readonly maxBytes: number;
}) =>
  Effect.tryPromise({
    try: async () => {
      const targetDir = NodePath.dirname(input.targetPath);
      await fsPromises.mkdir(targetDir, { recursive: true });
      const [realAttachmentsDir, realTargetDir] = await Promise.all([
        fsPromises.realpath(input.attachmentsDir),
        fsPromises.realpath(targetDir),
      ]);
      if (!isPathInsideRoot(realAttachmentsDir, realTargetDir)) {
        throw new Error("Attachment target directory resolves outside the attachments directory.");
      }
      const tempPath = NodePath.join(targetDir, `.t3-upload-${randomUUID()}.tmp`);
      const fileHandle = await fsPromises.open(tempPath, "wx");
      let written = 0;
      try {
        await Effect.runPromise(
          Stream.runForEach(input.request.stream, (chunk) =>
            Effect.tryPromise({
              try: async () => {
                written += chunk.byteLength;
                if (written > input.maxBytes) {
                  throw new Error("Attachment exceeds the maximum allowed size.");
                }
                await fileHandle.write(chunk);
              },
              catch: (cause) => cause,
            }),
          ),
        );
        await fileHandle.close();
        if (written === 0) {
          throw new Error("Attachment is empty.");
        }
        await fsPromises.rename(tempPath, input.targetPath);
        return written;
      } catch (cause) {
        await fileHandle.close().catch(() => undefined);
        await fsPromises.rm(tempPath, { force: true }).catch(() => undefined);
        throw cause;
      }
    },
    catch: (cause) => cause,
  });

export const attachmentUploadRouteLayer = HttpRouter.add(
  "POST",
  ATTACHMENTS_ROUTE_PREFIX,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const threadId = parseNonEmptyParam(url.value, ATTACHMENT_UPLOAD_THREAD_ID_PARAM);
    const rawName = parseNonEmptyParam(url.value, ATTACHMENT_UPLOAD_NAME_PARAM);
    const attachmentType = parseNonEmptyParam(url.value, ATTACHMENT_UPLOAD_TYPE_PARAM);
    const mimeType =
      parseNonEmptyParam(url.value, ATTACHMENT_UPLOAD_MIME_TYPE_PARAM) ??
      request.headers["content-type"]?.trim() ??
      "application/octet-stream";
    const declaredSizeBytes = parseDeclaredSizeBytes(url.value);
    if (!threadId || !rawName || (attachmentType !== "file" && attachmentType !== "image")) {
      return HttpServerResponse.text("Invalid attachment metadata", { status: 400 });
    }
    if (attachmentType === "image" && !mimeType.toLowerCase().startsWith("image/")) {
      return HttpServerResponse.text("Invalid image attachment MIME type", { status: 400 });
    }

    const maxBytes =
      attachmentType === "file"
        ? PROVIDER_SEND_TURN_MAX_FILE_BYTES
        : PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;
    if (
      declaredSizeBytes !== null &&
      (declaredSizeBytes <= 0 || declaredSizeBytes > maxBytes)
    ) {
      return HttpServerResponse.text("Attachment is empty or too large", { status: 413 });
    }

    const attachmentId = createAttachmentId(threadId);
    if (!attachmentId) {
      return HttpServerResponse.text("Invalid thread id", { status: 400 });
    }

    const attachment = {
      type: attachmentType,
      id: attachmentId,
      name: sanitizeAttachmentDisplayName(rawName),
      mimeType: mimeType.toLowerCase(),
      sizeBytes: declaredSizeBytes ?? 0,
    } satisfies ChatAttachment;
    const targetPath = resolveAttachmentPath({
      attachmentsDir: (yield* ServerConfig).attachmentsDir,
      attachment,
    });
    if (!targetPath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const config = yield* ServerConfig;
    const writtenBytes = yield* writeRequestStreamToAttachmentFile({
      request,
      targetPath,
      attachmentsDir: config.attachmentsDir,
      maxBytes,
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed(
          HttpServerResponse.text(cause instanceof Error ? cause.message : "Upload failed", {
            status: 400,
          }),
        ),
      ),
    );
    if (typeof writtenBytes !== "number") {
      return writtenBytes;
    }

    return HttpServerResponse.jsonUnsafe(
      {
        attachment: {
          ...attachment,
          sizeBytes: writtenBytes,
        } satisfies ChatAttachment,
      },
      { status: 201 },
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        },
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir = config.staticDir ?? (config.devUrl ? yield* resolveStaticDir() : undefined);
    if (!staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexData = yield* fileSystem
        .readFile(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexData) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return HttpServerResponse.uint8Array(indexData, {
        status: 200,
        contentType: "text/html; charset=utf-8",
      });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!data) {
      return HttpServerResponse.text("Internal Server Error", { status: 500 });
    }

    return HttpServerResponse.uint8Array(data, {
      status: 200,
      contentType,
    });
  }),
);
