// @effect-diagnostics nodeBuiltinImport:off instanceOfSchema:off unnecessaryFailYieldableError:off
/**
 * SkillsService — 对 ws RPC 暴露的"已安装/推荐 + 安装/卸载"接口。
 *
 * 职责：
 *  - 已安装（list）：从 ProviderRegistry 拉取 codex provider snapshot 中
 *    现成的 skills 数组（已经由 CodexProvider 调 skills/list 缓存）。
 *  - 推荐（catalog）：委托给 SkillsCatalogService。
 *  - 安装（install）：保留独立 Skills 安装入口。当前 codex app-server 尚无
 *    skills/install RPC，因此先使用受限的 legacy curated-copy 兼容路径。
 *  - 卸载（uninstall）：保留独立 Skills 卸载入口。当前 codex app-server 尚无
 *    skills/uninstall RPC，因此只允许删除 CODEX_HOME/skills 下的用户技能目录。
 *
 * 注意：Plugins 和 Skills 是两条独立产品线。插件生命周期由 CodexPluginService
 * 代理；SkillsService 只负责 skills/list/catalog/install/uninstall/content。
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { cp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as NodeOS from "node:os";
import { unzipSync } from "fflate";

import {
  type CodexSettings,
  type InstalledSkill,
  ProviderDriverKind,
  SkillsServiceError,
  type SkillsCatalogResponse,
  type SkillsListResponse,
  type SkillCatalogItem,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import {
  BUNDLED_SKILL_SOURCE_ID,
  resolveBundledExtensionsRoot,
} from "../extensions/BundledExtensions.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { resolveBundledEngineConfig } from "../provider/BundledEngineConfig.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";

import { parseSkillDocument } from "./frontmatter.ts";
import {
  type CatalogSkillEntry,
  SkillsCatalogService,
  SkillsCatalogError,
} from "./SkillsCatalogService.ts";
import { SKILLHUB_SOURCE_ID } from "./SkillHubCatalogProvider.ts";

const ASSET_BASE = "/api/skills/asset";
const INSTALLED_ASSET_BASE = "/api/skills/installed-asset";
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_FILE_COUNT = 500;
const DANGEROUS_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".com",
  ".scr",
  ".wasm",
  ".jar",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
]);

export interface SkillsServiceShape {
  readonly list: () => Effect.Effect<SkillsListResponse, SkillsServiceError>;
  readonly catalog: (options?: {
    readonly force?: boolean;
    readonly query?: string;
    readonly category?: string;
    readonly page?: number;
    readonly pageSize?: number;
    readonly sortBy?: "downloads" | "updated" | "created" | "name";
    readonly order?: "asc" | "desc";
  }) => Effect.Effect<SkillsCatalogResponse, SkillsServiceError>;
  readonly install: (input: {
    readonly catalogItemId: string;
  }) => Effect.Effect<{ marketplaceName: string; alreadyAdded: boolean }, SkillsServiceError>;
  readonly uninstall: (input: {
    readonly skillName: string;
  }) => Effect.Effect<{ removed: boolean }, SkillsServiceError>;
  readonly content: (input: {
    readonly skillName?: string | undefined;
    readonly catalogItemId?: string | undefined;
  }) => Effect.Effect<{ markdown: string; assetBaseUrl?: string }, SkillsServiceError>;
  /** 解析已安装 skill 内的资源绝对路径（用于 HTTP 资源路由白名单） */
  readonly resolveInstalledAssetPath: (input: {
    readonly skillName: string;
    readonly relPath: string;
  }) => Effect.Effect<string | null, SkillsServiceError>;
  readonly warmUp: Effect.Effect<void>;
}

export class SkillsService extends Context.Service<SkillsService, SkillsServiceShape>()(
  "t3/skills/SkillsService",
) {}

// ──────────────────────────────────────────────────────────────────────────

const errorFromUnknown = (operation: string, cause: unknown): SkillsServiceError => {
  if (cause instanceof SkillsServiceError) return cause;
  if (cause instanceof SkillsCatalogError) {
    return new SkillsServiceError({
      detail: `${operation}: ${cause.detail}`,
      kind: "fetchFailed",
    });
  }
  if (cause instanceof Error) {
    return new SkillsServiceError({
      detail: `${operation}: ${cause.message}`,
      kind: "internal",
    });
  }
  return new SkillsServiceError({ detail: `${operation}: ${String(cause)}`, kind: "internal" });
};

