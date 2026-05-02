import * as React from 'react';
import type { LocalJSXCommandContext } from "../../commands.ts";
import { BackgroundTasksDialog } from "@t3tools/ccb-engine/src/components/tasks/BackgroundTasksDialog.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <BackgroundTasksDialog toolUseContext={context} onDone={onDone} />;
}

