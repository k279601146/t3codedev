// @effect-diagnostics globalDate:off
/**
 * SkillsCatalogService — 技能目录聚合服务。
 *
 * 远程源默认只启用 SkillHub；T3 随包分发的 extensions/skills 继续作为本地内置源合并。
 * 这里不再拉取 OpenAI curated GitHub 源，也不执行任何第三方安装脚本。
 */

import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import { HttpClient } from "effect/unstable/http";

import type { SkillCatalogCategory } from "@t3tools/contracts";

import {
  BUNDLED_SKILL_SOURCE_ID,
  resolveBundledExtensionsRoot,
} from "../extensions/BundledExtensions.ts";

import { parseSkillDocument } from "./frontmatter.ts";
import {
  type CatalogSkillEntry,
  type SkillCatalogProvider,
  SkillCatalogProviderError,
  type SkillCatalogQuery,
  type SkillHubFileEntry,
} from "./SkillCatalogProvider.ts";
import { makeSkillHubCatalogProvider, SKILLHUB_SOURCE_ID } from "./SkillHubCatalogProvider.ts";
import type { SkillSource } from "./SkillsSources.ts";

export type { CatalogSkillEntry } from "./SkillCatalogProvider.ts";

const BUNDLED_SKILL_SOURCE: SkillSource = {
  id: BUNDLED_SKILL_SOURCE_ID,
  displayName: "T3 Built-in Skills",
  repo: "t3tools/t3code",
  ref: "bundled",
  curatedPath: "skills",
};
const SKILLS_CATALOG_CACHE_TTL_MS = 60_000;
const BUNDLED_SKILLS_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  readonly expiresAtMs: number;
  readonly value: T;
}

function isCacheEntryFresh<T>(entry: CacheEntry<T> | undefined, nowMs: number): entry is CacheEntry<T> {
  return entry !== undefined && entry.expiresAtMs > nowMs;
}

function catalogCacheKey(options?: SkillCatalogQuery): string {
  return JSON.stringify({
    category: options?.category?.trim() ?? "",
    order: options?.order ?? "",
    page: options?.page ?? null,
    pageSize: options?.pageSize ?? null,
    query: options?.query?.trim() ?? "",
    sortBy: options?.sortBy ?? "",
  });
}

export interface SourceCatalogSnapshot {
  readonly source: SkillSource;
  readonly fetchedAt: number;
  readonly skills: ReadonlyArray<CatalogSkillEntry>;
}

export interface SkillsCatalogState {
  readonly snapshots: ReadonlyArray<SourceCatalogSnapshot>;
  readonly categories: ReadonlyArray<SkillCatalogCategory>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
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
  readonly getCatalog: (
    options?: SkillCatalogQuery,
  ) => Effect.Effect<SkillsCatalogState, SkillsCatalogError>;
  readonly warmUp: Effect.Effect<void>;
  readonly findCatalogItem: (
    catalogItemId: string,
  ) => Effect.Effect<CatalogSkillEntry | undefined, SkillsCatalogError>;
  readonly resolveVendorAssetPath: (
    sourceId: string,
    relPath: string,
  ) => Effect.Effect<string | null, SkillsCatalogError>;
  readonly readCatalogContent: (
    catalogItemId: string,
  ) => Effect.Effect<{ markdown: string; assetBaseUrl?: string } | null, SkillsCatalogError>;
  readonly readCatalogFiles: (
    catalogItemId: string,
  ) => Effect.Effect<ReadonlyArray<SkillHubFileEntry> | null, SkillsCatalogError>;
  readonly downloadCatalogZip: (
    catalogItemId: string,
  ) => Effect.Effect<Uint8Array | null, SkillsCatalogError>;
}

export class SkillsCatalogService extends Context.Service<
  SkillsCatalogService,
  SkillsCatalogServiceShape
>()("t3/skills/SkillsCatalogService") {}

