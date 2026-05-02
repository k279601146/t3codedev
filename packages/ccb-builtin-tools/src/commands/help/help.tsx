import * as React from 'react';
import { HelpV2 } from "@t3tools/ccb-engine/src/components/HelpV2/HelpV2.ts";
import type { LocalJSXCommandCall } from "@t3tools/ccb-engine/src/types/command.ts";

export const call: LocalJSXCommandCall = async (onDone, { options: { commands } }) => {
  return <HelpV2 commands={commands} onClose={onDone} />;
};

