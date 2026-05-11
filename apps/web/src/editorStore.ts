import { create } from "zustand";
import type { EnvironmentId } from "@t3tools/contracts";

export interface EditorTab {
  id: string;
  environmentId: EnvironmentId;
  workspaceRoot: string;
  filePath: string;
  fileName: string;
  language: string;
  contents: string;
  savedContents: string;
  isDirty: boolean;
  cursorPosition: { line: number; column: number } | null;
}

interface OpenFileInput {
  environmentId: EnvironmentId;
  workspaceRoot: string;
  filePath: string;
  fileName: string;
  language: string;
  contents: string;
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  openFile: (input: OpenFileInput) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  updateContent: (tabId: string, contents: string) => void;
  markSaved: (tabId: string) => void;
  setCursorPosition: (tabId: string, cursorPosition: { line: number; column: number }) => void;
  replaceFileContents: (
    environmentId: EnvironmentId,
    workspaceRoot: string,
    filePath: string,
    contents: string,
  ) => void;
}

function tabMatchesFile(
  tab: EditorTab,
  input: Pick<OpenFileInput, "environmentId" | "workspaceRoot" | "filePath">,
) {
  return (
    tab.environmentId === input.environmentId &&
    tab.workspaceRoot === input.workspaceRoot &&
    tab.filePath === input.filePath
  );
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  tabs: [],
  activeTabId: null,
  openFile: (input) => {
    const existing = get().tabs.find((tab) => tabMatchesFile(tab, input));
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const tab: EditorTab = {
      id: crypto.randomUUID(),
      environmentId: input.environmentId,
      workspaceRoot: input.workspaceRoot,
      filePath: input.filePath,
      fileName: input.fileName,
      language: input.language,
      contents: input.contents,
      savedContents: input.contents,
      isDirty: false,
      cursorPosition: null,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },
  closeTab: (tabId) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== tabId);
      const nextActiveTabId =
        state.activeTabId === tabId ? (tabs.at(-1)?.id ?? null) : state.activeTabId;
      return { tabs, activeTabId: nextActiveTabId };
    }),
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  updateContent: (tabId, contents) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              contents,
              isDirty: contents !== tab.savedContents,
            }
          : tab,
      ),
    })),
  markSaved: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              savedContents: tab.contents,
              isDirty: false,
            }
          : tab,
      ),
    })),
  setCursorPosition: (tabId, cursorPosition) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, cursorPosition } : tab)),
    })),
  replaceFileContents: (environmentId, workspaceRoot, filePath, contents) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.environmentId === environmentId &&
        tab.workspaceRoot === workspaceRoot &&
        tab.filePath === filePath &&
        !tab.isDirty
          ? {
              ...tab,
              contents,
              savedContents: contents,
            }
          : tab,
      ),
    })),
}));

export function getEditorLanguage(filePath: string): string {
  const ext = filePath.split(".").at(-1)?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "html":
      return "html";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    default:
      return "plaintext";
  }
}
