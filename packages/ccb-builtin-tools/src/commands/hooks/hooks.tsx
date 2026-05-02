import * as React from 'react';
import { HooksConfigMenu } from "@t3tools/ccb-engine/src/components/hooks/HooksConfigMenu.ts";
import { logEvent } from "@t3tools/ccb-engine/src/services/analytics/index.ts";
import { getTools } from "@t3tools/ccb-engine/src/tools.ts";
import type { LocalJSXCommandCall } from "@t3tools/ccb-engine/src/types/command.ts";

export const call: LocalJSXCommandCall = async (onDone, context) => {
  logEvent('tengu_hooks_command', {});
  const appState = context.getAppState();
  const permissionContext = appState.toolPermissionContext;
  const toolNames = getTools(permissionContext).map(tool => tool.name);
  return <HooksConfigMenu toolNames={toolNames} onExit={onDone} />;
};

