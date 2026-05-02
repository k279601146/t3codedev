import * as React from 'react';
import { RemoteEnvironmentDialog } from "../../components/RemoteEnvironmentDialog.ts";
import type { LocalJSXCommandOnDone } from "../../types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <RemoteEnvironmentDialog onDone={onDone} />;
}
