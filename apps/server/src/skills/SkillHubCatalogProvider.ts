// @effect-diagnostics preferSchemaOverJson:off tryCatchInEffectGen:off globalDate:off
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";

import {
  type CatalogSkillEntry,
  type SkillCatalogProvider,
  SkillCatalogProviderError,
  type SkillCatalogProviderResult,
  type SkillCatalogQuery,
  type SkillHubFileEntry,
} from "./SkillCatalogProvider.ts";

const API_BASE = "https://api.skillhub.cn";
const SOURCE_ID = "skillhub";
const SOURCE_LABEL = "SkillHub";
const REQUEST_TIMEOUT = Duration.seconds(30);
const USER_AGENT = "t3code-skillhub-catalog";

export const SKILLHUB_SOURCE_ID = SOURCE_ID;

export function makeSkillHubCatalogProvider(
  httpClient: HttpClient.HttpClient,
): SkillCatalogProvider {
  void httpClient;
  const headers = {
    accept: "application/json",
    "user-agent": USER_AGENT,
  };

  const execute = (url: string) =>
    Effect.tryPromise({
      try: () => fetch(url, { headers, redirect: "follow" }),
      catch: (cause) =>
        new SkillCatalogProviderError({
          detail: `SkillHub request failed: ${url}`,
          cause,
        }),
    }).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError((cause) =>
        cause instanceof SkillCatalogProviderError
          ? cause
          : new SkillCatalogProviderError({
              detail: `SkillHub request timed out: ${url}`,
              cause,
            }),
      ),
    );

  const fetchJson = <T>(url: string) =>
    execute(url).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.tryPromise({
              try: () => response.text(),
              catch: (cause) =>
                new SkillCatalogProviderError({
                  detail: `SkillHub response text failed: ${url}`,
                  cause,
                }),
            }).pipe(
              Effect.flatMap((text) =>
                Effect.try({
                  try: () => JSON.parse(text) as T,
                  catch: (cause) =>
                    new SkillCatalogProviderError({
                      detail: `SkillHub returned invalid JSON: ${url}`,
                      cause,
                    }),
                }),
              ),
            )
          : Effect.fail(
              new SkillCatalogProviderError({
                detail: `SkillHub returned HTTP ${response.status}: ${url}`,
              }),
            ),
      ),
    );

  const fetchText = (url: string) =>
    execute(url).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.tryPromise({
              try: () => response.text(),
              catch: (cause) =>
                new SkillCatalogProviderError({
                  detail: `SkillHub response text failed: ${url}`,
                  cause,
                }),
            })
          : Effect.fail(
              new SkillCatalogProviderError({
                detail: `SkillHub returned HTTP ${response.status}: ${url}`,
              }),
            ),
      ),
      Effect.mapError((cause) =>
        cause instanceof SkillCatalogProviderError
          ? cause
          : new SkillCatalogProviderError({
              detail: `SkillHub text response failed: ${url}`,
              cause,
            }),
      ),
    );

  const fetchBytes = (url: string) =>
    execute(url).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.tryPromise({
              try: () => response.arrayBuffer(),
              catch: (cause) =>
                new SkillCatalogProviderError({
                  detail: `SkillHub response bytes failed: ${url}`,
                  cause,
                }),
            }).pipe(Effect.map((buffer) => new Uint8Array(buffer)))
          : Effect.fail(
              new SkillCatalogProviderError({
                detail: `SkillHub returned HTTP ${response.status}: ${url}`,
              }),
            ),
      ),
      Effect.mapError((cause) =>
        cause instanceof SkillCatalogProviderError
          ? cause
          : new SkillCatalogProviderError({
              detail: `SkillHub download failed: ${url}`,
              cause,
            }),
      ),
    );

  const fetchCategories = () =>
    fetchJson<unknown>(`${API_BASE}/api/v1/categories`).pipe(
      Effect.map((payload) => normalizeCategories(payload)),
      Effect.orElseSucceed(() => []),
    );

  const list: SkillCatalogProvider["list"] = (query) =>
    Effect.gen(function* () {
      const page = clampPositiveInteger(query?.page, 1, 1, 500);
      const pageSize = clampPositiveInteger(query?.pageSize, 20, 1, 100);
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy: query?.sortBy ?? "downloads",
        order: query?.order ?? "desc",
      });
      const search = query?.query?.trim();
      if (search) {
        params.set("query", search);
        params.set("q", search);
        params.set("search", search);
        params.set("keyword", search);
      }
      const category = query?.category?.trim();
      if (category && category !== "all") {
        params.set("category", category);
      }

      const [payload, categories] = yield* Effect.all(
        [fetchJson<unknown>(`${API_BASE}/api/skills?${params.toString()}`), fetchCategories()],
        { concurrency: 2 },
      );
      const normalized = normalizeSkillList(payload, categories, page, pageSize, query);
      return normalized;
    });

  const find: SkillCatalogProvider["find"] = (catalogItemId) =>
    Effect.gen(function* () {
      const slug = slugFromCatalogId(catalogItemId);
      if (!slug) return undefined;
      const payload = yield* fetchJson<unknown>(
        `${API_BASE}/api/v1/skills/${encodeURIComponent(slug)}`,
      );
      return normalizeSkillDetail(payload, slug);
    });

  const readContent: SkillCatalogProvider["readContent"] = (catalogItemId) =>
    Effect.gen(function* () {
      const slug = slugFromCatalogId(catalogItemId);
      if (!slug) return null;
      const markdown = yield* fetchText(
        `${API_BASE}/api/v1/skills/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(
          "SKILL.md",
        )}`,
      );
      return { markdown };
    }).pipe(Effect.orElseSucceed(() => null));

  const readFiles: SkillCatalogProvider["readFiles"] = (catalogItemId) =>
    Effect.gen(function* () {
      const slug = slugFromCatalogId(catalogItemId);
      if (!slug) return null;
      const payload = yield* fetchJson<unknown>(
        `${API_BASE}/api/v1/skills/${encodeURIComponent(slug)}/files`,
      );
      return normalizeFiles(payload);
    }).pipe(Effect.orElseSucceed(() => null));

  const downloadZip: SkillCatalogProvider["downloadZip"] = (catalogItemId) =>
    Effect.gen(function* () {
      const slug = slugFromCatalogId(catalogItemId);
      if (!slug) return null;
      return yield* fetchBytes(`${API_BASE}/api/v1/download?slug=${encodeURIComponent(slug)}`);
    });

  return {
    sourceId: SOURCE_ID,
    displayName: SOURCE_LABEL,
    list,
    find,
    readContent,
    readFiles,
    downloadZip,
    resolveAssetPath: () => Effect.succeed(null),
  };
}

