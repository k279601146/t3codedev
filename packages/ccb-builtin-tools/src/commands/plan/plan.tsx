import * as React from 'react';
import { handlePlanModeTransition } from "@t3tools/ccb-engine/src/bootstrap/state.ts";
import type { LocalJSXCommandContext } from "../../commands.ts";
import { Box, Text } from '@anthropic/ink';
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";
import { getExternalEditor } from "@t3tools/ccb-engine/src/utils/editor.ts";
import { toIDEDisplayName } from "@t3tools/ccb-engine/src/utils/ide.ts";
import { applyPermissionUpdate } from "@t3tools/ccb-engine/src/utils/permissions/PermissionUpdate.ts";
import { prepareContextForPlanMode } from "@t3tools/ccb-engine/src/utils/permissions/permissionSetup.ts";
import { getPlan, getPlanFilePath } from "@t3tools/ccb-engine/src/utils/plans.ts";
import { editFileInEditor } from "@t3tools/ccb-engine/src/utils/promptEditor.ts";
import { renderToString } from "@t3tools/ccb-engine/src/utils/staticRender.tsx";

function PlanDisplay({
  planContent,
  planPath,
  editorName,
}: {
  planContent: string;
  planPath: string;
  editorName: string | undefined;
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold>Current Plan</Text>
      <Text dimColor>{planPath}</Text>
      <Box marginTop={1}>
        <Text>{planContent}</Text>
      </Box>
      {editorName && (
        <Box marginTop={1}>
          <Text dimColor>&quot;/plan open&quot;</Text>
          <Text dimColor> to edit this plan in </Text>
          <Text bold dimColor>
            {editorName}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const { getAppState, setAppState } = context;
  const appState = getAppState();
  const currentMode = appState.toolPermissionContext.mode;

  // If not in plan mode, enable it
  if (currentMode !== 'plan') {
    handlePlanModeTransition(currentMode, 'plan');
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(prepareContextForPlanMode(prev.toolPermissionContext), {
        type: 'setMode',
        mode: 'plan',
        destination: 'session',
      }),
    }));
    const description = args.trim();
    if (description && description !== 'open') {
      onDone('Enabled plan mode', { shouldQuery: true });
    } else {
      onDone('Enabled plan mode');
    }
    return null;
  }

  // Already in plan mode - show the current plan
  const planContent = getPlan();
  const planPath = getPlanFilePath();

  if (!planContent) {
    onDone('Already in plan mode. No plan written yet.');
    return null;
  }

  // If user typed "/plan open", open in editor
  const argList = args.trim().split(/\s+/);
  if (argList[0] === 'open') {
    const result = await editFileInEditor(planPath);
    if (result.error) {
      onDone(`Failed to open plan in editor: ${result.error}`);
    } else {
      onDone(`Opened plan in editor: ${planPath}`);
    }
    return null;
  }

  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : undefined;

  const display = <PlanDisplay planContent={planContent} planPath={planPath} editorName={editorName} />;

  // Render to string and pass to onDone like local commands do
  const output = await renderToString(display);
  onDone(output);
  return null;
}

