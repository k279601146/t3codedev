// @effect-diagnostics globalDate:off preferSchemaOverJson:off tryCatchInEffectGen:off anyUnknownInErrorContext:off
/**
 * SkillsCatalogService — 拉取 + 缓存 vendored skill 推荐目录。
 *
 * 数据流：
 *   1. ensureVendorReady(source)：检查 <baseDir>/vendor_imports/<source.id>/skills-curated-cache.json
 *      是否新鲜（24h TTL，或 force=true）。
 *   2. 不新鲜则尝试 git sparse-checkout 到 <baseDir>/vendor_imports/<source.id>/。
 *      失败（系统没有 git、网络错误、认证错误）时回退到 GitHub contents API。
 *   3. 拉到原始文件后，扫描 <vendor>/skills/.curated/<name>/SKILL.md，解析 frontmatter，
 *      把相对路径的 iconSmall/iconLarge 转成相对于 vendor 根的 repoPath，
 *      生成统一缓存 skills-curated-cache.json。
 *   4. catalog HTTP 路由读取所有源的缓存合并返回；图标 URL 通过 /api/skills/asset 暴露。
 *
 * 自愈：每次启动 + 用户点"刷新" 都会跑一次 ensureVendorReady。
 * 即使用户删除了 vendor 目录或缓存文件，下次访问会自动重建。
 */

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as NodeOS from "node:os";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import {
  BUNDLED_SKILL_SOURCE_ID,
  resolveBundledExtensionsRoot,
} from "../extensions/BundledExtensions.ts";
import { ProcessRunner, layer as ProcessRunnerLive } from "../processRunner.ts";

import { parseSkillDocument } from "./frontmatter.ts";
import {
  BUILT_IN_SKILL_SOURCES,
  type SkillSource,
  findSkillSource,
  repoUrl,
} from "./SkillsSources.ts";

const CACHE_FILE_NAME = "skills-curated-cache.json";
const VENDOR_DIR_NAME = "vendor_imports";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const HTTP_USER_AGENT = "codex-skill-list";
const REQUEST_TIMEOUT = Duration.seconds(30);
const BUNDLED_SKILL_SOURCE: SkillSource = {
  id: BUNDLED_SKILL_SOURCE_ID,
  displayName: "Bahew Built-in Skills",
  repo: "t3tools/t3code",
  ref: "bundled",
  curatedPath: "skills",
};

export interface CatalogSkillEntry {
  /** 全局唯一 id：sourceId:name */
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string | undefined;
  readonly shortDescription: string | undefined;
  /** 在仓库中的相对目录，用于 marketplace/add sparsePaths */
  readonly repoPath: string;
  /** 相对 repoPath 的 icon 路径或绝对/null */
  readonly iconSmall: string | null;
  readonly iconLarge: string | null;
  readonly sourceId: string;
}

interface SourceCacheFile {
  readonly fetchedAt: number;
  readonly skills: ReadonlyArray<CatalogSkillEntry>;
}

export interface SourceCatalogSnapshot {
  readonly source: SkillSource;
  readonly fetchedAt: number;
  readonly skills: ReadonlyArray<CatalogSkillEntry>;
}

export interface SkillsCatalogState {
  readonly snapshots: ReadonlyArray<SourceCatalogSnapshot>;
  readonly hasErrors: boolean;
}

export class SkillsCatalogError extends Data.TaggedError("SkillsCatalogError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface SkillsCatalogServiceShape {
  /**
   * 读取所有源的当前 catalog 状态。如果某些源缓存不存在或过期，会按需触发刷新；
   * force=true 则全部重新拉取。
   */
  readonly getCatalog: (options?: {
    readonly force?: boolean;
  }) => Effect.Effect<SkillsCatalogState, SkillsCatalogError>;

  /** 后台预热：服务启动后异步调用，不阻塞主流程 */
  readonly warmUp: Effect.Effect<void>;

  /** 反查某个 catalog item，给 install 用 */
  readonly findCatalogItem: (
    catalogItemId: string,
  ) => Effect.Effect<CatalogSkillEntry | undefined, SkillsCatalogError>;

  /** 解析 vendor 内的资源绝对路径（用于 asset 路由白名单） */
  readonly resolveVendorAssetPath: (
    sourceId: string,
    relPath: string,
  ) => Effect.Effect<string | null, SkillsCatalogError>;

  /** 读取某个 catalog item 的 SKILL.md 内容（去 frontmatter） */
  readonly readCatalogContent: (
    catalogItemId: string,
  ) => Effect.Effect<{ markdown: string; assetBaseUrl: string } | null, SkillsCatalogError>;
}

