import React from 'react';
import { Doctor } from "../../screens/Doctor.ts";
import type { LocalJSXCommandCall } from "@t3tools/ccb-engine/src/types/command.ts";

export const call: LocalJSXCommandCall = (onDone, _context, _args) => {
  return Promise.resolve(<Doctor onDone={onDone} />);
};

