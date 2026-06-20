import {
  Layers3Icon,
  ListFilterIcon,
  PlugIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";

import { PluginsPage } from "../plugins/PluginsPage";
import { SkillsPage } from "../skills/SkillsPage";

type ExtensionsTab = "all" | "installed" | "plugins" | "sources";

const TABS: ReadonlyArray<{
  readonly id: ExtensionsTab;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
}> = [
  { id: "all", label: "全部能力", icon: Layers3Icon },
  { id: "installed", label: "已安装", icon: ShieldCheckIcon },
  { id: "plugins", label: "插件与桥接", icon: PlugIcon },
  { id: "sources", label: "来源", icon: ListFilterIcon },
];

function isExtensionsTab(value: string): value is ExtensionsTab {
  return TABS.some((tab) => tab.id === value);
}

function getTabFromHash(hash: string): ExtensionsTab {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  return isExtensionsTab(value) ? value : "all";
}

function replaceExtensionsHash(tab: ExtensionsTab) {
  if (typeof window === "undefined") return;
  const nextHash = "#" + tab;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search + nextHash,
  );
}

export function ExtensionsPage() {
  const [activeTab, setActiveTab] = useState<ExtensionsTab>(() =>
    typeof window !== "undefined" ? getTabFromHash(window.location.hash) : "all",
  );

  useEffect(() => {
    const onHashChange = () => {
      setActiveTab(getTabFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="drag-region flex min-h-[72px] shrink-0 items-center justify-between gap-4 border-b border-border/60 px-8 py-3 wco:min-h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            能力市场
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            安装 SkillHub 技能，管理 T3 内置插件和本地桥接能力。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/20 p-1 [-webkit-app-region:no-drag]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setActiveTab(tab.id);
                  replaceExtensionsHash(tab.id);
                }}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {activeTab === "plugins" ? (
          <PluginsPage />
        ) : activeTab === "installed" ? (
          <SkillsPage embedded view="installed" />
        ) : activeTab === "sources" ? (
          <SkillsPage embedded view="sources" />
        ) : (
          <SkillsPage embedded view="all" />
        )}
      </div>
    </div>
  );
}
