import type { SkillCatalogCategory } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

export interface CatalogSkillEntry {
  /** 全局唯一 id：sourceId:name */
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string | undefined;
  readonly shortDescription: string | undefined;
  /** 本地内置技能是相对仓库路径；远程技能可放 slug */
  readonly repoPath: string;
  readonly iconSmall: string | null;
  readonly iconLarge: string | null;
  readonly sourceId: string;
  readonly categoryKey?: string | undefined;
  readonly categoryName?: string | undefined;
  readonly sourceLabel?: string | undefined;
  readonly version?: string | undefined;
  readonly downloads?: number | undefined;
  readonly installs?: number | undefined;
  readonly stars?: number | undefined;
  readonly requiresApiKey?: boolean | undefined;
  readonly securityStatus?: "verified" | "unknown" | "blocked" | undefined;
  readonly homepage?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly slug?: string | undefined;
}

export interface SkillCatalogQuery {
  readonly force?: boolean | undefined;
  readonly query?: string | undefined;
  readonly category?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly sortBy?: "downloads" | "updated" | "created" | "name" | undefined;
  readonly order?: "asc" | "desc" | undefined;
}

export interface SkillCatalogProviderResult {
  readonly items: ReadonlyArray<CatalogSkillEntry>;
  readonly categories: ReadonlyArray<SkillCatalogCategory>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly fetchedAt: number;
}

export interface SkillHubFileEntry {
  readonly path: string;
  readonly sha256?: string | undefined;
  readonly size?: number | undefined;
}

export class SkillCatalogProviderError extends Data.TaggedError("SkillCatalogProviderError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface SkillCatalogProvider {
  readonly sourceId: string;
  readonly displayName: string;
  readonly list: (
    query?: SkillCatalogQuery,
  ) => Effect.Effect<SkillCatalogProviderResult, SkillCatalogProviderError>;
  readonly find: (
    catalogItemId: string,
  ) => Effect.Effect<CatalogSkillEntry | undefined, SkillCatalogProviderError>;
  readonly readContent: (
    catalogItemId: string,
  ) => Effect.Effect<{ markdown: string; assetBaseUrl?: string } | null, SkillCatalogProviderError>;
  readonly readFiles: (
    catalogItemId: string,
  ) => Effect.Effect<ReadonlyArray<SkillHubFileEntry> | null, SkillCatalogProviderError>;
  readonly downloadZip: (
    catalogItemId: string,
  ) => Effect.Effect<Uint8Array | null, SkillCatalogProviderError>;
  readonly resolveAssetPath: (
    _sourceId: string,
    _relPath: string,
  ) => Effect.Effect<string | null, SkillCatalogProviderError>;
}
