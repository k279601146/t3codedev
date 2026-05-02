import * as React from 'react';
import { Settings } from "../../components/Settings/Settings.ts";
import type { LocalJSXCommandCall } from "../../types/command.ts";

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <Settings onClose={onDone} context={context} defaultTab="Usage" />;
};
