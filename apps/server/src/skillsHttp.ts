/**
 * Skills HTTP routes.
 *
 *   GET /api/skills/asset?source=<id>&path=<rel>
 *     返回 vendor_imports/<source>/<rel> 下的静态资源（图标、其它 SKILL 内引用素材）。
 *     对路径做白名单校验，禁止越权读 vendor 目录之外的文件。
 *
 *   GET /api/skills/installed-asset?skill=<name>&path=<rel>
 *     返回某个已安装 skill 目录下的资源（图标、SKILL.md 内引用素材）。
 *     依赖 codex skills/list 给出的 path，由 SkillsService 反查。
 *
 *   GET /api/skills/content?source=<id>&path=<rel>
 *     兜底用：直接返回 vendor 中某个 SKILL.md 的原始 markdown（去 frontmatter 由调用者处理）。
 *     当前 RPC 已经能直接返回正文，这条路由保留给 markdown 内嵌资源等场景。
 *
 * catalog 列表本身走 WS RPC（skills.catalog），不再走 HTTP。
 */

import Mime from "@effect/platform-node/Mime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { respondToAuthError } from "./auth/http.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";

import { SkillsCatalogService } from "./skills/SkillsCatalogService.ts";
import { SkillsService } from "./skills/SkillsService.ts";

const SKILL_ASSET_CACHE_CONTROL = "public, max-age=86400";

const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

export const skillsAssetRouteLayer = HttpRouter.add(
  "GET",
  "/api/skills/asset",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const sourceId = url.value.searchParams.get("source");
    const relPath = url.value.searchParams.get("path");
    if (!sourceId || !relPath) {
      return HttpServerResponse.text("Missing source/path", { status: 400 });
    }

    const catalog = yield* SkillsCatalogService;
    const resolved = yield* catalog
      .resolveVendorAssetPath(sourceId, relPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (!resolved) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const stat = yield* fileSystem.stat(resolved).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed(null),
        onSuccess: (info) => Effect.succeed(info),
      }),
    );
    if (!stat || stat.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentType = Mime.getType(resolved) ?? "application/octet-stream";
    return yield* HttpServerResponse.file(resolved, {
      status: 200,
      contentType,
      headers: {
        "Cache-Control": SKILL_ASSET_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const skillsInstalledAssetRouteLayer = HttpRouter.add(
  "GET",
  "/api/skills/installed-asset",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const skillName = url.value.searchParams.get("skill");
    const relPath = url.value.searchParams.get("path");
    if (!skillName || !relPath) {
      return HttpServerResponse.text("Missing skill/path", { status: 400 });
    }

    const skills = yield* SkillsService;
    const resolved = yield* skills
      .resolveInstalledAssetPath({ skillName, relPath })
      .pipe(Effect.orElseSucceed(() => null));
    if (!resolved) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const stat = yield* fileSystem.stat(resolved).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed(null),
        onSuccess: (info) => Effect.succeed(info),
      }),
    );
    if (!stat || stat.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentType = Mime.getType(resolved) ?? "application/octet-stream";
    return yield* HttpServerResponse.file(resolved, {
      status: 200,
      contentType,
      headers: {
        "Cache-Control": SKILL_ASSET_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
