import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditorApi } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useFileSave } from "../../hooks/useFileSave";
import { useEditorStore } from "../../editorStore";
import { EditorTabs } from "./EditorTabs";
import { EditorStatusBar } from "./EditorStatusBar";
import { toastManager } from "../ui/toast";

export function MonacoEditorPanel({
  environmentId,
  workspaceRoot,
}: {
  environmentId: EnvironmentId | null;
  workspaceRoot: string | null;
}) {
  const tabs = useEditorStore((state) => state.tabs);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const updateContent = useEditorStore((state) => state.updateContent);
  const markSaved = useEditorStore((state) => state.markSaved);
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const saveEnvironmentId = activeTab?.environmentId ?? environmentId;
  const saveWorkspaceRoot = activeTab?.workspaceRoot ?? workspaceRoot;
  const { saveFile } = useFileSave(saveEnvironmentId);
  const editorRef = useRef<MonacoEditorApi.IStandaloneCodeEditor | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const handleSave = useCallback(async () => {
    const tab = activeTabRef.current;
    if (!tab || !saveWorkspaceRoot) {
      return;
    }
    try {
      await saveFile(tab.filePath, tab.contents, saveWorkspaceRoot);
      markSaved(tab.id);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save file",
        description: error instanceof Error ? error.message : "The file could not be written.",
      });
    }
  }, [markSaved, saveFile, saveWorkspaceRoot]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
        const tab = activeTabRef.current;
        if (!tab) return;
        setCursorPosition(tab.id, {
          line: event.position.lineNumber,
          column: event.position.column,
        });
      });
      editor.addAction({
        id: "cursor-save-file",
        label: "Save File",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          void handleSave();
        },
      });
      editor.onDidDispose(() => {
        cursorDisposable.dispose();
      });
    },
    [handleSave, setCursorPosition],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }
    const currentValue = model.getValue();
    if (currentValue !== activeTab.contents) {
      model.setValue(activeTab.contents);
    }
  }, [activeTab]);

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Select a file to start editing.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <EditorTabs />
      <div className="min-h-0 flex-1">
        <Editor
          key={activeTab.id}
          height="100%"
          language={activeTab.language}
          value={activeTab.contents}
          onMount={handleMount}
          onChange={(value) => {
            updateContent(activeTab.id, value ?? "");
          }}
          theme="vs-dark"
          options={{
            automaticLayout: true,
            fontSize: 13,
            fontLigatures: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            tabSize: 2,
            insertSpaces: true,
            wordWrap: "off",
            renderWhitespace: "selection",
          }}
        />
      </div>
      <EditorStatusBar tab={activeTab} />
    </div>
  );
}
