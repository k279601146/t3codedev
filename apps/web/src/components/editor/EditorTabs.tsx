import { XIcon } from "lucide-react";
import { useEditorStore } from "../../editorStore";

export function EditorTabs() {
  const tabs = useEditorStore((state) => state.tabs);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const closeTab = useEditorStore((state) => state.closeTab);

  return (
    <div className="flex h-10 min-h-10 items-stretch overflow-x-auto border-b border-border bg-background">
      {tabs.length === 0 ? (
        <div className="flex items-center px-3 text-xs text-muted-foreground">
          Open a file from the tree
        </div>
      ) : null}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="button"
            tabIndex={0}
            className={[
              "group flex h-full min-w-0 max-w-56 cursor-pointer items-center gap-2 border-r border-border px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isActive
                ? "bg-background text-foreground"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            ].join(" ")}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveTab(tab.id);
              }
            }}
          >
            <span className="min-w-0 truncate">{tab.fileName}</span>
            {tab.isDirty ? <span className="size-1.5 shrink-0 rounded-full bg-orange-500" /> : null}
            <button
              type="button"
              className="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
