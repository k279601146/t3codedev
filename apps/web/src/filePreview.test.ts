import { describe, expect, it } from "vitest";

import {
  TEXT_PREVIEW_BASENAME_PATTERN_SOURCE,
  TEXT_PREVIEW_FILE_EXTENSION_PATTERN_SOURCE,
  isTextPreviewFilePath,
  looksLikeDirectoryPreviewPath,
} from "./filePreview";

describe("isTextPreviewFilePath", () => {
  it("支持 TSX 和常见前端单文件组件", () => {
    expect(isTextPreviewFilePath("apps/web/src/App.tsx")).toBe(true);
    expect(isTextPreviewFilePath("src/components/Widget.vue")).toBe(true);
    expect(isTextPreviewFilePath("src/routes/+page.svelte")).toBe(true);
    expect(isTextPreviewFilePath("src/pages/index.astro")).toBe(true);
  });

  it("支持常见文本配置文件", () => {
    expect(isTextPreviewFilePath(".gitignore")).toBe(true);
    expect(isTextPreviewFilePath(".prettierrc")).toBe(true);
    expect(isTextPreviewFilePath("package-lock.json")).toBe(true);
    expect(isTextPreviewFilePath("schema.prisma")).toBe(true);
  });

  it("不会把明显的二进制图片当成文本预览", () => {
    expect(isTextPreviewFilePath("assets/logo.png")).toBe(false);
    expect(isTextPreviewFilePath("screenshots/demo.webp")).toBe(false);
  });
});

describe("looksLikeDirectoryPreviewPath", () => {
  it("区分目录路径和无扩展名文本文件", () => {
    expect(looksLikeDirectoryPreviewPath("apps/web/src/components")).toBe(true);
    expect(looksLikeDirectoryPreviewPath("Dockerfile")).toBe(false);
    expect(looksLikeDirectoryPreviewPath("Makefile")).toBe(false);
    expect(looksLikeDirectoryPreviewPath("apps/web/src/App.tsx")).toBe(false);
  });
});

describe("文件预览正则源", () => {
  it("长扩展名优先，避免 markdown 被 m 抢先匹配", () => {
    const extensionPattern = new RegExp(
      `^[A-Za-z0-9._-]+\\.(?:${TEXT_PREVIEW_FILE_EXTENSION_PATTERN_SOURCE})(?::\\d+){0,2}$`,
      "i",
    );

    expect(extensionPattern.test("README.markdown")).toBe(true);
    expect(extensionPattern.test("App.tsx:12")).toBe(true);
    expect(extensionPattern.test("logo.png")).toBe(false);
  });

  it("常见无扩展名文件和点文件可以作为裸文件链接候选", () => {
    const basenamePattern = new RegExp(
      `^(?:${TEXT_PREVIEW_BASENAME_PATTERN_SOURCE})(?::\\d+){0,2}$`,
      "i",
    );

    expect(basenamePattern.test("Dockerfile")).toBe(true);
    expect(basenamePattern.test("Makefile:4")).toBe(true);
    expect(basenamePattern.test(".gitignore")).toBe(true);
    expect(basenamePattern.test(".prettierrc")).toBe(true);
  });
});
