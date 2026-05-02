import * as React from 'react';
import { AgentsMenu } from "@t3tools/ccb-engine/src/components/agents/AgentsMenu.ts";
import type { ToolUseContext } from "@t3tools/ccb-engine/src/Tool.ts";
import { getTools } from "@t3tools/ccb-engine/src/tools.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext): Promise<React.ReactNode> {
  const appState = context.getAppState();
  const permissionContext = appState.toolPermissionContext;
  const tools = getTools(permissionContext);

  return <AgentsMenu tools={tools} onExit={onDone} />;
}