function slugFromCatalogId(catalogItemId: string): string | null {
  const prefix = `${SOURCE_ID}:`;
  if (!catalogItemId.startsWith(prefix)) return null;
  const slug = catalogItemId.slice(prefix.length).trim();
  return slug.length > 0 ? slug : null;
}

function normalizeSkillList(
  payload: unknown,
  categories: SkillCatalogProviderResult["categories"],
  page: number,
  pageSize: number,
  query?: SkillCatalogQuery,
): SkillCatalogProviderResult {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]);
  const categoryNameByKey = new Map(categories.map((category) => [category.key, category.name]));
  const rawItems =
    asArray(root?.["items"]) ??
    asArray(data?.["items"]) ??
    asArray(data?.["skills"]) ??
    asArray(root?.["data"]) ??
    asArray(root?.["skills"]) ??
    asArray(root?.["list"]) ??
    (Array.isArray(payload) ? payload : []);
  const rawTotal =
    toNumber(root?.["total"]) ??
    toNumber(data?.["total"]) ??
    toNumber(root?.["count"]) ??
    toNumber(data?.["count"]) ??
    toNumber(asRecord(root?.["pagination"])?.["total"]) ??
    rawItems.length;
  const items = rawItems
    .map((entry) => normalizeSkillSummary(entry, undefined, categoryNameByKey))
    .filter(isCatalogSkillEntry)
    .filter((entry) => matchesCatalogQuery(entry, query));
  const total = query?.query?.trim() ? items.length : rawTotal;
  return {
    items,
    categories,
    total,
    page,
    pageSize,
    fetchedAt: Date.now(),
  };
}

