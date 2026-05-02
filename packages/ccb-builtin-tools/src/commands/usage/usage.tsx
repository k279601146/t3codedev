import * as React from 'react';
import { Settings } from "@t3tools/ccb-engine/src/components/Settings/Settings.ts";
import type { LocalJSXCommandCall } from "@t3tools/ccb-engine/src/types/command.ts";

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <Settings onClose={onDone} context={context} defaultTab="Usage" />;
};

