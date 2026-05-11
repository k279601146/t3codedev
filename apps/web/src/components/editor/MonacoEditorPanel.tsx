import Editor, { DiffEditor, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditorApi } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useFileSave } from "../../hooks/useFileSave";
import { useEditorStore } from "../../editorStore";
import { EditorTabs } from "./EditorTabs";
import { EditorStatusBar } from "./EditorStatusBar";
import { toastManager } from "../ui/toast";
import { useTheme } from "../../hooks/useTheme";
import { Button } from "../ui/button";

const MONACO_THEME_LIGHT = "t3code-light";
const MONACO_THEME_DARK = "t3code-dark";

function defineT3MonacoThemes(monaco: Monaco) {
  monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#262626",
      "editorLineNumber.foreground": "#a3a3a3",
      "editorLineNumber.activeForeground": "#525252",
      "editor.selectionBackground": "#d4d4d8",
      "editor.inactiveSelectionBackground": "#e5e5e5",
      "editor.lineHighlightBackground": "#f5f5f5",
      "editorCursor.foreground": "#171717",
      "editorGutter.background": "#ffffff",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e5e5e5",
      "diffEditor.insertedTextBackground": "#16a34a22",
      "diffEditor.removedTextBackground": "#dc262622",
    },
  });
  monaco.editor.defineTheme(MONACO_THEME_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0c0c0d",
      "editor.foreground": "#f5f5f5",
      "editorLineNumber.foreground": "#737373",
      "editorLineNumber.activeForeground": "#d4d4d4",
      "editor.selectionBackground": "#3f3f46",
      "editor.inactiveSelectionBackground": "#27272a",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorCursor.foreground": "#fafafa",
      "editorGutter.background": "#0c0c0d",
      "editorWidget.background": "#111113",
      "editorWidget.border": "#ffffff14",
      "diffEditor.insertedTextBackground": "#22c55e22",
      "diffEditor.removedTextBackground": "#ef444422",
    },
  });
}

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
  const acceptExternalChange = useEditorStore((state) => state.acceptExternalChange);
  const discardExternalChange = useEditorStore((state) => state.discardExternalChange);
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition);
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
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

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineT3MonacoThemes(monaco);
  }, []);

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

  const handleAcceptExternalChange = useCallback(async () => {
    const tab = activeTabRef.current;
    if (!tab?.externalChange) {
      return;
    }
    try {
      await saveFile(tab.filePath, tab.externalChange.modifiedContents, tab.workspaceRoot);
      acceptExternalChange(tab.id);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not accept changes",
        description: error instanceof Error ? error.message : "The file could not be written.",
      });
    }
  }, [acceptExternalChange, saveFile]);

  const handleDiscardExternalChange = useCallback(async () => {
    const tab = activeTabRef.current;
    if (!tab?.externalChange) {
      return;
    }
    try {
      await saveFile(tab.filePath, tab.externalChange.originalContents, tab.workspaceRoot);
      discardExternalChange(tab.id);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not restore file",
        description: error instanceof Error ? error.message : "The file could not be written.",
      });
    }
  }, [discardExternalChange, saveFile]);

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
      {activeTab.externalChange ? (
        <div className="flex min-h-9 items-center gap-2 border-b border-border bg-muted/30 px-3 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            AI changed this file. Review the inline diff before updating the editor.
          </span>
          <Button type="button" size="xs" variant="outline" onClick={handleDiscardExternalChange}>
            Restore
          </Button>
          <Button type="button" size="xs" onClick={handleAcceptExternalChange}>
            Accept
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {activeTab.externalChange ? (
          <DiffEditor
            key={`${activeTab.id}:diff`}
            height="100%"
            language={activeTab.language}
            original={activeTab.externalChange.originalContents}
            modified={activeTab.externalChange.modifiedContents}
            beforeMount={handleBeforeMount}
            theme={monacoTheme}
            options={{
              automaticLayout: true,
              fontSize: 13,
              fontLigatures: true,
              minimap: { enabled: false },
              renderSideBySide: false,
              scrollBeyondLastLine: false,
              readOnly: true,
              renderWhitespace: "selection",
            }}
          />
        ) : (
          <Editor
            key={activeTab.id}
            height="100%"
            language={activeTab.language}
            value={activeTab.contents}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onChange={(value) => {
              updateContent(activeTab.id, value ?? "");
            }}
            theme={monacoTheme}
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
        )}
      </div>
      <EditorStatusBar tab={activeTab} />
    </div>
  );
}
