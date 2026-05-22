/**
 * Skills sources — built-in catalog source registry.
 *
 * 第一版只内置 OpenAI 的 curated 仓库，不开放给用户管理。
 * 如需扩展，往 BUILT_IN_SKILL_SOURCES 数组里加条目即可。
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

export const BUILT_IN_SKILL_SOURCES: ReadonlyArray<SkillSource> = [
  {
    id: "openai-curated",
    displayName: "OpenAI Curated",
    repo: "openai/skills",
    ref: "main",
    curatedPath: "skills/.curated",
  },
];

export function findSkillSource(id: string): SkillSource | undefined {
  return BUILT_IN_SKILL_SOURCES.find((source) => source.id === id);
}

export function repoUrl(source: SkillSource): string {
  return `https://github.com/${source.repo}.git`;
}

export function repoHttpsUrl(source: SkillSource): string {
  return `https://github.com/${source.repo}`;
}