const make = Effect.fn("makeSkillsCatalogService")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const providers: ReadonlyArray<SkillCatalogProvider> = [makeSkillHubCatalogProvider(httpClient)];
  const catalogCacheRef = yield* Ref.make(new Map<string, CacheEntry<SkillsCatalogState>>());
  const bundledCacheRef = yield* Ref.make<CacheEntry<ReadonlyArray<CatalogSkillEntry>> | null>(
    null,
  );

  const resolveBundledRoot = () =>
    resolveBundledExtensionsRoot().pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const providerSource = (provider: SkillCatalogProvider): SkillSource => ({
    id: provider.sourceId,
    displayName: provider.displayName,
    repo: provider.sourceId,
    ref: "remote",
    curatedPath: "",
  });

  const buildCatalogFromSkillsDirectory = Effect.fn("buildCatalogFromSkillsDirectory")(
    function* (input: {
      readonly source: SkillSource;
      readonly skillsDir: string;
      readonly repoPathPrefix: string;
    }) {
      const exists = yield* fs.exists(input.skillsDir).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return [] as ReadonlyArray<CatalogSkillEntry>;

      const dirEntries = yield* fs
        .readDirectory(input.skillsDir)
        .pipe(Effect.orElseSucceed(() => []));
      const entries: CatalogSkillEntry[] = [];

      for (const entryName of dirEntries) {
        const entryPath = path.join(input.skillsDir, entryName);
        const stat = yield* fs.stat(entryPath).pipe(Effect.orElseSucceed(() => null));
        if (!stat || stat.type !== "Directory" || entryName.startsWith(".")) continue;

        const skillMdPath = path.join(entryPath, "SKILL.md");
        const md = yield* fs.readFileString(skillMdPath).pipe(Effect.orElseSucceed(() => ""));
        if (md.length === 0) continue;

        const parsed = parseSkillDocument(md);
        const name = (parsed.frontmatter.name ?? entryName).trim();
        if (name.length === 0) continue;

        const displayName = parsed.frontmatter.displayName?.trim() || prettifyName(name);
        const assetsDir = path.join(entryPath, "assets");
        const assetEntries = yield* fs
          .readDirectory(assetsDir)
          .pipe(Effect.orElseSucceed(() => []));
        const fallbackIcons = pickFallbackIconPaths(assetEntries.map((asset) => `assets/${asset}`));
        const iconSmall =
          normalizeIconPath(parsed.frontmatter.iconUrl ?? null) ??
          normalizeIconPath(parsed.frontmatter.iconSmall ?? null) ??
          normalizeIconPath(fallbackIcons.small);
        const iconLarge =
          normalizeIconPath(parsed.frontmatter.iconUrl ?? null) ??
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
          sourceLabel: "T3 内置",
          securityStatus: "verified",
        });
      }

      entries.sort((a, b) => a.name.localeCompare(b.name));
      return entries as ReadonlyArray<CatalogSkillEntry>;
    },
  );

  const loadBundledSkills = Effect.fn("SkillsCatalogService.loadBundledSkills")(function* (
    options?: { readonly force?: boolean | undefined },
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    const cached = yield* Ref.get(bundledCacheRef);
    if (options?.force !== true && cached !== null && cached.expiresAtMs > nowMs) {
      return cached.value;
    }
    const bundledRoot = yield* resolveBundledRoot().pipe(Effect.orElseSucceed(() => undefined));
    if (!bundledRoot) return [] as ReadonlyArray<CatalogSkillEntry>;
    const skills = yield* buildCatalogFromSkillsDirectory({
      source: BUNDLED_SKILL_SOURCE,
      skillsDir: path.join(bundledRoot, "skills"),
      repoPathPrefix: "skills",
    });
    yield* Ref.set(bundledCacheRef, {
      expiresAtMs: nowMs + BUNDLED_SKILLS_CACHE_TTL_MS,
      value: skills,
    });
    return skills;
  });

  const buildBundledCatalogSnapshot = Effect.fn("buildBundledCatalogSnapshot")(function* (
    query?: SkillCatalogQuery,
  ) {
    const skills = yield* loadBundledSkills({ force: query?.force });
    const filtered = filterCatalogEntries(skills, query);
    if (filtered.length === 0) return undefined;
    const fetchedAt = yield* Clock.currentTimeMillis;
    return {
      source: BUNDLED_SKILL_SOURCE,
      fetchedAt,
      skills: filtered,
    } satisfies SourceCatalogSnapshot;
  });

  const loadCatalog = Effect.fn("SkillsCatalogService.loadCatalog")(function* (
    options?: SkillCatalogQuery,
  ) {
    const page = clampPositiveInteger(options?.page, 1, 1, 500);
    const pageSize = clampPositiveInteger(options?.pageSize, 20, 1, 100);
    const results = yield* Effect.forEach(
      providers,
      (provider) =>
        provider.list({ ...options, page, pageSize }).pipe(
          Effect.matchEffect({
            onFailure: (cause) =>
              Effect.logWarning("skills.catalog provider failed", {
                sourceId: provider.sourceId,
                detail: String(cause),
              }).pipe(Effect.as({ ok: false as const, provider })),
            onSuccess: (result) => Effect.succeed({ ok: true as const, provider, result }),
          }),
        ),
      { concurrency: 2 },
    );

    const snapshots: SourceCatalogSnapshot[] = [];
    const categories: SkillCatalogCategory[] = [];
    let total = 0;
    let fetchedAt = 0;
    let hasErrors = false;
    for (const result of results) {
      if (!result.ok) {
        hasErrors = true;
        continue;
      }
      if (result.result.fetchedAt > fetchedAt) fetchedAt = result.result.fetchedAt;
      total += result.result.total;
      categories.push(...result.result.categories);
      snapshots.push({
        source: providerSource(result.provider),
        fetchedAt: result.result.fetchedAt,
        skills: result.result.items,
      });
    }

    const bundledSnapshot = yield* buildBundledCatalogSnapshot(options);
    if (bundledSnapshot) {
      snapshots.push(bundledSnapshot);
      total += bundledSnapshot.skills.length;
    }

    return {
      snapshots,
      categories: dedupeCategories(categories),
      total,
      page,
      pageSize,
      hasErrors,
    } satisfies SkillsCatalogState;
  });

  const getCatalog: SkillsCatalogServiceShape["getCatalog"] = (options) =>
    Effect.gen(function* () {
      const key = catalogCacheKey(options);
      const nowMs = yield* Clock.currentTimeMillis;
      const cached = (yield* Ref.get(catalogCacheRef)).get(key);
      if (options?.force !== true && isCacheEntryFresh(cached, nowMs)) {
        return cached.value;
      }
      const state = yield* loadCatalog(options);
      yield* Ref.update(catalogCacheRef, (cache) => {
        const next = new Map(cache);
        next.set(key, {
          expiresAtMs: nowMs + SKILLS_CATALOG_CACHE_TTL_MS,
          value: state,
        });
        return next;
      });
      return state;
    });

  const findCatalogItem: SkillsCatalogServiceShape["findCatalogItem"] = (catalogItemId) =>
    Effect.gen(function* () {
      const sourceId = sourceIdFromCatalogItemId(catalogItemId);
      if (sourceId === BUNDLED_SKILL_SOURCE_ID) {
        const snapshot = yield* buildBundledCatalogSnapshot();
        return snapshot?.skills.find((entry) => entry.id === catalogItemId);
      }
      const provider = providers.find((candidate) => candidate.sourceId === sourceId);
      if (!provider) return undefined;
      return yield* provider
        .find(catalogItemId)
        .pipe(Effect.mapError((cause) => errorFromProvider("skills.catalog.find", cause)));
    });

  const resolveVendorAssetPath: SkillsCatalogServiceShape["resolveVendorAssetPath"] = (
    sourceId,
    relPath,
  ) =>
    Effect.gen(function* () {
      if (sourceId === BUNDLED_SKILL_SOURCE_ID) {
        const bundledRoot = yield* resolveBundledRoot().pipe(Effect.orElseSucceed(() => undefined));
        if (!bundledRoot) return null;
        const safe = sanitizeRelPath(relPath);
        if (safe === null) return null;
        const root = path.resolve(bundledRoot);
        const target = path.resolve(root, safe);
        if (!isInsideDir(root, target)) return null;
        const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => null));
        return stat && stat.type === "File" ? target : null;
      }
      const provider = providers.find((candidate) => candidate.sourceId === sourceId);
      if (!provider) return null;
      return yield* provider
        .resolveAssetPath(sourceId, relPath)
        .pipe(Effect.mapError((cause) => errorFromProvider("skills.catalog.asset", cause)));
    });

  const readCatalogContent: SkillsCatalogServiceShape["readCatalogContent"] = (catalogItemId) =>
    Effect.gen(function* () {
      const item = yield* findCatalogItem(catalogItemId);
      if (!item) return null;
      if (item.sourceId === BUNDLED_SKILL_SOURCE_ID) {
        const bundledRoot = yield* resolveBundledRoot().pipe(Effect.orElseSucceed(() => undefined));
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
      const provider = providers.find((candidate) => candidate.sourceId === item.sourceId);
      if (!provider) return null;
      return yield* provider
        .readContent(catalogItemId)
        .pipe(Effect.mapError((cause) => errorFromProvider("skills.catalog.content", cause)));
    });

  const readCatalogFiles: SkillsCatalogServiceShape["readCatalogFiles"] = (catalogItemId) =>
    Effect.gen(function* () {
      const sourceId = sourceIdFromCatalogItemId(catalogItemId);
      const provider = providers.find((candidate) => candidate.sourceId === sourceId);
      if (!provider) return null;
      return yield* provider
        .readFiles(catalogItemId)
        .pipe(Effect.mapError((cause) => errorFromProvider("skills.catalog.files", cause)));
    });

  const downloadCatalogZip: SkillsCatalogServiceShape["downloadCatalogZip"] = (catalogItemId) =>
    Effect.gen(function* () {
      const sourceId = sourceIdFromCatalogItemId(catalogItemId);
      const provider = providers.find((candidate) => candidate.sourceId === sourceId);
      if (!provider) return null;
      return yield* provider
        .downloadZip(catalogItemId)
        .pipe(Effect.mapError((cause) => errorFromProvider("skills.catalog.download", cause)));
    });

  return SkillsCatalogService.of({
    getCatalog,
    warmUp: getCatalog().pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          Effect.logWarning("skills.catalog warmUp failed", { detail: String(cause) }),
        onSuccess: () => Effect.void,
      }),
    ),
    findCatalogItem,
    resolveVendorAssetPath,
    readCatalogContent,
    readCatalogFiles,
    downloadCatalogZip,
  });
});

