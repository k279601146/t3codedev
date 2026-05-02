import * as React from 'react';
import { RemoteEnvironmentDialog } from "@t3tools/ccb-engine/src/components/RemoteEnvironmentDialog.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <RemoteEnvironmentDialog onDone={onDone} />;
}

