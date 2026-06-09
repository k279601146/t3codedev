import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { FolderOpenIcon, FolderPlusIcon } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useCursorLayoutStore } from "../cursorLayoutStore";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { readEnvironmentApi } from "../environmentApi";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { readLocalApi } from "../localApi";
import { ensureCursorProjectForPath } from "../lib/cursorExternalProjects";
import { newProjectId } from "../lib/utils";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { toastManager } from "./ui/toast";

interface AddProjectMenuProps {
  readonly className?: string;
  readonly title?: string;
  readonly pinToCursorExplorer?: boolean;
  readonly trigger: React.ReactNode;
}

const DEFAULT_BLANK_PROJECT_NAME = "未命名项目";

export function AddProjectMenu({
  className,
  title = "添加项目",
  pinToCursorExplorer = true,
  trigger,
}: AddProjectMenuProps) {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const setNewThreadScope = useUiStateStore((state) => state.setNewThreadScope);
  const pinProject = useCursorLayoutStore((state) => state.pinProject);
  const { handleNewThread } = useNewThreadHandler();
  const [blankDialogOpen, setBlankDialogOpen] = useState(false);
  const [blankProjectName, setBlankProjectName] = useState(DEFAULT_BLANK_PROJECT_NAME);
  const [isCreatingBlankProject, setIsCreatingBlankProject] = useState(false);
  const [isPickingExistingFolder, setIsPickingExistingFolder] = useState(false);

  const canRunProjectAction = Boolean(primaryEnvironmentId);

  const activateProject = useCallback(
    async (environmentId: EnvironmentId, projectId: ReturnType<typeof newProjectId>) => {
      const projectRef = scopeProjectRef(environmentId, projectId);
      setNewThreadScope({ kind: "project", projectRef });
      await handleNewThread(projectRef, { envMode: defaultThreadEnvMode }).catch(() => undefined);
    },
    [defaultThreadEnvMode, handleNewThread, setNewThreadScope],
  );

  const addExistingFolder = useCallback(async () => {
    if (!primaryEnvironmentId || isPickingExistingFolder) {
      return;
    }

    const localApi = readLocalApi();
    if (!localApi) {
      toastManager.add({
        type: "error",
        title: "无法选择文件夹",
        description: "本地应用接口不可用。",
      });
      return;
    }

    setIsPickingExistingFolder(true);
    try {
      const pickedPath = await localApi.dialogs.pickFolder();
      if (!pickedPath) {
        return;
      }

      const projectId = await ensureCursorProjectForPath({
        environmentId: primaryEnvironmentId,
        rawPath: pickedPath,
        projects,
        pinToExplorer: pinToCursorExplorer,
      });
      await activateProject(primaryEnvironmentId, projectId);
      toastManager.add({ type: "success", title: "项目已添加" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "添加项目失败",
        description: error instanceof Error ? error.message : "选择的文件夹无法添加为项目。",
      });
    } finally {
      setIsPickingExistingFolder(false);
    }
  }, [
    activateProject,
    isPickingExistingFolder,
    pinToCursorExplorer,
    primaryEnvironmentId,
    projects,
  ]);

  const createBlankProject = useCallback(async () => {
    if (!primaryEnvironmentId || isCreatingBlankProject) {
      return;
    }

    const trimmedName = blankProjectName.trim();
    if (trimmedName.length === 0) {
      toastManager.add({
        type: "error",
        title: "请输入项目名称",
      });
      return;
    }

    const api = readEnvironmentApi(primaryEnvironmentId);
    if (!api) {
      toastManager.add({
        type: "error",
        title: "创建项目失败",
        description: "项目 API 不可用。",
      });
      return;
    }

    setIsCreatingBlankProject(true);
    try {
      const { workspaceRoot } = await api.projects.createBlank({ name: trimmedName });
      const projectId = await ensureCursorProjectForPath({
        environmentId: primaryEnvironmentId,
        rawPath: workspaceRoot,
        projects,
        pinToExplorer: pinToCursorExplorer,
        createWorkspaceRootIfMissing: true,
      });

      try {
        await api.vcs.init({ cwd: workspaceRoot, kind: "git" });
      } catch (error) {
        toastManager.add({
          type: "warning",
          title: "项目已创建，但 Git 初始化失败",
          description: error instanceof Error ? error.message : "当前环境可能没有可用的 git。",
        });
      }

      if (pinToCursorExplorer) {
        pinProject(scopedProjectKey(scopeProjectRef(primaryEnvironmentId, projectId)));
      }
      await activateProject(primaryEnvironmentId, projectId);
      setBlankDialogOpen(false);
      setBlankProjectName(DEFAULT_BLANK_PROJECT_NAME);
      toastManager.add({ type: "success", title: "空白项目已创建" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "创建项目失败",
        description: error instanceof Error ? error.message : "空白项目无法创建。",
      });
    } finally {
      setIsCreatingBlankProject(false);
    }
  }, [
    activateProject,
    blankProjectName,
    isCreatingBlankProject,
    pinProject,
    pinToCursorExplorer,
    primaryEnvironmentId,
    projects,
  ]);

  const disabledDescription = useMemo(
    () => (canRunProjectAction ? undefined : "当前没有可用的本地环境。"),
    [canRunProjectAction],
  );

  return (
    <>
      <Menu>
        <MenuTrigger className={className} render={trigger as React.ReactElement} title={title} />
        <MenuPopup align="end" sideOffset={6} className="w-[224px] rounded-[10px] p-0">
          <MenuItem
            disabled={!canRunProjectAction || isCreatingBlankProject}
            onClick={() => setBlankDialogOpen(true)}
            className="min-h-8 rounded-[7px] px-2.5 py-1.5 text-[13px] leading-5"
          >
            <FolderPlusIcon className="size-4 text-muted-foreground" />
            <span>新建空白项目</span>
          </MenuItem>
          <MenuItem
            disabled={!canRunProjectAction || isPickingExistingFolder}
            onClick={() => void addExistingFolder()}
            className="min-h-8 rounded-[7px] px-2.5 py-1.5 text-[13px] leading-5"
          >
            <FolderOpenIcon className="size-4 text-muted-foreground" />
            <span>使用现有文件夹</span>
          </MenuItem>
          {disabledDescription ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{disabledDescription}</div>
          ) : null}
        </MenuPopup>
      </Menu>

      <Dialog open={blankDialogOpen} onOpenChange={setBlankDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>新建空白项目</DialogTitle>
            <DialogDescription>
              将在电脑的“文档”目录下创建项目文件夹，并在 git 可用时自动初始化仓库。
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-foreground">项目名称</span>
              <Input
                autoFocus
                value={blankProjectName}
                onChange={(event) => setBlankProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createBlankProject();
                  }
                }}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBlankDialogOpen(false)}
              disabled={isCreatingBlankProject}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void createBlankProject()}
              disabled={isCreatingBlankProject}
            >
              <FolderPlusIcon className="size-4" />
              {isCreatingBlankProject ? "创建中" : "创建项目"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