function errorFromProvider(
  operation: string,
  cause: SkillCatalogProviderError,
): SkillsCatalogError {
  return new SkillsCatalogError({
    detail: `${operation}: ${cause.detail}`,
    cause,
  });
}

function sourceIdFromCatalogItemId(catalogItemId: string): string {
  const colon = catalogItemId.indexOf(":");
  return colon > 0 ? catalogItemId.slice(0, colon) : "";
}

function filterCatalogEntries(
  entries: ReadonlyArray<CatalogSkillEntry>,
  query?: SkillCatalogQuery,
): ReadonlyArray<CatalogSkillEntry> {
  const search = query?.query?.trim().toLowerCase();
  const category = query?.category?.trim();
  return entries.filter((entry) => {
    if (category && category !== "all" && entry.categoryKey !== category) return false;
    if (!search) return true;
    return [entry.name, entry.displayName, entry.description, entry.shortDescription]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(search));
  });
}

function dedupeCategories(
  categories: ReadonlyArray<SkillCatalogCategory>,
): ReadonlyArray<SkillCatalogCategory> {
  const map = new Map<string, SkillCatalogCategory>();
  for (const category of categories) {
    if (!map.has(category.key)) map.set(category.key, category);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function clampPositiveInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

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
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith("/")) return null;
  return trimmed.replace(/^\.\//, "").replace(/\\/g, "/");
}

function sanitizeRelPath(input: string): string | null {
  if (input.length === 0 || input.includes("\0")) return null;
  const cleaned = input.replace(/\\/g, "/").replace(/^\/+/, "");
  for (const segment of cleaned.split("/")) {
    if (segment === "..") return null;
  }
  return cleaned;
}

function isInsideDir(parent: string, candidate: string): boolean {
  const sep = parent.includes("\\") ? "\\" : "/";
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return candidate === parent || candidate.startsWith(normalizedParent);
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
  if (normalized.length === 0) return { small: null, large: null };
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

export { SKILLHUB_SOURCE_ID };

export const SkillsCatalogServiceLive = Layer.effect(SkillsCatalogService, make());
