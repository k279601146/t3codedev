/**
 * Skills sources — legacy GitHub source registry.
 *
 * 远程 catalog 已迁移到 SkillCatalogProvider，默认只启用 SkillHub。
 * 这里保留类型和 helper 仅用于兼容旧调用，不再注册 OpenAI curated 源。
 */

export interface SkillSource {
  /** 来源 ID，用作 vendor 子目录名和 catalog item 前缀；只能含小写字母数字横线 */
  readonly id: string;
  /** 显示给用户的名字（保留以备将来 UI 用） */
  readonly displayName: string;
  /** GitHub owner/repo */
  readonly repo: string;
  /** Git ref（branch/tag），用于 fetch */
  readonly ref: string;
  /** curated 目录在仓库中的路径 */
  readonly curatedPath: string;
}

export const BUILT_IN_SKILL_SOURCES: ReadonlyArray<SkillSource> = [];

export function findSkillSource(id: string): SkillSource | undefined {
  return BUILT_IN_SKILL_SOURCES.find((source) => source.id === id);
}

export function repoUrl(source: SkillSource): string {
  return `https://github.com/${source.repo}.git`;
}

export function repoHttpsUrl(source: SkillSource): string {
  return `https://github.com/${source.repo}`;
}
