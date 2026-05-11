import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { DEFAULT_MODEL, type EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type React from "react";
import { readEnvironmentApi } from "../environmentApi";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
  resolveProjectPathForDispatch,
} from "./projectPaths";
import { newCommandId, newProjectId } from "./utils";
import type { Project } from "../types";
import { useCursorLayoutStore } from "../cursorLayoutStore";

type DroppedFileWithPath = File & {
  path?: string;
  webkitRelativePath?: string;
};

export function getExternalFolderPathsFromDrop(event: React.DragEvent): string[] {
  const paths = new Set<string>();

  for (const file of Array.from(event.dataTransfer.files) as DroppedFileWithPath[]) {
    const path = (window.desktopBridge?.getPathForFile?.(file) ?? file.path)?.trim();
    if (path) {
      paths.add(path);
    }
  }

  const uriList = event.dataTransfer.getData("text/uri-list");
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith("file://")) {
      continue;
    }
    try {
      paths.add(decodeURIComponent(new URL(trimmed).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
    } catch {
      // Ignore malformed drag payloads; the caller will show one consolidated error.
    }
  }

  return [...paths];
}

export function hasExternalFolderDrop(event: React.DragEvent): boolean {
  return (
    event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes("text/uri-list")
  );
}

export async function ensureCursorProjectForPath(input: {
  environmentId: EnvironmentId;
  rawPath: string;
  projects: ReadonlyArray<Project>;
  pinToExplorer: boolean;
}): Promise<Project["id"]> {
  const workspaceRoot = resolveProjectPathForDispatch(input.rawPath);
  if (!workspaceRoot) {
    throw new Error("Dropped project path is empty.");
  }

  const existing = findProjectByPath(
    input.projects.filter((project) => project.environmentId === input.environmentId),
    workspaceRoot,
  );
  if (existing) {
    if (input.pinToExplorer) {
      useCursorLayoutStore
        .getState()
        .pinProject(scopedProjectKey(scopeProjectRef(existing.environmentId, existing.id)));
    }
    return existing.id;
  }

  const api = readEnvironmentApi(input.environmentId);
  if (!api) {
    throw new Error("Project API unavailable.");
  }

  const projectId = newProjectId();
  await api.orchestration.dispatchCommand({
    type: "project.create",
    commandId: newCommandId(),
    projectId,
    title: inferProjectTitleFromPath(workspaceRoot),
    workspaceRoot,
    createWorkspaceRootIfMissing: false,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: DEFAULT_MODEL,
    },
    createdAt: new Date().toISOString(),
  });

  if (input.pinToExplorer) {
    useCursorLayoutStore
      .getState()
      .pinProject(scopedProjectKey(scopeProjectRef(input.environmentId, projectId)));
  }

  return projectId;
}
