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
  externalChange: EditorExternalChange | null;
  cursorPosition: { line: number; column: number } | null;
}

export interface EditorExternalChange {
  originalContents: string;
  modifiedContents: string;
  receivedAt: string;
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
  externalChangesByFileKey: Record<string, EditorExternalChange>;
  openFile: (input: OpenFileInput) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  updateContent: (tabId: string, contents: string) => void;
  markSaved: (tabId: string) => void;
  setCursorPosition: (tabId: string, cursorPosition: { line: number; column: number }) => void;
  stageExternalChange: (
    environmentId: EnvironmentId,
    workspaceRoot: string,
    filePath: string,
    originalContents: string,
    modifiedContents: string,
  ) => void;
  acceptExternalChange: (tabId: string) => void;
  discardExternalChange: (tabId: string) => void;
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

function getEditorFileKey(
  input: Pick<OpenFileInput, "environmentId" | "workspaceRoot" | "filePath">,
): string {
  return `${input.environmentId}:${input.workspaceRoot}:${input.filePath}`;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  tabs: [],
  activeTabId: null,
  externalChangesByFileKey: {},
  openFile: (input) => {
    const existing = get().tabs.find((tab) => tabMatchesFile(tab, input));
    if (existing) {
      const externalChange = get().externalChangesByFileKey[getEditorFileKey(input)] ?? null;
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) => {
          if (tab.id !== existing.id) {
            return tab;
          }

          if (tab.isDirty) {
            return tab;
          }

          return {
            ...tab,
            fileName: input.fileName,
            language: input.language,
            contents: input.contents,
            savedContents: input.contents,
            externalChange,
          };
        }),
      }));
      return existing.id;
    }
    const externalChange = get().externalChangesByFileKey[getEditorFileKey(input)] ?? null;

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
      externalChange,
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
              externalChange: null,
            }
          : tab,
      ),
      externalChangesByFileKey: Object.fromEntries(
        Object.entries(state.externalChangesByFileKey).filter(([fileKey]) => {
          const editedTab = state.tabs.find((tab) => tab.id === tabId);
          return editedTab ? fileKey !== getEditorFileKey(editedTab) : true;
        }),
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
              externalChange: null,
            }
          : tab,
      ),
      externalChangesByFileKey: Object.fromEntries(
        Object.entries(state.externalChangesByFileKey).filter(([fileKey]) => {
          const savedTab = state.tabs.find((tab) => tab.id === tabId);
          return savedTab ? fileKey !== getEditorFileKey(savedTab) : true;
        }),
      ),
    })),
  setCursorPosition: (tabId, cursorPosition) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, cursorPosition } : tab)),
    })),
  stageExternalChange: (
    environmentId,
    workspaceRoot,
    filePath,
    originalContents,
    modifiedContents,
  ) =>
    set((state) => {
      if (originalContents === modifiedContents) {
        return state;
      }
      const change = {
        originalContents,
        modifiedContents,
        receivedAt: new Date().toISOString(),
      };
      const fileKey = getEditorFileKey({ environmentId, workspaceRoot, filePath });
      return {
        externalChangesByFileKey: {
          ...state.externalChangesByFileKey,
          [fileKey]: change,
        },
        tabs: state.tabs.map((tab) => {
          if (
            tab.environmentId !== environmentId ||
            tab.workspaceRoot !== workspaceRoot ||
            tab.filePath !== filePath ||
            tab.isDirty
          ) {
            return tab;
          }

          return {
            ...tab,
            externalChange: change,
          };
        }),
      };
    }),
  acceptExternalChange: (tabId) =>
    set((state) => {
      const acceptedTab = state.tabs.find((tab) => tab.id === tabId);
      return {
        tabs: state.tabs.map((tab) =>
          tab.id === tabId && tab.externalChange
            ? {
                ...tab,
                contents: tab.externalChange.modifiedContents,
                savedContents: tab.externalChange.modifiedContents,
                isDirty: false,
                externalChange: null,
              }
            : tab,
        ),
        externalChangesByFileKey: Object.fromEntries(
          Object.entries(state.externalChangesByFileKey).filter(([fileKey]) =>
            acceptedTab ? fileKey !== getEditorFileKey(acceptedTab) : true,
          ),
        ),
      };
    }),
  discardExternalChange: (tabId) =>
    set((state) => {
      const discardedTab = state.tabs.find((tab) => tab.id === tabId);
      return {
        tabs: state.tabs.map((tab) =>
          tab.id === tabId && tab.externalChange
            ? {
                ...tab,
                contents: tab.externalChange.originalContents,
                savedContents: tab.externalChange.originalContents,
                isDirty: false,
                externalChange: null,
              }
            : tab,
        ),
        externalChangesByFileKey: Object.fromEntries(
          Object.entries(state.externalChangesByFileKey).filter(([fileKey]) =>
            discardedTab ? fileKey !== getEditorFileKey(discardedTab) : true,
          ),
        ),
      };
    }),
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
              externalChange: null,
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