export class SkillsCatalogService extends Context.Service<
  SkillsCatalogService,
  SkillsCatalogServiceShape
>()("t3/skills/SkillsCatalogService") {}

// ─────────────────────────────────────────────────────────────────────────────

const make = Effect.fn("makeSkillsCatalogService")(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const processRunner = yield* ProcessRunner;

  const vendorRoot = path.join(config.baseDir, VENDOR_DIR_NAME);

  const sourceVendorDir = (source: SkillSource) => path.join(vendorRoot, source.id);
  const sourceCachePath = (source: SkillSource) =>
    path.join(sourceVendorDir(source), CACHE_FILE_NAME);
  const sourceRepoCheckoutDir = (source: SkillSource) => sourceVendorDir(source);
  const resolveBundledRoot = () =>
    resolveBundledExtensionsRoot().pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const ensureDir = (dir: string) =>
    fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new SkillsCatalogError({
            detail: `Failed to create directory ${dir}: ${String(cause)}`,
          }),
      ),
    );

  const isCacheFresh = (cache: SourceCacheFile, force: boolean): boolean => {
    if (force) return false;
    if (typeof cache.fetchedAt !== "number") return false;
    return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  };

  const readCacheFile = (source: SkillSource) =>
    Effect.gen(function* () {
      const cachePath = sourceCachePath(source);
      const exists = yield* fs.exists(cachePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return null;
      const raw = yield* fs.readFileString(cachePath).pipe(Effect.orElseSucceed(() => ""));
      if (raw.trim().length === 0) return null;
      try {
        const parsed = JSON.parse(raw) as SourceCacheFile;
        if (!Array.isArray(parsed.skills)) return null;
        return parsed;
      } catch {
        return null;
      }
    });

  const writeCacheFile = (source: SkillSource, payload: SourceCacheFile) =>
    Effect.gen(function* () {
      yield* ensureDir(sourceVendorDir(source));
      const cachePath = sourceCachePath(source);
      yield* fs
        .writeFileString(cachePath, JSON.stringify(payload, null, 2))
        .pipe(Effect.orElseSucceed(() => undefined));
    });

  // ───── pull via git ────────────────────────────────────────────────────────
  const isGitAvailable = Effect.fn("isGitAvailable")(function* () {
    // 用临时安全 cwd（用户家目录），避免 vendor root 不存在导致 spawn 误以为 git 不可用
    const probeCwd = NodeOS.homedir();
    const result = yield* processRunner
      .run({
        command: "git",
        args: ["--version"],
        cwd: probeCwd,
        timeout: 5_000,
        maxOutputBytes: 4_096,
        outputMode: "truncate",
        truncatedMarker: "",
        timeoutBehavior: "error",
      })
      .pipe(
        Effect.matchEffect({
          onFailure: (cause) =>
            Effect.logInfo("skills.catalog git probe failed", {
              detail: String(cause),
            }).pipe(Effect.as(false)),
          onSuccess: (output) => Effect.succeed(output.code === 0),
        }),
      );
    return result;
  });

  const runGit = (cwd: string, args: ReadonlyArray<string>, timeoutMs = 60_000) =>
    processRunner
      .run({
        command: "git",
        args,
        cwd,
        timeout: timeoutMs,
        maxOutputBytes: 5_000_000,
        outputMode: "truncate",
        truncatedMarker: "",
        timeoutBehavior: "error",
      })
      .pipe(
        Effect.flatMap((output) => {
          if (output.code !== 0) {
            return Effect.fail(
              new SkillsCatalogError({
                detail: `git ${args.join(" ")} failed (exit ${output.code}): ${output.stderr.trim()}`,
              }),
            );
          }
          return Effect.succeed(output);
        }),
        Effect.mapError((cause) =>
          cause instanceof SkillsCatalogError
            ? cause
            : new SkillsCatalogError({
                detail: `git ${args.join(" ")} failed: ${String(cause)}`,
                cause,
              }),
        ),
      );

  const pullViaGit = Effect.fn("pullViaGit")(function* (source: SkillSource) {
    const checkoutDir = sourceRepoCheckoutDir(source);
    yield* ensureDir(checkoutDir);

    const gitDir = path.join(checkoutDir, ".git");
    const initialized = yield* fs.exists(gitDir).pipe(Effect.orElseSucceed(() => false));

    if (!initialized) {
      yield* runGit(checkoutDir, ["init", "-q"]);
      yield* runGit(checkoutDir, ["config", "core.sparseCheckout", "true"]);
      yield* runGit(checkoutDir, ["config", "core.sparseCheckoutCone", "false"]);
      const sparseFile = path.join(checkoutDir, ".git", "info", "sparse-checkout");
      yield* ensureDir(path.join(checkoutDir, ".git", "info"));
      yield* fs.writeFileString(sparseFile, `${source.curatedPath}/**\n`);
      yield* runGit(checkoutDir, ["remote", "add", "origin", repoUrl(source)]);
    } else {
      // 校正一下 sparse-checkout pattern 防止旧仓库残留
      const sparseFile = path.join(checkoutDir, ".git", "info", "sparse-checkout");
      yield* fs
        .writeFileString(sparseFile, `${source.curatedPath}/**\n`)
        .pipe(Effect.orElseSucceed(() => undefined));
    }

    yield* runGit(
      checkoutDir,
      ["fetch", "--depth=1", "--filter=blob:none", "origin", source.ref],
      120_000,
    );
    yield* runGit(checkoutDir, ["checkout", "--", "."]).pipe(Effect.ignore);
    yield* runGit(checkoutDir, ["reset", "--hard", "FETCH_HEAD"]);
  });

  // ───── pull via GitHub contents API ────────────────────────────────────────
  const apiHeaders: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": HTTP_USER_AGENT,
    "x-github-api-version": "2022-11-28",
  };
  const rawHeaders: Record<string, string> = {
    "user-agent": HTTP_USER_AGENT,
  };

  const apiContentsUrl = (source: SkillSource, relPath: string) => {
    const cleaned = relPath.replace(/^\/+/, "");
    return `https://api.github.com/repos/${source.repo}/contents/${cleaned}?ref=${encodeURIComponent(
      source.ref,
    )}`;
  };

  const rawFileUrl = (source: SkillSource, relPath: string) => {
    const cleaned = relPath.replace(/^\/+/, "");
    return `https://raw.githubusercontent.com/${source.repo}/${source.ref}/${cleaned}`;
  };

  const fetchJson = <T = unknown>(url: string) =>
    httpClient
      .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(apiHeaders)))
      .pipe(
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? response.text.pipe(
                Effect.flatMap((text) =>
                  Effect.try({
                    try: () => JSON.parse(text) as T,
                    catch: (cause) =>
                      new SkillsCatalogError({
                        detail: `GET ${url} returned invalid JSON: ${String(cause)}`,
                      }),
                  }),
                ),
              )
            : Effect.fail(
                new SkillsCatalogError({
                  detail: `GET ${url} returned HTTP ${response.status}`,
                }),
              ),
        ),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause) =>
          cause instanceof SkillsCatalogError
            ? cause
            : new SkillsCatalogError({
                detail: `GET ${url} failed: ${String(cause)}`,
                cause,
              }),
        ),
      );

  const fetchRawText = (url: string) =>
    httpClient
      .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(rawHeaders)))
      .pipe(
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? response.text.pipe(
                Effect.mapError(
                  (cause) =>
                    new SkillsCatalogError({
                      detail: `GET ${url} failed to read response text: ${String(cause)}`,
                      cause,
                    }),
                ),
              )
            : Effect.fail(
                new SkillsCatalogError({
                  detail: `GET ${url} returned HTTP ${response.status}`,
                }),
              ),
        ),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause) =>
          cause instanceof SkillsCatalogError
            ? cause
            : new SkillsCatalogError({
                detail: `GET ${url} failed: ${String(cause)}`,
                cause,
              }),
        ),
      );

  const fetchRawBytes = (url: string) =>
    httpClient
      .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(rawHeaders)))
      .pipe(
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? response.arrayBuffer.pipe(
                Effect.mapError(
                  (cause) =>
                    new SkillsCatalogError({
                      detail: `GET ${url} failed to read response bytes: ${String(cause)}`,
                      cause,
                    }),
                ),
              )
            : Effect.fail(
                new SkillsCatalogError({
                  detail: `GET ${url} returned HTTP ${response.status}`,
                }),
              ),
        ),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause) =>
          cause instanceof SkillsCatalogError
            ? cause
            : new SkillsCatalogError({
                detail: `GET ${url} failed: ${String(cause)}`,
                cause,
              }),
        ),
      );

  type ContentsEntry = {
    readonly name: string;
    readonly path: string;
    readonly type: string;
    readonly download_url?: string | null;
  };

  const pullViaApi = Effect.fn("pullViaApi")(function* (source: SkillSource) {
    const checkoutDir = sourceRepoCheckoutDir(source);
    yield* ensureDir(checkoutDir);

    const curatedDir = path.join(checkoutDir, source.curatedPath);
    yield* ensureDir(curatedDir);

    const topListingRaw = yield* fetchJson<unknown>(apiContentsUrl(source, source.curatedPath));
    if (!Array.isArray(topListingRaw)) {
      yield* Effect.logWarning("skills.catalog GitHub contents unexpected payload", {
        sourceId: source.id,
        sample: JSON.stringify(topListingRaw).slice(0, 200),
      });
      return yield* new SkillsCatalogError({
        detail: `GitHub contents API returned non-array payload (likely rate limited).`,
      });
    }
    const topListing = topListingRaw as ReadonlyArray<ContentsEntry>;

    for (const entry of topListing) {
      if (entry.type !== "dir") continue;
      const skillName = entry.name;
      const skillDir = path.join(curatedDir, skillName);
      yield* ensureDir(skillDir);

      // 拿 SKILL.md
      const skillRel = `${source.curatedPath}/${skillName}/SKILL.md`;
      const skillUrl = rawFileUrl(source, skillRel);
      const skillMd = yield* fetchRawText(skillUrl).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed(null),
          onSuccess: (text) => Effect.succeed(text),
        }),
      );
      if (skillMd === null) continue;

      yield* fs
        .writeFileString(path.join(skillDir, "SKILL.md"), skillMd)
        .pipe(Effect.orElseSucceed(() => undefined));

      // 解析 frontmatter，决定还要拉哪些 asset
      const parsed = parseSkillDocument(skillMd);
      const assets = [parsed.frontmatter.iconSmall, parsed.frontmatter.iconLarge].filter(
        (value): value is string => typeof value === "string" && value.startsWith("./"),
      );
      for (const asset of assets) {
        const cleaned = asset.replace(/^\.\//, "").replace(/\\/g, "/");
        const assetRel = `${source.curatedPath}/${skillName}/${cleaned}`;
        const targetPath = path.join(skillDir, cleaned);
        const targetDir = path.dirname(targetPath);
        yield* ensureDir(targetDir);
        const buffer = yield* fetchRawBytes(rawFileUrl(source, assetRel)).pipe(
          Effect.matchEffect({
            onFailure: () => Effect.succeed(null),
            onSuccess: (buf) => Effect.succeed(buf),
          }),
        );
        if (buffer === null) continue;
        yield* fs
          .writeFile(targetPath, new Uint8Array(buffer))
          .pipe(Effect.orElseSucceed(() => undefined));
      }
    }
  });

  // ───── 解析 vendor 目录生成 catalog ───────────────────────────────────────
  const buildCatalogFromSkillsDirectory = Effect.fn("buildCatalogFromSkillsDirectory")(function* (
    input: {
      readonly source: SkillSource;
      readonly skillsDir: string;
      readonly repoPathPrefix: string;
    },
  ) {
    const exists = yield* fs.exists(input.skillsDir).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return [] as ReadonlyArray<CatalogSkillEntry>;
    }

    const dirEntries = yield* fs.readDirectory(input.skillsDir).pipe(Effect.orElseSucceed(() => []));
    const entries: CatalogSkillEntry[] = [];

    for (const entryName of dirEntries) {
      const entryPath = path.join(input.skillsDir, entryName);
      const stat = yield* fs.stat(entryPath).pipe(Effect.orElseSucceed(() => null));
      if (!stat || stat.type !== "Directory") continue;
      if (entryName.startsWith(".")) continue;

      const skillMdPath = path.join(entryPath, "SKILL.md");
      const md = yield* fs.readFileString(skillMdPath).pipe(Effect.orElseSucceed(() => ""));
      if (md.length === 0) continue;

      const parsed = parseSkillDocument(md);
      const name = (parsed.frontmatter.name ?? entryName).trim();
      if (name.length === 0) continue;

      const displayName = parsed.frontmatter.displayName?.trim() || prettifyName(name);
      const assetsDir = path.join(entryPath, "assets");
      const assetEntries = yield* fs.readDirectory(assetsDir).pipe(Effect.orElseSucceed(() => []));
      const fallbackIcons = pickFallbackIconPaths(assetEntries.map((asset) => `assets/${asset}`));
      const iconSmall =
        normalizeIconPath(parsed.frontmatter.iconSmall ?? null) ??
        normalizeIconPath(fallbackIcons.small);
      const iconLarge =
        normalizeIconPath(parsed.frontmatter.iconLarge ?? null) ??
        normalizeIconPath(fallbackIcons.large);

      entries.push({
        id: `${input.source.id}:${name}`,
        name,
        displayName,
        description: parsed.frontmatter.description ?? undefined,
        shortDescription: parsed.frontmatter.shortDescription ?? undefined,
        repoPath: `${input.repoPathPrefix}/${entryName}`,
        iconSmall,
        iconLarge,
        sourceId: input.source.id,
      });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries as ReadonlyArray<CatalogSkillEntry>;
  });

  const buildCatalogFromVendor = Effect.fn("buildCatalogFromVendor")(function* (
    source: SkillSource,
  ) {
    const checkoutDir = sourceRepoCheckoutDir(source);
    return yield* buildCatalogFromSkillsDirectory({
      source,
      skillsDir: path.join(checkoutDir, source.curatedPath),
      repoPathPrefix: source.curatedPath,
    });
  });

  const buildBundledCatalogSnapshot = Effect.fn("buildBundledCatalogSnapshot")(function* () {
    const bundledRoot = yield* resolveBundledRoot().pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (!bundledRoot) return undefined;
    const skills = yield* buildCatalogFromSkillsDirectory({
      source: BUNDLED_SKILL_SOURCE,
      skillsDir: path.join(bundledRoot, "skills"),
      repoPathPrefix: "skills",
    });
    if (skills.length === 0) return undefined;
    const fetchedAt = yield* Effect.sync(() => Date.now());
    return {
      source: BUNDLED_SKILL_SOURCE,
      fetchedAt,
      skills,
    } satisfies SourceCatalogSnapshot;
  });

  // ───── 单源刷新 ────────────────────────────────────────────────────────────
  const refreshSource = Effect.fn("refreshSource")(function* (source: SkillSource, force: boolean) {
    yield* ensureDir(sourceVendorDir(source));

    // 1. 看缓存是否新鲜
    const cached = yield* readCacheFile(source);
    if (cached && isCacheFresh(cached, force)) {
      return {
        source,
        fetchedAt: cached.fetchedAt,
        skills: cached.skills,
      } satisfies SourceCatalogSnapshot;
    }

    // 2. 拉源代码：优先 git，失败回退 API
    const gitOk = yield* isGitAvailable();
    let pullError: any = null;
    if (gitOk) {
      const result = yield* pullViaGit(source).pipe(
        Effect.matchEffect({
          onFailure: (cause) => Effect.succeed({ ok: false as const, cause }),
          onSuccess: () => Effect.succeed({ ok: true as const }),
        }),
      );
      if (!result.ok) {
        pullError = result.cause;
      }
    }

    if (!gitOk || pullError !== null) {
      yield* Effect.logInfo("skills.catalog falling back to GitHub API", {
        sourceId: source.id,
        reason: gitOk ? pullError?.detail : "git not available",
      });
      const apiResult = yield* pullViaApi(source).pipe(
        Effect.matchEffect({
          onFailure: (cause) => Effect.succeed({ ok: false as const, cause }),
          onSuccess: () => Effect.succeed({ ok: true as const }),
        }),
      );
      if (!apiResult.ok) {
        // 两种方式都失败，如果有旧缓存就用旧的
        if (cached) {
          yield* Effect.logWarning("skills.catalog refresh failed, using stale cache", {
            sourceId: source.id,
            detail: String(apiResult.cause),
          });
          return {
            source,
            fetchedAt: cached.fetchedAt,
            skills: cached.skills,
          } satisfies SourceCatalogSnapshot;
        }
        return yield* new SkillsCatalogError(apiResult.cause);
      }
    }

    // 3. 解析 vendor 目录，生成新缓存
    const skills = yield* buildCatalogFromVendor(source);
    const fetchedAt = yield* Effect.sync(() => Date.now());
    yield* writeCacheFile(source, { fetchedAt, skills });
    return { source, fetchedAt, skills } satisfies SourceCatalogSnapshot;
  });

  // ───── 公共 API ────────────────────────────────────────────────────────────
  const getCatalog: SkillsCatalogServiceShape["getCatalog"] = (options) =>
    Effect.gen(function* () {
      yield* ensureDir(vendorRoot);
      const force = options?.force === true;

      // 删除 force=false 时直接读缓存退出的逻辑，使得第一次访问时（无缓存或过期）可以主动拉取
      const results = yield* Effect.forEach(
        BUILT_IN_SKILL_SOURCES,
        (source) =>
          refreshSource(source, force).pipe(
            Effect.matchEffect({
              onFailure: (cause) =>
                Effect.logWarning("skills.catalog source failed", {
                  sourceId: source.id,
                  detail: String(cause),
                }).pipe(Effect.as({ ok: false as const, source })),
              onSuccess: (snapshot) => Effect.succeed({ ok: true as const, snapshot }),
            }),
          ),
        { concurrency: 2 },
      );

      const snapshots: SourceCatalogSnapshot[] = [];
      let hasErrors = false;
      for (const result of results) {
        if (result.ok) {
          snapshots.push(result.snapshot);
        } else {
          hasErrors = true;
        }
      }
      const bundledSnapshot = yield* buildBundledCatalogSnapshot();
      if (bundledSnapshot) {
        snapshots.push(bundledSnapshot);
      }
      return { snapshots, hasErrors } satisfies SkillsCatalogState;
    });

  const findCatalogItem: SkillsCatalogServiceShape["findCatalogItem"] = (catalogItemId) =>
    Effect.gen(function* () {
      const colon = catalogItemId.indexOf(":");
      if (colon <= 0) return undefined;
      const sourceId = catalogItemId.slice(0, colon);
      if (sourceId === BUNDLED_SKILL_SOURCE_ID) {
        const snapshot = yield* buildBundledCatalogSnapshot();
        return snapshot?.skills.find((entry) => entry.id === catalogItemId);
      }
      const source = findSkillSource(sourceId);
      if (!source) return undefined;
      const cached = yield* readCacheFile(source);
      if (!cached) return undefined;
      return cached.skills.find((entry) => entry.id === catalogItemId);
    });

  const resolveVendorAssetPath: SkillsCatalogServiceShape["resolveVendorAssetPath"] = (
    sourceId,
    relPath,
  ) =>
    Effect.gen(function* () {
      if (sourceId === BUNDLED_SKILL_SOURCE_ID) {
        const bundledRoot = yield* resolveBundledRoot().pipe(
          Effect.orElseSucceed(() => undefined),
        );
        if (!bundledRoot) return null;
        const safe = sanitizeRelPath(relPath);
        if (safe === null) return null;
        const root = path.resolve(bundledRoot);
        const target = path.resolve(root, safe);
        if (!isInsideDir(root, target)) return null;
        const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => null));
        if (!stat || stat.type !== "File") return null;
        return target;
      }
      const source = findSkillSource(sourceId);
      if (!source) return null;
      const safe = sanitizeRelPath(relPath);
      if (safe === null) return null;
      const checkoutDir = path.resolve(sourceRepoCheckoutDir(source));
      const target = path.resolve(checkoutDir, safe);
      if (!isInsideDir(checkoutDir, target)) return null;
      const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => null));
      if (!stat || stat.type !== "File") return null;
      return target;
    });

  const readCatalogContent: SkillsCatalogServiceShape["readCatalogContent"] = (catalogItemId) =>
    Effect.gen(function* () {
      const item = yield* findCatalogItem(catalogItemId);
      if (!item) return null;
      if (item.sourceId === BUNDLED_SKILL_SOURCE_ID) {
        const bundledRoot = yield* resolveBundledRoot().pipe(
          Effect.orElseSucceed(() => undefined),
        );
        if (!bundledRoot) return null;
        const skillMdPath = path.join(bundledRoot, item.repoPath, "SKILL.md");
        const md = yield* fs.readFileString(skillMdPath).pipe(Effect.orElseSucceed(() => ""));
        if (md.length === 0) return null;
        const parsed = parseSkillDocument(md);
        const assetBaseUrl = `/api/skills/asset?source=${encodeURIComponent(
          BUNDLED_SKILL_SOURCE_ID,
        )}&path=${encodeURIComponent(item.repoPath)}/`;
        return { markdown: parsed.body.trim(), assetBaseUrl };
      }
      const source = findSkillSource(item.sourceId);
      if (!source) return null;
      const checkoutDir = sourceRepoCheckoutDir(source);
      const skillMdPath = path.join(checkoutDir, item.repoPath, "SKILL.md");
      const md = yield* fs.readFileString(skillMdPath).pipe(Effect.orElseSucceed(() => ""));
      if (md.length === 0) return null;
      const parsed = parseSkillDocument(md);
      const assetBaseUrl = `/api/skills/asset?source=${encodeURIComponent(
        source.id,
      )}&path=${encodeURIComponent(item.repoPath)}/`;
      return { markdown: parsed.body.trim(), assetBaseUrl };
    });

  return SkillsCatalogService.of({
    getCatalog,
    warmUp: getCatalog().pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          Effect.logWarning("skills.catalog warmUp failed", {
            detail: String(cause),
          }),
        onSuccess: () => Effect.void,
      }),
    ),
    findCatalogItem,
    resolveVendorAssetPath,
    readCatalogContent,
  });
});

