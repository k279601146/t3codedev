import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { DiffIcon, EllipsisIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Button } from "../ui/button";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  compactActions?: boolean;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  compactActions = false,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });

  const projectScriptsControl = activeProjectScripts ? (
    <ProjectScriptsControl
      scripts={activeProjectScripts}
      keybindings={keybindings}
      preferredScriptId={preferredScriptId}
      onRunScript={onRunProjectScript}
      onAddScript={onAddProjectScript}
      onUpdateScript={onUpdateProjectScript}
      onDeleteScript={onDeleteProjectScript}
    />
  ) : null;
  const openInPicker = showOpenInPicker ? (
    <OpenInPicker
      keybindings={keybindings}
      availableEditors={availableEditors}
      openInCwd={openInCwd}
    />
  ) : null;
  const gitActions = activeProjectName ? (
    <GitActionsControl
      gitCwd={gitCwd}
      activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
      {...(draftId ? { draftId } : {})}
    />
  ) : null;
  const terminalToggle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="size-6 shrink-0 rounded-md"
            pressed={terminalOpen}
            onPressedChange={onToggleTerminal}
            aria-label="Toggle terminal drawer"
            variant="outline"
            size="xs"
            disabled={!terminalAvailable}
          >
            <TerminalSquareIcon className="size-3.5" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {!terminalAvailable
          ? "Terminal is unavailable until this thread has an active project."
          : terminalToggleShortcutLabel
            ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
            : "Toggle terminal drawer"}
      </TooltipPopup>
    </Tooltip>
  );
  const diffToggle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="size-6 shrink-0 rounded-md"
            pressed={diffOpen}
            onPressedChange={onToggleDiff}
            aria-label="Toggle diff panel"
            variant="outline"
            size="xs"
            disabled={!isGitRepo && !diffOpen}
          >
            <DiffIcon className="size-3.5" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {!isGitRepo && !diffOpen
          ? "Diff panel is unavailable because this project is not a git repository."
          : diffToggleShortcutLabel
            ? `Toggle diff panel (${diffToggleShortcutLabel})`
            : "Toggle diff panel"}
      </TooltipPopup>
    </Tooltip>
  );

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-[13px] font-medium text-foreground sm:text-sm"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge
            variant="outline"
            className="min-w-0 shrink overflow-hidden px-1.5 py-0 text-[10px]"
          >
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 @3xl/header-actions:gap-2">
        {compactActions ? (
          <>
            {terminalToggle}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    className="size-6 rounded-md"
                    aria-label="More chat tools"
                  >
                    <EllipsisIcon className="size-3.5" />
                  </Button>
                }
              />
              <MenuPopup align="end" className="w-56">
                <div className="space-y-2 p-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Diff</span>
                    {diffToggle}
                  </div>
                  {projectScriptsControl ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Scripts</span>
                      {projectScriptsControl}
                    </div>
                  ) : null}
                  {openInPicker ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Open in</span>
                      {openInPicker}
                    </div>
                  ) : null}
                  {gitActions ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Git</span>
                      {gitActions}
                    </div>
                  ) : null}
                </div>
              </MenuPopup>
            </Menu>
          </>
        ) : (
          <>
            {projectScriptsControl}
            {openInPicker}
            {gitActions}
            {terminalToggle}
            {diffToggle}
          </>
        )}
      </div>
    </div>
  );
});
