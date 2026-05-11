import type { EditorTab } from "../../editorStore";

export function EditorStatusBar({ tab }: { tab: EditorTab }) {
  return (
    <div className="flex h-7 min-h-7 items-center justify-between border-t border-border bg-muted/30 px-3 text-[11px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate">{tab.language}</span>
        <span>{tab.isDirty ? "Unsaved" : "Saved"}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>UTF-8</span>
        <span>
          Ln {tab.cursorPosition?.line ?? 1}, Col {tab.cursorPosition?.column ?? 1}
        </span>
      </div>
    </div>
  );
}
