import React from 'react';
import type { CommandResultDisplay } from "../../commands.ts";
import { DesktopHandoff } from "../../components/DesktopHandoff.ts";

export async function call(
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void,
): Promise<React.ReactNode> {
  return <DesktopHandoff onDone={onDone} />;
}
