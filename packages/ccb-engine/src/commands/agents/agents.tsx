import * as React from 'react';
import { AgentsMenu } from "../../components/agents/AgentsMenu.ts";
import type { ToolUseContext } from "../../Tool.ts";
import { getTools } from "../../tools.ts";
import type { LocalJSXCommandOnDone } from "../../types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext): Promise<React.ReactNode> {
  const appState = context.getAppState();
  const permissionContext = appState.toolPermissionContext;
  const tools = getTools(permissionContext);

  return <AgentsMenu tools={tools} onExit={onDone} />;
}