const buildAssetUrl = (sourceId: string, repoPath: string, relativePath: string): string => {
  const normRel = relativePath.replace(/^\.\//, "").replace(/\\/g, "/");
  return `${ASSET_BASE}?source=${encodeURIComponent(sourceId)}&path=${encodeURIComponent(
    `${repoPath}/${normRel}`,
  )}`;
};

const buildInstalledAssetUrl = (skillName: string, relativePath: string): string => {
  const normRel = relativePath.replace(/^\.\//, "").replace(/\\/g, "/");
  return `${INSTALLED_ASSET_BASE}?skill=${encodeURIComponent(skillName)}&path=${encodeURIComponent(
    normRel,
  )}`;
};

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const normalizeAssetRelPath = (value: string | null): string | null => {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith("/")) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  const cleaned = trimmed.replace(/^\.\//, "").replace(/\\/g, "/");
  for (const segment of cleaned.split("/")) {
    if (segment === "..") return null;
  }
  return cleaned;
};

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

const catalogEntryToItem = (entry: CatalogSkillEntry): SkillCatalogItem => {
  const sourceRepoUrl =
    entry.sourceId === BUNDLED_SKILL_SOURCE_ID
      ? "t3code://bundled/extensions"
      : entry.sourceId === SKILLHUB_SOURCE_ID
        ? "https://skillhub.cn/skills"
        : (entry.sourceUrl ?? entry.homepage ?? `t3code://${entry.sourceId}`);
  const sourceRef = entry.sourceId === BUNDLED_SKILL_SOURCE_ID ? "bundled" : "remote";
  return {
    id: entry.id,
    name: entry.name,
    displayName: entry.displayName,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.shortDescription ? { shortDescription: entry.shortDescription } : {}),
    sourceId: entry.sourceId,
    sourceRepoUrl,
    sourceRef,
    sparsePath: entry.repoPath,
    ...(entry.iconSmall
      ? {
          iconSmallUrl: isHttpUrl(entry.iconSmall)
            ? entry.iconSmall
            : buildAssetUrl(entry.sourceId, entry.repoPath, entry.iconSmall),
        }
      : {}),
    ...(entry.iconLarge
      ? {
          iconLargeUrl: isHttpUrl(entry.iconLarge)
            ? entry.iconLarge
            : buildAssetUrl(entry.sourceId, entry.repoPath, entry.iconLarge),
        }
      : {}),
    ...(entry.categoryKey ? { categoryKey: entry.categoryKey } : {}),
    ...(entry.categoryName ? { categoryName: entry.categoryName } : {}),
    ...(entry.sourceLabel ? { sourceLabel: entry.sourceLabel } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    ...(entry.downloads !== undefined ? { downloads: entry.downloads } : {}),
    ...(entry.installs !== undefined ? { installs: entry.installs } : {}),
    ...(entry.stars !== undefined ? { stars: entry.stars } : {}),
    ...(entry.requiresApiKey !== undefined ? { requiresApiKey: entry.requiresApiKey } : {}),
    ...(entry.securityStatus ? { securityStatus: entry.securityStatus } : {}),
    ...(entry.homepage ? { homepage: entry.homepage } : {}),
    ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
  };
};

interface PreparedZipSkill {
  readonly skillName: string;
  readonly files: ReadonlyArray<{
    readonly relPath: string;
    readonly bytes: Uint8Array;
  }>;
  readonly securityStatus: "verified" | "unknown";
}

function normalizeZipPath(raw: string): string | null {
  if (raw.length === 0 || raw.includes("\0")) return null;
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (/^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

function pathExtension(relPath: string): string {
  const name = relPath.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function sanitizeInstallSkillName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "skill";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function prepareSkillHubZip(
  zipBytes: Uint8Array,
  item: CatalogSkillEntry,
  manifestFiles: ReadonlyArray<{ readonly path: string; readonly sha256?: string | undefined }>,
): PreparedZipSkill {
  if (zipBytes.byteLength > MAX_ZIP_BYTES) {
    throw new SkillsServiceError({
      detail: `SkillHub ZIP is too large: ${zipBytes.byteLength} bytes.`,
      kind: "internal",
    });
  }

  const unzipped = unzipSync(zipBytes);
  const normalizedEntries = Object.entries(unzipped)
    .map(([rawPath, bytes]) => {
      const relPath = normalizeZipPath(rawPath);
      if (relPath === null) {
        throw new SkillsServiceError({
          detail: `SkillHub ZIP contains unsafe path: ${rawPath}`,
          kind: "internal",
        });
      }
      return { relPath, bytes };
    })
    .filter((entry) => !entry.relPath.endsWith("/"));

  if (normalizedEntries.length > MAX_ZIP_FILE_COUNT) {
    throw new SkillsServiceError({
      detail: `SkillHub ZIP contains too many files: ${normalizedEntries.length}.`,
      kind: "internal",
    });
  }

  let totalBytes = 0;
  for (const entry of normalizedEntries) {
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > MAX_UNZIPPED_BYTES) {
      throw new SkillsServiceError({
        detail: `SkillHub ZIP expands beyond ${MAX_UNZIPPED_BYTES} bytes.`,
        kind: "internal",
      });
    }
  }

  const rootSkill = normalizedEntries.find((entry) => entry.relPath.toLowerCase() === "skill.md");
  const topLevelNames = new Set(
    normalizedEntries
      .map((entry) => entry.relPath.split("/")[0])
      .filter((part): part is string => Boolean(part)),
  );
  const singleTopLevel = topLevelNames.size === 1 ? [...topLevelNames][0] : null;
  const topLevelSkill = singleTopLevel
    ? normalizedEntries.find(
        (entry) => entry.relPath.toLowerCase() === `${singleTopLevel.toLowerCase()}/skill.md`,
      )
    : undefined;
  const stripPrefix = rootSkill
    ? ""
    : topLevelSkill && singleTopLevel
      ? `${singleTopLevel}/`
      : null;
  if (stripPrefix === null) {
    throw new SkillsServiceError({
      detail: "SkillHub ZIP must contain SKILL.md at root or under one top-level directory.",
      kind: "internal",
    });
  }

  const files = normalizedEntries.map((entry) => {
    const relPath =
      stripPrefix && entry.relPath.startsWith(stripPrefix)
        ? entry.relPath.slice(stripPrefix.length)
        : entry.relPath;
    if (!relPath || normalizeZipPath(relPath) !== relPath) {
      throw new SkillsServiceError({
        detail: `SkillHub ZIP contains unsafe normalized path: ${entry.relPath}`,
        kind: "internal",
      });
    }
    const ext = pathExtension(relPath);
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      throw new SkillsServiceError({
        detail: `SkillHub ZIP contains blocked executable or archive file: ${relPath}`,
        kind: "internal",
      });
    }
    return { relPath, bytes: entry.bytes };
  });

  const skillMd = files.find((entry) => entry.relPath.toLowerCase() === "skill.md");
  if (!skillMd) {
    throw new SkillsServiceError({
      detail: "SkillHub ZIP missing SKILL.md after normalization.",
      kind: "internal",
    });
  }

  let securityStatus: "verified" | "unknown" = "unknown";
  const manifestWithHashes = manifestFiles.filter((file) => file.sha256);
  if (manifestWithHashes.length > 0) {
    const byPath = new Map(files.map((file) => [file.relPath.replace(/\\/g, "/"), file.bytes]));
    for (const manifest of manifestWithHashes) {
      const relPath = normalizeZipPath(manifest.path);
      if (!relPath) continue;
      const bytes = byPath.get(relPath);
      if (!bytes) {
        throw new SkillsServiceError({
          detail: `SkillHub ZIP missing manifest file: ${relPath}`,
          kind: "internal",
        });
      }
      if (sha256Hex(bytes) !== manifest.sha256!.toLowerCase()) {
        throw new SkillsServiceError({
          detail: `SkillHub ZIP sha256 mismatch: ${relPath}`,
          kind: "internal",
        });
      }
    }
    securityStatus = "verified";
  }

  const parsed = parseSkillDocument(new TextDecoder().decode(skillMd.bytes));
  const skillName = sanitizeInstallSkillName(parsed.frontmatter.name ?? item.slug ?? item.name);
  return { skillName, files, securityStatus };
}

// ──────────────────────────────────────────────────────────────────────────

interface CodexSkillStorageContext {
  readonly codexHome: string;
  readonly skillsRoot: string;
}

const resolveCodexSkillStorageContext = (
  config: typeof ServerConfig.Service,
  settings: typeof ServerSettingsService.Service,
  path: typeof Path.Path.Service,
) =>
  Effect.gen(function* () {
    const serverSettings = yield* settings.getSettings;
    const codexSettings = (serverSettings.providers.codex ?? {}) as CodexSettings;
    const bundledConfig = resolveBundledEngineConfig(process.env);
    const codexHome =
      bundledConfig?.engineHome ||
      (codexSettings.homePath
        ? expandHomePath(codexSettings.homePath)
        : path.join(NodeOS.homedir(), ".codex"));
    return {
      codexHome,
      skillsRoot: path.join(codexHome, "skills"),
    } satisfies CodexSkillStorageContext;
  });

const make = Effect.fn("makeSkillsService")(function* () {
  const catalog = yield* SkillsCatalogService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const providerRegistry = yield* ProviderRegistry;
  const config = yield* ServerConfig;
  const settings = yield* ServerSettingsService;
  const resolveBundledRoot = () =>
    resolveBundledExtensionsRoot().pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const refreshCodexProvidersInBackground = (reason: "install" | "uninstall", skillName: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("skills provider refresh scheduled", {
        reason,
        skillName,
      });
      yield* providerRegistry.refresh(ProviderDriverKind.make("codex"));
      yield* Effect.logInfo("skills provider refresh finished", {
        reason,
        skillName,
      });
    }).pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const resolveStorageContext = () =>
    resolveCodexSkillStorageContext(config, settings, path).pipe(
      Effect.mapError((cause) => errorFromUnknown("skills.storage", cause)),
    );

  const isPathInside = (parent: string, child: string): boolean => {
    const normalizedParent = path.resolve(parent);
    const normalizedChild = path.resolve(child);
    const sep = normalizedParent.includes("\\") ? "\\" : "/";
    const prefix = normalizedParent.endsWith(sep) ? normalizedParent : `${normalizedParent}${sep}`;
    return normalizedChild === normalizedParent || normalizedChild.startsWith(prefix);
  };

  /**
   * codex skills/list 返回的 path 既可能指向 SKILL.md 文件，也可能指向 skill 目录（旧版）。
   * 我们统一规整为 skill 目录路径，便于后续读 SKILL.md / 资源。
   */
  const resolveSkillDir = (rawPath: string) =>
    Effect.gen(function* () {
      const stat = yield* fs.stat(rawPath).pipe(Effect.orElseSucceed(() => null));
      if (stat && stat.type === "Directory") {
        return rawPath;
      }
      // 文件、不存在、或其它类型：剥掉文件名得目录
      const base = path.basename(rawPath);
      if (/^skill\.md$/i.test(base)) {
        return path.dirname(rawPath);
      }
      // 兜底：当成目录的父级
      if (stat && stat.type === "File") {
        return path.dirname(rawPath);
      }
      return rawPath;
    });

  const findInstalledSkillDir = (skillName: string) =>
    Effect.gen(function* () {
      const providers = yield* providerRegistry.getProviders;
      for (const provider of providers) {
        const found = provider.skills.find((s) => s.name === skillName);
        if (!found) continue;
        const dir = yield* resolveSkillDir(found.path);
        return dir;
      }
      return null;
    });

  const list: SkillsServiceShape["list"] = () =>
    Effect.gen(function* () {
      const providers = yield* providerRegistry.getProviders;
      const skills: InstalledSkill[] = [];
      const seen = new Set<string>();
      for (const provider of providers) {
        const providerSkills = Array.isArray(provider.skills) ? provider.skills : [];
        for (const raw of providerSkills) {
          if (seen.has(raw.name)) continue;
          seen.add(raw.name);
          const scope = ((): InstalledSkill["scope"] => {
            switch (raw.scope) {
              case "system":
              case "user":
              case "repo":
              case "admin":
                return raw.scope;
              default:
                return "user";
            }
          })();

          // 解析 SKILL.md 中的 iconSmall/iconLarge frontmatter，给前端 <img> 直接消费。
          // raw.path 既可能是 SKILL.md 文件路径，也可能是 skill 目录路径，统一兼容。
          const skillDir = yield* resolveSkillDir(raw.path).pipe(Effect.orElseSucceed(() => null));
          let iconSmallUrl: string | undefined;
          let iconLargeUrl: string | undefined;
          if (skillDir) {
            const skillMdPath = path.join(skillDir, "SKILL.md");
            const md = yield* fs.readFileString(skillMdPath).pipe(Effect.orElseSucceed(() => ""));
            if (md.length > 0) {
              const parsed = parseSkillDocument(md);
              const assetDir = path.join(skillDir, "assets");
              const assetEntries = yield* fs
                .readDirectory(assetDir)
                .pipe(Effect.orElseSucceed(() => []));
              const fallbackIcons = pickFallbackIconPaths(
                assetEntries.map((asset) => `assets/${asset}`),
              );
              const small =
                normalizeAssetRelPath(parsed.frontmatter.iconUrl ?? null) ??
                normalizeAssetRelPath(parsed.frontmatter.iconSmall ?? null) ??
                normalizeAssetRelPath(fallbackIcons.small);
              const large =
                normalizeAssetRelPath(parsed.frontmatter.iconUrl ?? null) ??
                normalizeAssetRelPath(parsed.frontmatter.iconLarge ?? null) ??
                normalizeAssetRelPath(fallbackIcons.large);
              if (small) iconSmallUrl = buildInstalledAssetUrl(raw.name, small);
              if (large) iconLargeUrl = buildInstalledAssetUrl(raw.name, large);
            }
          }

          skills.push({
            name: raw.name,
            ...(raw.displayName ? { displayName: raw.displayName } : {}),
            ...(raw.description ? { description: raw.description } : {}),
            ...(raw.shortDescription ? { shortDescription: raw.shortDescription } : {}),
            scope,
            enabled: raw.enabled,
            ...(iconSmallUrl ? { iconSmallUrl } : {}),
            ...(iconLargeUrl ? { iconLargeUrl } : {}),
          });
        }
      }
      skills.sort((a, b) => a.name.localeCompare(b.name));
      return { skills } satisfies SkillsListResponse;
    }).pipe(Effect.mapError((cause) => errorFromUnknown("skills.list", cause)));

  const catalogResponse: SkillsServiceShape["catalog"] = (options) =>
    Effect.gen(function* () {
      const state = yield* catalog.getCatalog(options).pipe(
        Effect.tapError((cause) =>
          Effect.logError("skills.catalog failed", { detail: String(cause) }),
        ),
        Effect.mapError((cause) => errorFromUnknown("skills.catalog", cause)),
      );
      const items: SkillCatalogItem[] = [];
      let fetchedAt = 0;
      for (const snapshot of state.snapshots) {
        if (snapshot.fetchedAt > fetchedAt) fetchedAt = snapshot.fetchedAt;
        for (const entry of snapshot.skills) {
          items.push(catalogEntryToItem(entry));
        }
      }
      items.sort((a, b) => a.displayName.localeCompare(b.displayName));
      return {
        items,
        categories: [...state.categories],
        total: state.total,
        page: state.page,
        pageSize: state.pageSize,
        ...(fetchedAt > 0 ? { fetchedAt } : {}),
        ...(state.hasErrors ? { hasErrors: true } : {}),
      } satisfies SkillsCatalogResponse;
    });

  const install: SkillsServiceShape["install"] = (input) =>
    Effect.gen(function* () {
      const item = yield* catalog
        .findCatalogItem(input.catalogItemId)
        .pipe(Effect.mapError((cause) => errorFromUnknown("skills.install", cause)));
      if (!item) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `Unknown catalog item: ${input.catalogItemId}`,
            kind: "notFound",
          }),
        );
      }
      const isBundledSkill = item.sourceId === BUNDLED_SKILL_SOURCE_ID;
      const isSkillHubSkill = item.sourceId === SKILLHUB_SOURCE_ID;
      if (!isBundledSkill && !isSkillHubSkill) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `Unknown source: ${item.sourceId}`,
            kind: "notFound",
          }),
        );
      }

      const storage = yield* resolveStorageContext().pipe(
        Effect.mapError((cause) => errorFromUnknown("skills.install", cause)),
      );

      if (isSkillHubSkill) {
        const [zipBytes, manifestFiles] = yield* Effect.all(
          [
            catalog.downloadCatalogZip(input.catalogItemId),
            catalog.readCatalogFiles(input.catalogItemId),
          ],
          { concurrency: 2 },
        ).pipe(Effect.mapError((cause) => errorFromUnknown("skills.install", cause)));
        if (!zipBytes) {
          return yield* Effect.fail(
            new SkillsServiceError({
              detail: `SkillHub ZIP not found: ${input.catalogItemId}`,
              kind: "notFound",
            }),
          );
        }
        const prepared = yield* Effect.try({
          try: () => prepareSkillHubZip(zipBytes, item, manifestFiles ?? []),
          catch: (cause) => errorFromUnknown("skills.install", cause),
        });
        const targetDir = path.join(storage.skillsRoot, prepared.skillName);
        if (!isPathInside(storage.skillsRoot, targetDir)) {
          return yield* Effect.fail(
            new SkillsServiceError({
              detail: `Cannot install skill outside CODEX_HOME/skills: ${targetDir}`,
              kind: "internal",
            }),
          );
        }
        const exists = yield* fs.exists(targetDir).pipe(Effect.orElseSucceed(() => false));
        if (exists) {
          yield* refreshCodexProvidersInBackground("install", prepared.skillName);
          return { marketplaceName: prepared.skillName, alreadyAdded: true };
        }

        yield* fs.makeDirectory(targetDir, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new SkillsServiceError({
                detail: `Creating skill directory failed: ${String(cause)}`,
                kind: "internal",
              }),
          ),
        );
        for (const file of prepared.files) {
          const targetPath = path.join(targetDir, file.relPath);
          if (!isPathInside(targetDir, targetPath)) {
            return yield* Effect.fail(
              new SkillsServiceError({
                detail: `Cannot write skill file outside target directory: ${file.relPath}`,
                kind: "internal",
              }),
            );
          }
          yield* fs.makeDirectory(path.dirname(targetPath), { recursive: true }).pipe(
            Effect.mapError(
              (cause) =>
                new SkillsServiceError({
                  detail: `Creating skill subdirectory failed: ${String(cause)}`,
                  kind: "internal",
                }),
            ),
          );
          yield* fs.writeFile(targetPath, file.bytes).pipe(
            Effect.mapError(
              (cause) =>
                new SkillsServiceError({
                  detail: `Writing skill file failed: ${String(cause)}`,
                  kind: "internal",
                }),
            ),
          );
        }
        yield* Effect.logInfo("skills.install installed SkillHub ZIP", {
          skillName: prepared.skillName,
          catalogItemId: input.catalogItemId,
          securityStatus: prepared.securityStatus,
          targetDir,
        });
        yield* refreshCodexProvidersInBackground("install", prepared.skillName);
        return { marketplaceName: prepared.skillName, alreadyAdded: false };
      }

      const sourceDir = isBundledSkill
        ? yield* resolveBundledRoot().pipe(
            Effect.flatMap((bundledRoot) =>
              bundledRoot
                ? Effect.succeed(path.join(bundledRoot, item.repoPath))
                : Effect.fail(
                    new SkillsServiceError({
                      detail: "Bundled extensions directory was not found.",
                      kind: "notFound",
                    }),
                  ),
            ),
            Effect.mapError((cause) => errorFromUnknown("skills.install", cause)),
          )
        : path.join(config.baseDir, "vendor_imports", item.sourceId, item.repoPath);
      const targetDir = path.join(storage.skillsRoot, item.name);

      if (!isPathInside(storage.skillsRoot, targetDir)) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `Cannot install skill outside CODEX_HOME/skills: ${targetDir}`,
            kind: "internal",
          }),
        );
      }

      const sourceExists = yield* fs.exists(sourceDir).pipe(Effect.orElseSucceed(() => false));
      if (!sourceExists) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `Catalog skill files not found: ${sourceDir}. Please refresh Skills catalog first.`,
            kind: "notFound",
          }),
        );
      }

      const exists = yield* fs.exists(targetDir).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        yield* Effect.logInfo("skills.install detected existing skill", {
          skillName: item.name,
          catalogItemId: input.catalogItemId,
          targetDir,
        });
        yield* refreshCodexProvidersInBackground("install", item.name);
        return { marketplaceName: item.name, alreadyAdded: true };
      }

      yield* Effect.logInfo("skills.install using legacy curated-copy fallback", {
        skillName: item.name,
        catalogItemId: input.catalogItemId,
        sourceDir,
        targetDir,
      });

      yield* fs.makeDirectory(storage.skillsRoot, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new SkillsServiceError({
              detail: `Creating skills directory failed: ${String(cause)}`,
              kind: "internal",
            }),
        ),
      );
      yield* Effect.promise(() => cp(sourceDir, targetDir, { recursive: true })).pipe(
        Effect.mapError(
          (cause) =>
            new SkillsServiceError({
              detail: `Copying skill files failed: ${String(cause)}`,
              kind: "internal",
            }),
        ),
      );

      yield* refreshCodexProvidersInBackground("install", item.name);
      return { marketplaceName: item.name, alreadyAdded: false };
    });

  const uninstall: SkillsServiceShape["uninstall"] = (input) =>
    Effect.gen(function* () {
      const skillDir = yield* findInstalledSkillDir(input.skillName);
      if (!skillDir) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: "Cannot determine path for this skill. It may be a built-in or repo skill.",
            kind: "notFound",
          }),
        );
      }

      const storage = yield* resolveStorageContext().pipe(
        Effect.mapError((cause) => errorFromUnknown("skills.uninstall", cause)),
      );
      if (!isPathInside(storage.skillsRoot, skillDir)) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `Cannot uninstall skill because its path (${skillDir}) is outside CODEX_HOME/skills. It may be a built-in, repo, admin, or plugin-provided skill.`,
            kind: "internal",
          }),
        );
      }

      yield* Effect.logInfo("skills.uninstall using legacy curated-copy fallback", {
        skillName: input.skillName,
        skillDir,
      });
      yield* Effect.promise(() => rm(skillDir, { recursive: true, force: true })).pipe(
        Effect.mapError(
          (cause) =>
            new SkillsServiceError({
              detail: `Removing skill files failed: ${String(cause)}`,
              kind: "internal",
            }),
        ),
      );

      yield* refreshCodexProvidersInBackground("uninstall", input.skillName);
      return { removed: true };
    });

  const content: SkillsServiceShape["content"] = (input) =>
    Effect.gen(function* () {
      if (input.catalogItemId) {
        const result = yield* catalog
          .readCatalogContent(input.catalogItemId)
          .pipe(Effect.mapError((cause) => errorFromUnknown("skills.content", cause)));
        if (!result) {
          return yield* Effect.fail(
            new SkillsServiceError({
              detail: `Catalog item not found: ${input.catalogItemId}`,
              kind: "notFound",
            }),
          );
        }
        return {
          markdown: result.markdown,
          ...(result.assetBaseUrl ? { assetBaseUrl: result.assetBaseUrl } : {}),
        };
      }

      if (!input.skillName) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: "skillName or catalogItemId required",
          }),
        );
      }

      // 已安装的 SKILL.md 在本地，但出于沙箱考虑我们不直接读任意路径；
      // 用 codex skills/list 给出的 path 反查目录读 SKILL.md。
      const skillDir = yield* findInstalledSkillDir(input.skillName);
      if (!skillDir) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `Installed skill not found: ${input.skillName}`,
            kind: "notFound",
          }),
        );
      }
      const skillMdPath = path.join(skillDir, "SKILL.md");
      const md = yield* fs.readFileString(skillMdPath).pipe(Effect.orElseSucceed(() => ""));
      if (md.length === 0) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `SKILL.md not found at ${skillMdPath}`,
            kind: "notFound",
          }),
        );
      }
      const parsed = parseSkillDocument(md);
      const assetBaseUrl = `${INSTALLED_ASSET_BASE}?skill=${encodeURIComponent(
        input.skillName,
      )}&path=`;
      return { markdown: parsed.body.trim(), assetBaseUrl };
    });

  const resolveInstalledAssetPath: SkillsServiceShape["resolveInstalledAssetPath"] = (input) =>
    Effect.gen(function* () {
      const skillDir = yield* findInstalledSkillDir(input.skillName);
      if (!skillDir) return null;
      const safe = normalizeAssetRelPath(input.relPath);
      if (safe === null) return null;
      const resolvedSkillDir = path.resolve(skillDir);
      const target = path.resolve(resolvedSkillDir, safe);
      // 安全：禁止越权
      const sep = resolvedSkillDir.includes("\\") ? "\\" : "/";
      const prefix = resolvedSkillDir.endsWith(sep)
        ? resolvedSkillDir
        : `${resolvedSkillDir}${sep}`;
      if (target !== resolvedSkillDir && !target.startsWith(prefix)) return null;
      const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => null));
      if (!stat || stat.type !== "File") return null;
      return target;
    }).pipe(
      Effect.mapError((cause) => errorFromUnknown("skills.resolveInstalledAssetPath", cause)),
    );

  return SkillsService.of({
    list,
    catalog: catalogResponse,
    install,
    uninstall,
    content,
    resolveInstalledAssetPath,
    warmUp: catalog.warmUp,
  });
});

export const SkillsServiceLive = Layer.effect(SkillsService, make());
