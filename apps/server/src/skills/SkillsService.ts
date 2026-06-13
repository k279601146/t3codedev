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
import * as NodeOS from "node:os";

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
import { findSkillSource, repoHttpsUrl } from "./SkillsSources.ts";

const ASSET_BASE = "/api/skills/asset";
const INSTALLED_ASSET_BASE = "/api/skills/installed-asset";

export interface SkillsServiceShape {
  readonly list: () => Effect.Effect<SkillsListResponse, SkillsServiceError>;
  readonly catalog: (options?: {
    readonly force?: boolean;
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
  const source = findSkillSource(entry.sourceId);
  const sourceRepoUrl = source ? repoHttpsUrl(source) : `https://github.com/${entry.sourceId}`;
  const sourceRef = source?.ref ?? "main";
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
      ? { iconSmallUrl: buildAssetUrl(entry.sourceId, entry.repoPath, entry.iconSmall) }
      : {}),
    ...(entry.iconLarge
      ? { iconLargeUrl: buildAssetUrl(entry.sourceId, entry.repoPath, entry.iconLarge) }
      : {}),
  };
};

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
                normalizeAssetRelPath(parsed.frontmatter.iconSmall ?? null) ??
                normalizeAssetRelPath(fallbackIcons.small);
              const large =
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
        ...(fetchedAt > 0 ? { fetchedAt } : {}),
        ...(state.hasErrors ? { hasErrors: true } : {}),
      } satisfies SkillsCatalogResponse;
    });

  const install: SkillsServiceShape["install"] = (input) =>
    Effect.gen(function* () {
      const item = yield* catalog.findCatalogItem(input.catalogItemId).pipe(
        Effect.mapError((cause) => errorFromUnknown("skills.install", cause)),
      );
      if (!item) {
        return yield* Effect.fail(
          new SkillsServiceError({
            detail: `Unknown catalog item: ${input.catalogItemId}`,
            kind: "notFound",
          }),
        );
      }
      const source = findSkillSource(item.sourceId);
      if (!source) {
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
      const sourceDir = path.join(config.baseDir, "vendor_imports", source.id, item.repoPath);
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
