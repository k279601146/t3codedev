import { describe, expect, it } from "vitest";

import { normalizeSkillDetailMarkdown } from "./SkillDetailDialog.logic";

describe("normalizeSkillDetailMarkdown", () => {
  it("保留正常的技能正文", () => {
    const markdown = `# 使用说明\n\n- 第一步\n- 第二步`;

    expect(normalizeSkillDetailMarkdown(markdown)).toBe(markdown);
  });

  it("移除 YAML frontmatter 后继续保留正文", () => {
    const markdown = `---\nname: demo-skill\ndescription: demo\n---\n\n# 标题\n\n正文`;

    expect(normalizeSkillDetailMarkdown(markdown)).toBe("# 标题\n\n正文");
  });

  it("在首段明显是内联元信息时改用后续正文", () => {
    const markdown = `name: nano-banana-pro description: Generate/Edit images with Nano Banana Pro. Use for image create/modify requests.\n\n# Nano Banana Pro\n\nGenerate new images.`;

    expect(normalizeSkillDetailMarkdown(markdown)).toBe("# Nano Banana Pro\n\nGenerate new images.");
  });

  it("在只有内联元信息时尽量提取 description", () => {
    const markdown = `name: demo-skill description: 用于整理笔记和知识库 homepage: https://example.com metadata: openclaw`;

    expect(normalizeSkillDetailMarkdown(markdown)).toBe("用于整理笔记和知识库");
  });
});
