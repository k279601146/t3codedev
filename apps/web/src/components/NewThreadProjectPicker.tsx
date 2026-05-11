import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { ChevronDownIcon, FolderPlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { selectProjectsAcrossEnvironments, useStore } from "../store";
import type { Project } from "../types";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "./ProjectFavicon";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

const ENTER_PROJECT_LABEL = "\u8fdb\u5165\u9879\u76ee\u5de5\u4f5c";
const SEARCH_PROJECT_LABEL = "\u641c\u7d22\u9879\u76ee";
const ADD_PROJECT_LABEL = "\u6dfb\u52a0\u65b0\u9879\u76ee";
const NO_PROJECTS_LABEL = "\u6682\u65e0\u9879\u76ee";
const NO_PROJECT_MATCH_LABEL = "\u6ca1\u6709\u5339\u914d\u7684\u9879\u76ee";

function projectMatchesQuery(project: Project, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return (
    project.name.toLowerCase().includes(normalizedQuery) ||
    project.cwd.toLowerCase().includes(normalizedQuery)
  );
}

function projectRefEquals(left: ScopedProjectRef | null, right: ScopedProjectRef): boolean {
  return (
    left !== null &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId
  );
}

export function NewThreadProjectPicker({
  activeProjectRef,
  className,
  onAddProject,
  onProjectSelect,
}: {
  activeProjectRef: ScopedProjectRef | null;
  className?: string;
  onAddProject: () => void;
  onProjectSelect: (projectRef: ScopedProjectRef) => void;
}) {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredProjects = useMemo(
    () => projects.filter((project) => projectMatchesQuery(project, query)),
    [projects, query],
  );

  const handleAddProject = () => {
    setOpen(false);
    onAddProject();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 rounded-full bg-muted/55 px-3 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground",
              className,
            )}
          />
        }
      >
        <FolderPlusIcon className="size-3.5" />
        <span>{ENTER_PROJECT_LABEL}</span>
        <ChevronDownIcon className="size-3.5 opacity-65" />
      </PopoverTrigger>
      <PopoverPopup align="center" side="bottom" className="w-65 p-0">
        <div className="border-b border-border/70 px-2.5 py-2">
          <Input
            nativeInput
            size="sm"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={SEARCH_PROJECT_LABEL}
            className="border-0 bg-transparent shadow-none before:shadow-none"
          />
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {projects.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground text-xs">{NO_PROJECTS_LABEL}</div>
          ) : filteredProjects.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground text-xs">{NO_PROJECT_MATCH_LABEL}</div>
          ) : (
            filteredProjects.map((project) => {
              const projectRef = scopeProjectRef(project.environmentId, project.id);
              const selected = projectRefEquals(activeProjectRef, projectRef);
              return (
                <button
                  key={scopedProjectKey(projectRef)}
                  type="button"
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-accent hover:text-foreground",
                    selected ? "bg-accent text-foreground" : "text-foreground/88",
                  )}
                  onClick={() => {
                    setOpen(false);
                    onProjectSelect(projectRef);
                  }}
                >
                  <ProjectFavicon
                    environmentId={project.environmentId}
                    cwd={project.cwd}
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-border/70 py-1">
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-foreground/88 transition-colors hover:bg-accent hover:text-foreground"
            onClick={handleAddProject}
          >
            <FolderPlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{ADD_PROJECT_LABEL}</span>
          </button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
