import { beforeEach, describe, expect, it } from "vitest";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEditorStore } from "./editorStore";

const environmentId = "test-env" as EnvironmentId;
const workspaceRoot = "D:\\workspace\\project";

function openFile(filePath: string, contents: string) {
  return useEditorStore.getState().openFile({
    environmentId,
    workspaceRoot,
    filePath,
    fileName: filePath.split(/[\\/]/).at(-1) ?? filePath,
    language: "typescript",
    contents,
  });
}

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activeTabId: null,
      externalChangesByFileKey: {},
    });
  });

  it("refreshes an existing clean tab when the file is opened with newer contents", () => {
    const tabId = openFile("src/App.tsx", "old contents");

    const reopenedTabId = openFile("src/App.tsx", "new contents");

    expect(reopenedTabId).toBe(tabId);
    expect(useEditorStore.getState().activeTabId).toBe(tabId);
    expect(useEditorStore.getState().tabs).toMatchObject([
      {
        id: tabId,
        contents: "new contents",
        savedContents: "new contents",
        isDirty: false,
      },
    ]);
  });

  it("attaches a staged AI change when opening the changed file", () => {
    useEditorStore
      .getState()
      .stageExternalChange(environmentId, workspaceRoot, "src/App.tsx", "before", "after");

    openFile("src/App.tsx", "after");

    expect(useEditorStore.getState().tabs[0]?.externalChange).toMatchObject({
      originalContents: "before",
      modifiedContents: "after",
    });
  });

  it("does not overwrite dirty editor contents when a file is reopened", () => {
    const tabId = openFile("src/App.tsx", "user draft");
    useEditorStore.getState().updateContent(tabId, "unsaved user draft");

    openFile("src/App.tsx", "ai contents");

    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      id: tabId,
      contents: "unsaved user draft",
      savedContents: "user draft",
      isDirty: true,
    });
  });

  it("refreshes a clean open tab from disk and clears stale AI change markers", () => {
    const tabId = openFile("src/App.tsx", "before");
    useEditorStore
      .getState()
      .stageExternalChange(environmentId, workspaceRoot, "src/App.tsx", "before", "after");

    useEditorStore
      .getState()
      .replaceFileContents(environmentId, workspaceRoot, "src/App.tsx", "restored");

    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      id: tabId,
      contents: "restored",
      savedContents: "restored",
      isDirty: false,
      externalChange: null,
    });
  });
});