// helpers

function prettifyName(raw: string): string {
  return raw
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeIconPath(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Codex 缓存里偶尔出现绝对路径（如 C:\Users\... 或 /Users/...）；
  // 这种情况下我们丢弃，强制使用相对路径以避免外泄路径。
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith("/")) return null;
  return trimmed.replace(/^\.\//, "").replace(/\\/g, "/");
}

function sanitizeRelPath(input: string): string | null {
  if (input.length === 0) return null;
  if (input.includes("\0")) return null;
  const cleaned = input.replace(/\\/g, "/").replace(/^\/+/, "");
  // 拒绝 .. 段
  const segments = cleaned.split("/");
  for (const segment of segments) {
    if (segment === "..") return null;
  }
  return cleaned;
}

function isInsideDir(parent: string, candidate: string): boolean {
  const normalizedParent = parent.endsWith(separatorOf(parent))
    ? parent
    : `${parent}${separatorOf(parent)}`;
  return candidate === parent || candidate.startsWith(normalizedParent);
}

function separatorOf(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

const isImageAsset = (name: string): boolean => {
  const lower = name.toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
};

const pickFallbackIconPaths = (
  assetFileNames: ReadonlyArray<string>,
): { readonly small: string | null; readonly large: string | null } => {
  const normalized = assetFileNames
    .map((name) => name.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter((name) => name.length > 0 && isImageAsset(name));
  if (normalized.length === 0) {
    return { small: null, large: null };
  }

  const smallCandidate =
    normalized.find((name) => /small|icon|thumb|logo/.test(name.toLowerCase())) ?? normalized[0];
  const largeCandidate =
    normalized.find((name) => /large|cover|hero|banner/.test(name.toLowerCase())) ??
    normalized.find((name) => name !== smallCandidate) ??
    smallCandidate;

  return {
    small: `./${smallCandidate}`,
    large: `./${largeCandidate}`,
  };
};

export const SkillsCatalogServiceLive = Layer.effect(SkillsCatalogService, make()).pipe(
  Layer.provide(ProcessRunnerLive),
);