function matchesCatalogQuery(entry: CatalogSkillEntry, query?: SkillCatalogQuery): boolean {
  const category = query?.category?.trim();
  if (category && category !== "all" && entry.categoryKey !== category) return false;

  const search = query?.query?.trim().toLowerCase();
  if (!search) return true;
  const terms = search.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    entry.id,
    entry.name,
    entry.displayName,
    entry.description,
    entry.shortDescription,
    entry.categoryKey,
    entry.categoryName,
    entry.sourceLabel,
    entry.version,
    entry.homepage,
    entry.sourceUrl,
    entry.slug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function normalizeSkillDetail(payload: unknown, fallbackSlug: string): CatalogSkillEntry {
  const root = asRecord(payload);
  const detail = asRecord(root?.["skill"]) ?? asRecord(root?.["data"]) ?? root ?? {};
  return normalizeSkillSummary(detail, fallbackSlug);
}

function normalizeSkillSummary(
  payload: unknown,
  fallbackSlug?: string,
  categoryNameByKey?: ReadonlyMap<string, string>,
): CatalogSkillEntry {
  const record = asRecord(payload) ?? {};
  const slug =
    toStringValue(record["slug"]) ??
    toStringValue(record["name"]) ??
    toStringValue(record["id"]) ??
    fallbackSlug ??
    "unknown";
  const name = sanitizeSkillName(toStringValue(record["name"]) ?? slug);
  const displayName =
    toStringValue(record["displayName"]) ??
    toStringValue(record["display_name"]) ??
    toStringValue(record["title"]) ??
    prettifyName(name);
  const category = normalizeCategoryValue(record["category"], categoryNameByKey);
  const sourceUrl =
    toStringValue(record["sourceUrl"]) ??
    toStringValue(record["source_url"]) ??
    toStringValue(record["repository"]) ??
    toStringValue(record["repo"]);
  return {
    id: `${SOURCE_ID}:${slug}`,
    name,
    displayName,
    description: toStringValue(record["description_zh"]) ?? toStringValue(record["description"]),
    shortDescription:
      toStringValue(record["shortDescription"]) ??
      toStringValue(record["short_description"]) ??
      toStringValue(record["summary"]),
    repoPath: slug,
    iconSmall: toStringValue(record["iconUrl"]) ?? toStringValue(record["icon_url"]) ?? null,
    iconLarge: toStringValue(record["iconUrl"]) ?? toStringValue(record["icon_url"]) ?? null,
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    categoryKey: category?.key,
    categoryName: category?.name,
    version: toStringValue(record["version"]),
    downloads: toNumber(record["downloads"]) ?? toNumber(record["downloadCount"]),
    installs: toNumber(record["installs"]) ?? toNumber(record["installCount"]),
    stars: toNumber(record["stars"]) ?? toNumber(record["starCount"]),
    requiresApiKey:
      toBoolean(record["requiresApiKey"]) ??
      toBoolean(record["requires_api_key"]) ??
      toBoolean(asRecord(record["labels"])?.["requires_api_key"]),
    securityStatus: toBoolean(record["verified"]) ? "verified" : "unknown",
    homepage: toStringValue(record["homepage"]) ?? toStringValue(record["website"]),
    sourceUrl: sourceUrl ?? toStringValue(record["upstream_url"]),
    slug,
  };
}

function normalizeCategories(payload: unknown): SkillCatalogProviderResult["categories"] {
  const root = asRecord(payload);
  const raw =
    asArray(root?.["categories"]) ??
    asArray(root?.["data"]) ??
    asArray(root?.["items"]) ??
    (Array.isArray(payload) ? payload : []);
  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        return { key: entry, name: prettifyName(entry) };
      }
      const record = asRecord(entry);
      if (!record) return null;
      const key =
        toStringValue(record["key"]) ??
        toStringValue(record["slug"]) ??
        toStringValue(record["id"]) ??
        toStringValue(record["name"]);
      if (!key) return null;
      return {
        key,
        name: toStringValue(record["name"]) ?? toStringValue(record["label"]) ?? prettifyName(key),
        ...(toNumber(record["count"]) !== undefined ? { count: toNumber(record["count"]) } : {}),
      };
    })
    .filter((entry): entry is SkillCatalogProviderResult["categories"][number] => entry !== null);
}

function normalizeFiles(payload: unknown): ReadonlyArray<SkillHubFileEntry> {
  const root = asRecord(payload);
  const raw =
    asArray(root?.["files"]) ??
    asArray(root?.["data"]) ??
    asArray(root?.["items"]) ??
    (Array.isArray(payload) ? payload : []);
  return raw
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const filePath = toStringValue(record["path"]) ?? toStringValue(record["name"]);
      if (!filePath) return null;
      return {
        path: filePath,
        ...(toStringValue(record["sha256"]) ? { sha256: toStringValue(record["sha256"]) } : {}),
        ...(toNumber(record["size"]) !== undefined ? { size: toNumber(record["size"]) } : {}),
      };
    })
    .filter((entry): entry is SkillHubFileEntry => entry !== null);
}

function normalizeCategoryValue(
  value: unknown,
  categoryNameByKey?: ReadonlyMap<string, string>,
): { key: string; name: string } | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const key = value.trim();
    return { key, name: categoryNameByKey?.get(key) ?? prettifyName(key) };
  }
  const record = asRecord(value);
  if (!record) return null;
  const key =
    toStringValue(record["key"]) ??
    toStringValue(record["slug"]) ??
    toStringValue(record["id"]) ??
    toStringValue(record["name"]);
  if (!key) return null;
  return {
    key,
    name: toStringValue(record["name"]) ?? toStringValue(record["label"]) ?? prettifyName(key),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> | null {
  return Array.isArray(value) ? value : null;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
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

function sanitizeSkillName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "skill";
}

function prettifyName(raw: string): string {
  return raw
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function isCatalogSkillEntry(value: CatalogSkillEntry): boolean {
  return value.id.length > SOURCE_ID.length + 1 && value.name.length > 0;
}
