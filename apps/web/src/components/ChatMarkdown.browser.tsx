import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { openInPreferredEditorMock, readLocalApiMock } = vi.hoisted(() => ({
  openInPreferredEditorMock: vi.fn(async () => "vscode"),
  readLocalApiMock: vi.fn(() => ({
    server: { getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })) },
    shell: { openInEditor: vi.fn(async () => undefined) },
  })),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorMock,
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("rewrites file uri hrefs into direct paths before rendering", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath})`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), filePath);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps line anchors working after rewriting file uri hrefs", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts:1](file://${filePath}#L1)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), `${filePath}:1`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("opens relative Markdown file links from the Windows workspace root", async () => {
    const screen = await render(
      <ChatMarkdown
        text="[codex_app_plugin_intro.pdf](output/pdf/codex_app_plugin_intro.pdf)"
        cwd="D:\\workspace\\testimg"
      />,
    );

    try {
      const link = page.getByRole("link", { name: "codex_app_plugin_intro.pdf" });
      await expect.element(link).toBeInTheDocument();
      await expect
        .element(link)
        .toHaveAttribute("href", "output/pdf/codex_app_plugin_intro.pdf");

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          "D:\\workspace\\testimg\\output\\pdf\\codex_app_plugin_intro.pdf",
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("preserves absolute Windows slash paths from generated file links", async () => {
    const targetPath = "D:/workspace/testimg/output/pdf/codex_app_plugin_intro.pdf";
    const screen = await render(
      <ChatMarkdown
        text={`[codex_app_plugin_intro.pdf](${targetPath})`}
        cwd="D:\\workspace\\testimg"
      />,
    );

    try {
      const link = page.getByRole("link", { name: "codex_app_plugin_intro.pdf" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", targetPath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), targetPath);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("shows column information inline when present", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath}#L1C7)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1:C7" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          `${filePath}:1:7`,
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("disambiguates duplicate file basenames inline", async () => {
    const firstPath = "/Users/yashsingh/p/t3code/apps/web/src/components/chat/MessagesTimeline.tsx";
    const secondPath = "/Users/yashsingh/p/t3code/apps/web/src/components/MessagesTimeline.tsx";
    const screen = await render(
      <ChatMarkdown
        text={`See [MessagesTimeline.tsx](file://${firstPath}) and [MessagesTimeline.tsx](file://${secondPath}).`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · components/chat" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · src/components" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps normal web links unchanged", async () => {
    const screen = await render(
      <ChatMarkdown text="[OpenAI](https://openai.com/docs)" cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "OpenAI" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", "https://openai.com/docs");
      await expect.element(link).toHaveAttribute("target", "_blank");
      await expect.element(link).toHaveClass("chat-markdown-web-link");
    } finally {
      await screen.unmount();
    }
  });

  it("renders plain URLs as compact readable links", async () => {
    const url = "https://www.cosmicjs.com/blog/claude-code-vs-github-copilot-vs-cursor";
    const screen = await render(<ChatMarkdown text={url} cwd="/repo/project" />);

    try {
      const link = page.getByRole("link", { name: url });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", url);
      await expect.element(link).toHaveAttribute("title", url);
      await expect.element(link).toHaveClass("chat-markdown-url-link");
      await expect.element(page.getByText("cosmicjs.com")).toBeInTheDocument();
      await expect
        .element(page.getByText("/blog/claude-code-vs-github-copilot-vs-cursor"))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("adds table header labels for narrow readable table cards", async () => {
    const screen = await render(
      <ChatMarkdown
        text={[
          "| 方案 | 定位 |",
          "| --- | --- |",
          "| huggingface/ppt-master | AI agent 工作流 |",
        ].join("\n")}
        cwd="/repo/project"
      />,
    );

    try {
      const tableScroll = document.querySelector<HTMLElement>(".chat-markdown-table-scroll");
      expect(tableScroll?.dataset.columnCount).toBe("2");

      const cells = document.querySelectorAll<HTMLTableCellElement>("tbody td");
      expect(cells[0]?.dataset.label).toBe("方案");
      expect(cells[1]?.dataset.label).toBe("定位");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps bare plain file names as non-clickable text in side-panel open mode", async () => {
    const onOpenFile = vi.fn();
    const screen = await render(
      <ChatMarkdown
        text="查看 ComposerPrimaryActions.tsx (line 75)。"
        cwd="/repo/project"
        onOpenFile={onOpenFile}
      />,
    );

    try {
      await expect
        .element(page.getByText("查看 ComposerPrimaryActions.tsx (line 75)。"))
        .toBeInTheDocument();
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(openInPreferredEditorMock).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
});
