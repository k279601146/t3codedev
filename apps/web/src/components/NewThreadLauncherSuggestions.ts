import type { ServerProviderSkill } from "@t3tools/contracts";

export const IDLE_SUGGESTION_DELAY_MS = 90_000;

type IdleSuggestionSkill = Pick<
  ServerProviderSkill,
  "name" | "displayName" | "shortDescription" | "description"
>;

export interface IdleSuggestionPluginState {
  readonly pptMasterInstalled: boolean;
  readonly agentReachInstalled: boolean;
}

export interface IdleSuggestionInput {
  readonly skills: ReadonlyArray<IdleSuggestionSkill>;
  readonly plugins: IdleSuggestionPluginState;
  readonly count: number;
  readonly random?: () => number;
}

const FALLBACK_IDLE_SUGGESTIONS = [
  "查看当前项目结构，帮我找出最适合下一步推进的任务。",
  "阅读最近的代码改动，整理风险、测试缺口和建议。",
  "把一个模糊产品想法拆成可执行的技术方案和里程碑。",
  "根据现有代码风格实现一个小功能，并补上关键测试。",
  "帮我审查一个 Bug 的可能原因，给出最小验证路径。",
  "梳理当前功能的 PRD 初稿，并标出需要确认的问题。",
  "把长文档或会议记录整理成行动项、负责人和截止时间。",
  "生成一份面向团队的项目状态报告，突出进展、风险和下一步。",
  "分析一份数据表或日志，找出异常趋势和可能解释。",
  "比较两个技术方案的优劣，并给出适合当前项目的建议。",
  "为一个新功能设计落地页文案和首屏信息架构。",
  "创建一份发布前检查清单，覆盖代码、测试、文档和回滚方案。",
] as const;

function normalizeSkillName(name: string): string {
  return name.trim().replace(/^\$+/, "");
}

function skillToken(name: string): string {
  return `$${normalizeSkillName(name)}`;
}

function normalizedSkillText(skill: IdleSuggestionSkill): string {
  return [
    skill.name,
    skill.displayName,
    skill.shortDescription,
    skill.description,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function buildSkillSuggestion(skill: IdleSuggestionSkill): string | null {
  const token = skillToken(skill.name);
  const text = normalizedSkillText(skill);

  if (/(ppt|slide|slides|presentation|powerpoint|演示|幻灯片)/.test(text)) {
    return `${token} 请把这个主题制作成 8-10 页可编辑演示文稿，并先给出大纲和视觉方向。主题：`;
  }
  if (/(review|code|pr|diff|ci|test|代码|审查|测试)/.test(text)) {
    return `${token} 请审查当前改动，按严重程度列出问题、测试缺口和建议。`;
  }
  if (/(research|search|web|reader|reach|github|调研|搜索|网页|资料|阅读)/.test(text)) {
    return `${token} 请围绕这个主题做公开资料调研，列出来源链接、关键事实、不同观点和不确定点。主题：`;
  }
  if (/(image|design|visual|生成图|图片|视觉|设计)/.test(text)) {
    return `${token} 请根据这个需求生成可用的视觉方案，并说明风格、构图和交付物。需求：`;
  }
  if (/(doc|docs|document|文档|说明)/.test(text)) {
    return `${token} 请整理这段内容，输出结构清晰、可直接复用的文档草稿。内容：`;
  }

  const displayName = skill.displayName?.trim() || normalizeSkillName(skill.name);
  return `${token} 请用 ${displayName} 的能力帮我处理这个任务：`;
}

function shuffle<T>(values: ReadonlyArray<T>, random: () => number): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }
  return next;
}

function appendUnique(target: string[], value: string): void {
  const normalized = value.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }
  target.push(normalized);
}

export function buildIdleSuggestions(input: IdleSuggestionInput): string[] {
  const random = input.random ?? Math.random;
  const suggestions: string[] = [];

  if (input.plugins.pptMasterInstalled) {
    appendUnique(
      suggestions,
      "$ppt-master 请把这个主题制作成一份结构完整、可编辑的演示文稿。主题：",
    );
  }
  if (input.plugins.agentReachInstalled) {
    appendUnique(
      suggestions,
      "$agent-reach 请围绕这个主题做公开资料调研，输出来源链接、关键事实和后续问题。主题：",
    );
  }
  if (suggestions.length >= input.count) {
    return suggestions.slice(0, input.count);
  }

  for (const skill of input.skills) {
    const suggestion = buildSkillSuggestion(skill);
    if (suggestion) {
      appendUnique(suggestions, suggestion);
    }
    if (suggestions.length >= input.count) {
      return suggestions.slice(0, input.count);
    }
  }

  for (const suggestion of shuffle(FALLBACK_IDLE_SUGGESTIONS, random)) {
    appendUnique(suggestions, suggestion);
    if (suggestions.length >= input.count) {
      return suggestions;
    }
  }

  return suggestions.slice(0, input.count);
}
