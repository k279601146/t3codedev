import * as React from 'react';
import { Stats } from "../../components/Stats.ts";
import type { LocalJSXCommandCall } from "../../types/command.ts";

export const call: LocalJSXCommandCall = async onDone => {
  return <Stats onClose={onDone} />;
};
