import * as React from 'react';
import type { LocalJSXCommandContext } from "../../commands.ts";
import { Settings } from "@t3tools/ccb-engine/src/components/Settings/Settings.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <Settings onClose={onDone} context={context} defaultTab="Status" />;
}

