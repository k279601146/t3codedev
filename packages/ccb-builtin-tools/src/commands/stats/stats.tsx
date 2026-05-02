import * as React from 'react';
import { Stats } from "@t3tools/ccb-engine/src/components/Stats.ts";
import type { LocalJSXCommandCall } from "@t3tools/ccb-engine/src/types/command.ts";

export const call: LocalJSXCommandCall = async onDone => {
  return <Stats onClose={onDone} />;
};

