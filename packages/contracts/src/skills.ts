import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Skill 的作用域。来自 codex-app-server 的 SkillScope。
 *  - system：codex 引擎自带、随版本升级一起更新的内置技能
 *  - user：用户通过 marketplace/add 安装到 ~/.bahew/agent-data/skills 下
 *  - repo：当前项目仓库内 .codex/skills 提供的技能
 *  - admin：组织/管理员预置的技能
 */
export const SkillScope = Schema.Literals(["system", "user", "repo", "admin"]);
export type SkillScope = typeof SkillScope.Type;

/**
 * 已安装技能记录。归一化自 codex `skills/list` RPC 的 SkillMetadata。
 *
 * 与 ServerProviderSkill 的差异：
 *  - 这里 `scope` 必填，便于 UI 区分 system / user
 *  - 暴露 `iconSmall` / `iconLarge` 的 HTTP URL，给前端 <img> 直接消费
 *  - 不暴露原始绝对路径（出于沙箱考虑由服务端反推）
 */
export const InstalledSkill = Schema.Struct({
  /** SKILL.md frontmatter 中的 name，作为唯一稳定 ID */
  name: TrimmedNonEmptyString,
  /** 用于显示的标题；缺省时回退 name */
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  /** 详细描述（多行；用于详情对话框） */
  description: Schema.optionalKey(TrimmedNonEmptyString),
  /** 卡片副标题（一行 hint） */
  shortDescription: Schema.optionalKey(TrimmedNonEmptyString),
  /** 作用域 */
  scope: SkillScope,
  /** 是否启用（codex 端可禁用某些 system 技能） */
  enabled: Schema.Boolean,
  /** 卡片小图标的 HTTP URL；若该 skill 没声明图标则缺省 */
  iconSmallUrl: Schema.optionalKey(TrimmedNonEmptyString),
  /** 大图标 HTTP URL */
  iconLargeUrl: Schema.optionalKey(TrimmedNonEmptyString),
  /** 服务端反查时使用的 marketplaceName（仅 user scope 通常有值） */
  marketplaceName: Schema.optionalKey(TrimmedNonEmptyString),
});
export type InstalledSkill = typeof InstalledSkill.Type;

export const SkillsListResponse = Schema.Struct({
  skills: Schema.Array(InstalledSkill),
});
export type SkillsListResponse = typeof SkillsListResponse.Type;

/**
 * 推荐目录中的一个技能条目。
 * 服务端从 vendor_imports/<source>/skills/.curated/<name>/SKILL.md 解析得到。
 */
export const SkillCatalogItem = Schema.Struct({
  /** source.id + ":" + name，全局唯一；前端拿来做 React key */
  id: TrimmedNonEmptyString,
  /** SKILL.md frontmatter 中的 name */
  name: TrimmedNonEmptyString,
  /** 显示名（capitalize 处理后的 name 或 frontmatter 提供） */
  displayName: TrimmedNonEmptyString,
  /** 详细描述 */
  description: Schema.optionalKey(TrimmedNonEmptyString),
  /** 卡片副标题 */
  shortDescription: Schema.optionalKey(TrimmedNonEmptyString),
  /** 来源 ID（与 SkillSource.id 对应） */
  sourceId: TrimmedNonEmptyString,
  /** 来源仓库 URL（用于 marketplace/add 的 source 字段） */
  sourceRepoUrl: TrimmedNonEmptyString,
  /** 来源 ref，例如 "main" */
  sourceRef: TrimmedNonEmptyString,
  /** 在仓库中的 sparse path，例如 "skills/.curated/figma" */
  sparsePath: TrimmedNonEmptyString,
  /** 卡片小图标 HTTP URL */
  iconSmallUrl: Schema.optionalKey(TrimmedNonEmptyString),
  /** 大图标 HTTP URL */
  iconLargeUrl: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SkillCatalogItem = typeof SkillCatalogItem.Type;

export const SkillsCatalogResponse = Schema.Struct({
  /** 推荐技能列表（多个源合并后的全集） */
  items: Schema.Array(SkillCatalogItem),
  /** 最近一次成功刷新时间戳（毫秒） */
  fetchedAt: Schema.optionalKey(Schema.Number),
  /** 是否有源刷新失败；让 UI 提示用户 */
  hasErrors: Schema.optionalKey(Schema.Boolean),
});
export type SkillsCatalogResponse = typeof SkillsCatalogResponse.Type;

export const SkillInstallInput = Schema.Struct({
  /** SkillCatalogItem.id —— 由服务端反查 source/sparsePath/ref */
  catalogItemId: TrimmedNonEmptyString,
});
export type SkillInstallInput = typeof SkillInstallInput.Type;

export const SkillInstallResult = Schema.Struct({
  marketplaceName: TrimmedNonEmptyString,
  alreadyAdded: Schema.Boolean,
});
export type SkillInstallResult = typeof SkillInstallResult.Type;

export const SkillUninstallInput = Schema.Struct({
  /** 已安装技能的 name；服务端反查 marketplaceName 后调 marketplace/remove */
  skillName: TrimmedNonEmptyString,
});
export type SkillUninstallInput = typeof SkillUninstallInput.Type;

export const SkillUninstallResult = Schema.Struct({
  removed: Schema.Boolean,
});
export type SkillUninstallResult = typeof SkillUninstallResult.Type;

export const SkillsRefreshInput = Schema.Struct({
  /** 跳过 TTL 强制重新拉取；不传等同于 false */
  force: Schema.optionalKey(Schema.Boolean),
});
export type SkillsRefreshInput = typeof SkillsRefreshInput.Type;

/** 用于详情对话框 */
export const SkillContentInput = Schema.Struct({
  /** 二选一：已安装走 skillName；推荐走 catalogItemId */
  skillName: Schema.optionalKey(TrimmedNonEmptyString),
  catalogItemId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SkillContentInput = typeof SkillContentInput.Type;

export const SkillContentResult = Schema.Struct({
  /** SKILL.md 文本（去掉 frontmatter） */
  markdown: Schema.String,
  /** 用于在 markdown 内重写 ./assets/foo.png 的基础 URL */
  assetBaseUrl: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SkillContentResult = typeof SkillContentResult.Type;

export class SkillsServiceError extends Schema.TaggedErrorClass<SkillsServiceError>()(
  "SkillsServiceError",
  {
    detail: Schema.String,
    /** 用于前端区分 fetch 失败、源被禁用、解析错误等 */
    kind: Schema.optionalKey(
      Schema.Literals(["fetchFailed", "notFound", "providerUnavailable", "internal"]),
    ),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
