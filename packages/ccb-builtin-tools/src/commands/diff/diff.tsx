import * as React from 'react';
import type { LocalJSXCommandCall } from "@t3tools/ccb-engine/src/types/command.ts";

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const { DiffDialog } = await import('../../components/diff/DiffDialog.js');
  return <DiffDialog messages={context.messages} onDone={onDone} />;
};

